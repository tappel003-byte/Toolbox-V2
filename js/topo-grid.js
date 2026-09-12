// Topo surface interpolation + palette color, shared by Diagnostics' 3D view.
// Ported from floor/src/lib/topo.ts and the paletteColor() function in
// floor/src/components/tabs/TopoTab.tsx (real Floor Survey source) rather
// than reimplemented from scratch — the elevation mesh has to be built from
// the same thin-plate-spline surface Floor Survey itself uses, or Diagnostics
// would show a shape that doesn't match the real data. Reference only; the
// standalone repo is never edited.
//
// Thin-plate spline (TPS) — the minimum-curvature interpolant that passes
// exactly through every measured reading. Unlike IDW, TPS does not create
// bullseye rings around each data point.

const TOPO_GRID_TARGET_COLS = 320;

function topoPointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const intersect = (yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Basis: φ(r) = r²·ln(r). Surface: f(x,y) = a0 + a1·x + a2·y + Σ wi·φ(‖p−pi‖).
function tpsKernel(r2) {
  if (r2 <= 1e-12) return 0;
  return 0.5 * r2 * Math.log(r2);
}

// Gaussian elimination with partial pivoting. n is small (# survey points + 3).
function solveLinearSystem(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > Math.abs(M[pivot][i])) pivot = k;
    }
    if (Math.abs(M[pivot][i]) < 1e-12) return null;
    if (pivot !== i) { const tmp = M[i]; M[i] = M[pivot]; M[pivot] = tmp; }
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

function fitTps(points) {
  const n = points.length;
  if (n < 3) return null;
  const size = n + 3;
  const A = Array.from({ length: size }, () => new Array(size).fill(0));
  const b = new Array(size).fill(0);
  // Small regularization (λ) — keeps the system well-conditioned when points
  // are nearly collinear without meaningfully pulling the surface off the readings.
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
  return { points, w: sol.slice(0, n), a: [sol[n], sol[n + 1], sol[n + 2]] };
}

function evalTps(model, x, y) {
  let v = model.a[0] + model.a[1] * x + model.a[2] * y;
  for (let i = 0; i < model.points.length; i++) {
    const dx = x - model.points[i].x;
    const dy = y - model.points[i].y;
    v += model.w[i] * tpsKernel(dx * dx + dy * dy);
  }
  return v;
}

// IDW fallback for degenerate cases (<=2 points, or singular TPS system).
function interpolateIdw(x, y, points, power) {
  power = power || 2;
  let num = 0, den = 0;
  for (const p of points) {
    const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d2 < 1e-6) return p.value;
    const w = 1 / Math.pow(d2, power / 2);
    num += p.value * w;
    den += w;
  }
  return num / den;
}

// points: [{x,y,value}]; boundary: [{x,y}]; exclusions: [[{x,y},...], ...]
function buildGrid(points, boundary, targetCols, exclusions) {
  targetCols = targetCols || TOPO_GRID_TARGET_COLS;
  // Drop readings that fall outside the boundary or inside any exclusion —
  // they must not influence the interpolated surface.
  const excl = (exclusions || []).filter((p) => p.length >= 3);
  const insideBoundary = boundary.length >= 3
    ? points.filter((p) => topoPointInPolygon(p.x, p.y, boundary))
    : points;
  const activePoints = excl.length
    ? insideBoundary.filter((p) => !excl.some((poly) => topoPointInPolygon(p.x, p.y, poly)))
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
      if (!topoPointInPolygon(px, py, boundary)) { values[idx] = NaN; continue; }
      if (excl.length && excl.some((poly) => topoPointInPolygon(px, py, poly))) { values[idx] = NaN; continue; }
      const rawValue = tps ? evalTps(tps, px, py) : interpolateIdw(px, py, activePoints, 2);
      // The surface should never invent elevations beyond the measured high/low.
      values[idx] = Math.max(minV, Math.min(maxV, rawValue));
      mask[idx] = 1;
    }
  }

  return {
    values, mask, width: cols, height: rows,
    minValue: isFinite(minV) ? minV : 0,
    maxValue: isFinite(maxV) ? maxV : 0,
    x0: minX, y0: minY, step,
  };
}

function clampValue(value, min, max) {
  if (max <= min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

const TOPO_PALETTE_STOPS = {
  brown: [[130, 90, 55], [149, 99, 50], [201, 153, 83], [239, 213, 146], [116, 146, 118]],
  rainbow: [[49, 75, 160], [46, 156, 202], [80, 177, 94], [245, 214, 79], [201, 65, 45]],
  'blue-red': [[45, 86, 150], [120, 167, 204], [238, 222, 172], [206, 115, 73], [142, 45, 35]],
  'red-yellow-green': [[220, 40, 40], [230, 100, 40], [255, 235, 60], [150, 210, 60], [34, 160, 50]],
  gray: [[42, 42, 42], [92, 92, 92], [145, 145, 145], [198, 198, 198], [238, 238, 238]],
  ocean: [[10, 30, 70], [20, 80, 130], [40, 150, 175], [130, 210, 210], [235, 230, 200]],
  sunset: [[50, 20, 80], [130, 40, 120], [220, 70, 110], [245, 140, 60], [250, 215, 100]],
  forest: [[20, 50, 30], [45, 90, 55], [110, 140, 70], [180, 175, 110], [240, 232, 200]],
  viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  topographic: [[90, 130, 80], [175, 190, 120], [220, 190, 140], [165, 120, 85], [245, 245, 245]],
  'gray-amber': [[55, 55, 55], [110, 110, 110], [175, 175, 175], [220, 200, 150], [240, 175, 60]],
  'nm-sunset': [[250, 170, 175], [235, 145, 145], [200, 165, 170], [150, 145, 150], [90, 95, 105]],
  mountain: [[140, 100, 70], [80, 130, 60], [120, 170, 90], [230, 220, 200], [255, 255, 255]],
};

function paletteColor(input, palette, reverse) {
  const t = reverse ? 1 - input : input;
  const s = TOPO_PALETTE_STOPS[palette] || TOPO_PALETTE_STOPS.topographic;
  const scaled = Math.max(0, Math.min(0.999, t)) * (s.length - 1);
  const i = Math.floor(scaled);
  const f = scaled - i;
  const a = s[i];
  const b = s[i + 1] || a;
  const rgb = a.map((v, idx) => Math.round(v + (b[idx] - v) * f));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}
