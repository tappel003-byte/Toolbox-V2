// Topo interpolation and contouring.
// Thin-plate spline (TPS) surface — the minimum-curvature interpolant that
// passes exactly through every measured reading. Unlike IDW, TPS does NOT
// create bullseye rings around each data point: the gradient between two
// neighboring points is monotonic, so between a 6.0 and a 6.2 you get one
// clean 6.0 contour, not concentric bumps.

import { contours } from "d3-contour";
import type { SurveyPoint } from "./types";

export const TOPO_GRID_TARGET_COLS = 320;

export interface Grid {
  values: Float64Array;
  mask: Uint8Array; // 1 = inside boundary
  width: number;
  height: number;
  minValue: number;
  maxValue: number;
  x0: number;
  y0: number;
  step: number;
}

function pointInPolygon(px: number, py: number, poly: Array<{ x: number; y: number }>) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y,
      xj = poly[j].x,
      yj = poly[j].y;
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// -------- Thin-plate spline --------
// Basis: φ(r) = r² · ln(r).  Surface: f(x,y) = a0 + a1·x + a2·y + Σ wi·φ(‖p−pi‖).
// With constraints Σwi = 0, Σwi·xi = 0, Σwi·yi = 0 and f(pi) = zi we get an
// (N+3)×(N+3) symmetric linear system.

interface TpsModel {
  points: SurveyPoint[];
  w: number[]; // length N
  a: [number, number, number]; // a0, a1·x, a2·y
}

function tpsKernel(r2: number) {
  if (r2 <= 1e-12) return 0;
  return 0.5 * r2 * Math.log(r2); // r²·ln(r) = (r²/2)·ln(r²)
}

// Gaussian elimination with partial pivoting. n is small (# survey points + 3).
function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M: number[][] = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > Math.abs(M[pivot][i])) pivot = k;
    }
    if (Math.abs(M[pivot][i]) < 1e-12) return null;
    if (pivot !== i) [M[i], M[pivot]] = [M[pivot], M[i]];
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

function fitTps(points: SurveyPoint[]): TpsModel | null {
  const n = points.length;
  if (n < 3) return null;
  const size = n + 3;
  const A: number[][] = Array.from({ length: size }, () => new Array(size).fill(0));
  const b: number[] = new Array(size).fill(0);

  // Small regularization (λ) on the diagonal of the K block — keeps the
  // system well-conditioned when points are nearly collinear without
  // meaningfully pulling the surface off the readings.
  const lambda = 1e-8;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      A[i][j] = tpsKernel(dx * dx + dy * dy);
    }
    A[i][i] += lambda;
    A[i][n] = 1;
    A[i][n + 1] = points[i].x;
    A[i][n + 2] = points[i].y;
    A[n][i] = 1;
    A[n + 1][i] = points[i].x;
    A[n + 2][i] = points[i].y;
    b[i] = points[i].value;
  }

  const sol = solveLinearSystem(A, b);
  if (!sol) return null;
  return {
    points,
    w: sol.slice(0, n),
    a: [sol[n], sol[n + 1], sol[n + 2]],
  };
}

function evalTps(model: TpsModel, x: number, y: number): number {
  let v = model.a[0] + model.a[1] * x + model.a[2] * y;
  for (let i = 0; i < model.points.length; i++) {
    const dx = x - model.points[i].x;
    const dy = y - model.points[i].y;
    v += model.w[i] * tpsKernel(dx * dx + dy * dy);
  }
  return v;
}

// IDW fallback for degenerate cases (≤2 points, or singular TPS system).
function interpolateIdw(x: number, y: number, points: SurveyPoint[], power = 2) {
  let num = 0;
  let den = 0;
  for (const p of points) {
    const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d2 < 1e-6) return p.value;
    const w = 1 / Math.pow(d2, power / 2);
    num += p.value * w;
    den += w;
  }
  return num / den;
}

export function buildGrid(
  points: SurveyPoint[],
  boundary: Array<{ x: number; y: number }>,
  targetCols = TOPO_GRID_TARGET_COLS,
  exclusions?: Array<Array<{ x: number; y: number }>>,
): Grid | null {
  // Drop readings that fall outside the boundary or inside any exclusion —
  // they must not influence the interpolated surface. Points outside the
  // boundary still render on the plan; they just don't pull the contours.
  const excl = exclusions?.filter((p) => p.length >= 3) ?? [];
  const insideBoundary =
    boundary.length >= 3
      ? points.filter((p) => pointInPolygon(p.x, p.y, boundary))
      : points;
  const activePoints = excl.length
    ? insideBoundary.filter((p) => !excl.some((poly) => pointInPolygon(p.x, p.y, poly)))
    : insideBoundary;

  if (activePoints.length < 3 || boundary.length < 3) return null;

  const xs = boundary.map((p) => p.x);
  const ys = boundary.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = maxX - minX;
  const h = maxY - minY;
  const step = Math.max(w, h) / targetCols;
  const cols = Math.max(2, Math.ceil(w / step));
  const rows = Math.max(2, Math.ceil(h / step));

  const values = new Float64Array(cols * rows);
  const mask = new Uint8Array(cols * rows);
  const minV = Math.min(...activePoints.map((p) => p.value));
  const maxV = Math.max(...activePoints.map((p) => p.value));

  const tps = fitTps(activePoints);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = minX + c * step;
      const py = minY + r * step;
      const idx = r * cols + c;
      if (!pointInPolygon(px, py, boundary)) {
        values[idx] = NaN;
        continue;
      }
      // Skip cells inside any exclusion — they render as "no data".
      if (excl.length && excl.some((poly) => pointInPolygon(px, py, poly))) {
        values[idx] = NaN;
        continue;
      }
      const rawValue = tps ? evalTps(tps, px, py) : interpolateIdw(px, py, activePoints, 2);
      // The topo should never invent elevations beyond the measured high/low.
      // TPS can mathematically overshoot near an edge; clamping keeps every
      // rendered color and contour inside the same range shown in the legend.
      values[idx] = Math.max(minV, Math.min(maxV, rawValue));
      mask[idx] = 1;
    }
  }

  return {
    values,
    mask,
    width: cols,
    height: rows,
    minValue: isFinite(minV) ? minV : 0,
    maxValue: isFinite(maxV) ? maxV : 0,
    x0: minX,
    y0: minY,
    step,
  };
}

export interface ContourOptions {
  first?: number | null;
  step: number;
  count?: number;
  min?: number | null;
  max?: number | null;
}

export function contourThresholds(grid: Grid, options: ContourOptions) {
  const step = Math.max(0.01, options.step || 0.2);
  const min = options.min ?? grid.minValue;
  const max = options.max ?? grid.maxValue;
  const first = options.first ?? Math.ceil((min - 1e-6) / step) * step;
  const count =
    options.count && options.count > 0 ? options.count : Math.floor((max - first + 1e-6) / step) + 1;
  const thresholds: number[] = [];
  for (let i = 0; i < count; i++) {
    thresholds.push(Math.round((first + i * step) * 1000) / 1000);
  }
  return thresholds.filter((v) => v >= min - 1e-6 && v <= max + 1e-6);
}

export function computeContours(grid: Grid, options: ContourOptions | number) {
  const clean = new Float64Array(grid.values.length);
  for (let i = 0; i < clean.length; i++) {
    clean[i] = grid.mask[i] ? grid.values[i] : NaN;
  }
  const thresholds =
    typeof options === "number"
      ? contourThresholds(grid, { step: options })
      : contourThresholds(grid, options);

  const gen = contours().size([grid.width, grid.height]).thresholds(thresholds);
  return gen(Array.from(clean));
}

export function clampValue(value: number, min: number, max: number) {
  if (max <= min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}
