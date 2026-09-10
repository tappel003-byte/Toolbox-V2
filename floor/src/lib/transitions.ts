// Flooring transition helpers — pure functions. See mem://features/transitions-spec-locked.

import type { SurveyPoint, Transition } from "./types";

/**
 * Common flooring surfaces. Each surface has an implicit structural base:
 *   'slab'     → measured to top of slab
 *   'subfloor' → measured to top of subfloor
 *   null       → neutral (e.g. Tile) — its own averaging group
 * "Other" is a sentinel; the caller replaces it with a user-typed label.
 */
export const SURFACE_BASE: Record<string, "slab" | "subfloor" | null> = {
  "Tile": null,
  "Concrete/slab": "slab",
  "Carpet/slab": "slab",
  "Subfloor": "subfloor",
  "Carpet/subfloor": "subfloor",
  "Hardwood": "subfloor",
  "Engineered wood": "subfloor",
  "Laminate": "subfloor",
  "LVP": "subfloor",
  "Vinyl sheet": "subfloor",
  "Linoleum": "subfloor",
};

/** Sentinel label for user-defined surfaces. Not stored as-is — replaced with typed text. */
export const OTHER_SENTINEL = "Other";

/** Ordered list for dropdowns. "Other" trailing option triggers a custom text input. */
export const COMMON_SURFACES = [
  "Tile",
  "Hardwood",
  "Engineered wood",
  "Laminate",
  "LVP",
  "Vinyl sheet",
  "Linoleum",
  "Concrete/slab",
  "Carpet/slab",
  "Subfloor",
  "Carpet/subfloor",
  OTHER_SENTINEL,
] as const;

/**
 * Grouping normalization for the Transitions "average across doorways" feature.
 *
 * Only the compound `/slab` and `/subfloor` labels collapse to their structural
 * base — the top surface is treated as a modifier and dropped:
 *   Carpet/slab, Concrete/slab       → "slab"
 *   Subfloor, Carpet/subfloor        → "subfloor"
 * Every other surface (Tile, Hardwood, Engineered wood, Laminate, LVP,
 * Vinyl sheet, Linoleum, and any custom "Other" text) is kept as its exact
 * literal name. Custom "Other" values are trimmed of surrounding whitespace
 * and otherwise compared case-sensitively byte-for-byte; two doorways only
 * share a group when their normalized names match on BOTH sides.
 */
export function normalizeSurfaceForGrouping(name: string): string {
  const trimmed = (name ?? "").trim();
  if (trimmed === "Carpet/slab" || trimmed === "Concrete/slab") return "slab";
  if (trimmed === "Subfloor" || trimmed === "Carpet/subfloor") return "subfloor";
  return trimmed;
}

/** Pretty label for the normalized grouping id ('slab' → 'Slab'). */
export function normalizedSurfaceLabel(normalized: string): string {
  if (normalized === "slab") return "Slab";
  if (normalized === "subfloor") return "Subfloor";
  return normalized;
}

/**
 * Legacy: structural base category used only by the AveragedCorrectionsChip
 * display fallback. Prefer normalizeSurfaceForGrouping for grouping logic.
 */
export function surfaceCategory(name: string): string {
  return normalizeSurfaceForGrouping(name);
}

/** Pretty label for a category identifier ('slab' → 'Slab'). */
export function categoryLabel(cat: string): string {
  return normalizedSurfaceLabel(cat);
}

/**
 * Canonical key for grouping transitions in the Transitions sheet.
 * Uses the normalized surface on each side, so `/slab` and `/subfloor`
 * compound variants collapse together while every other surface stays literal.
 */
export function transitionGroupKey(t: Pick<Transition, "surfaceA" | "surfaceB">): string {
  return `${normalizeSurfaceForGrouping(t.surfaceA)}→${normalizeSurfaceForGrouping(t.surfaceB)}`;
}


/**
 * Legacy → compound surface migration. Old projects stored bare "Carpet" /
 * "Concrete" strings; map them to the new compound names on load.
 */
export function migrateSurfaceName(s: string): string {
  if (s === "Carpet") return "Carpet/slab";
  if (s === "Concrete") return "Concrete/slab";
  return s;
}

/**
 * delta priority:
 *   1. manual per-doorway override, if set
 *   2. per-surface-pair applied average — ONLY if this doorway opts in
 *      (t.useGroupAverage === true) and an average exists for its group
 *   3. this doorway's measured readingA − readingB (default)
 */
export function transitionDelta(
  t: Transition,
  groupAverages?: Record<string, number>,
): number {
  if (t.manualDeltaOverride !== undefined) return t.manualDeltaOverride;
  if (t.useGroupAverage) {
    const avg = groupAverages?.[transitionGroupKey(t)];
    if (avg !== undefined) return avg;
  }
  return t.readingA - t.readingB;
}

/** Corrected value used by topo/stats/export. Anchor keeps its stored value (already A-frame). */
export function correctedValue(
  p: SurveyPoint,
  transitions: readonly Transition[] | undefined,
  groupAverages?: Record<string, number>,
): number {
  if (!p.transitionId || p.isTransitionAnchor) return p.value;
  const t = transitions?.find((x) => x.id === p.transitionId);
  if (!t) return p.value;
  // Round to 2 decimals to hide floating-point artifacts like 9.3000000000000002.
  return Math.round((p.value + transitionDelta(t, groupAverages)) * 100) / 100;
}

/** Returns a new array of points with `value` replaced by the corrected value. */
export function withCorrectedValues(
  points: readonly SurveyPoint[],
  transitions: readonly Transition[] | undefined,
  groupAverages?: Record<string, number>,
): SurveyPoint[] {
  if (!transitions || transitions.length === 0) return points.slice();
  return points.map((p) => {
    const cv = correctedValue(p, transitions, groupAverages);
    return cv === p.value ? p : { ...p, value: cv };
  });
}

/** Format a signed delta like "+0.4" / "-0.4". Trims to 1 decimal for label brevity. */
export function formatDelta(d: number): string {
  const sign = d >= 0 ? "+" : "-";
  return `${sign}${Math.abs(d).toFixed(2)}`;
}

/** Short label for the transition chip / detail dialog: "Carpet correction +0.4"" */
export function transitionLabel(t: Transition, groupAverages?: Record<string, number>): string {
  return `${t.surfaceB} correction ${formatDelta(transitionDelta(t, groupAverages))}"`;
}

/** Surface-focused correction label: "Carpet correction". */
export function correctionLabel(surface: string): string {
  return `${surface || "Surface"} correction`;
}

/**
 * Walks parentId up to the chain root and returns the root's surfaceA — the
 * baseline surface every correction in the chain resolves back to.
 */
export function getChainBaselineSurface(
  transitionId: string | null | undefined,
  transitions: readonly Transition[] | undefined,
): string | null {
  if (!transitionId || !transitions?.length) return null;
  const byId = new Map(transitions.map((t) => [t.id, t]));
  let cur = byId.get(transitionId);
  const seen = new Set<string>();
  while (cur?.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const p = byId.get(cur.parentId);
    if (!p) break;
    cur = p;
  }
  return cur?.surfaceA ?? null;
}

/** One surface-pair group for the Transitions sheet. */
export interface TransitionGroup {
  key: string;
  /** Category identifier on the "from" side ('slab' | 'subfloor' | surface name). */
  surfaceA: string;
  /** Category identifier on the "to" side. */
  surfaceB: string;
  /** Human-readable category label for display. */
  labelA: string;
  labelB: string;
  transitions: Transition[];
  /** Mean of raw measured deltas (readingA − readingB) in this group. */
  measuredAverage: number;
  /** Number of points (excluding anchors) referencing any transition in this group. */
  affectedPointCount: number;
}

/** Group every transition on the floor by canonical structural base pair. */
export function groupTransitionsBySurfacePair(
  transitions: readonly Transition[] | undefined,
  points: readonly SurveyPoint[] | undefined,
): TransitionGroup[] {
  if (!transitions?.length) return [];
  const byKey = new Map<string, TransitionGroup>();
  for (const t of transitions) {
    const key = transitionGroupKey(t);
    let g = byKey.get(key);
    if (!g) {
      const nA = normalizeSurfaceForGrouping(t.surfaceA);
      const nB = normalizeSurfaceForGrouping(t.surfaceB);
      g = {
        key,
        surfaceA: nA,
        surfaceB: nB,
        labelA: normalizedSurfaceLabel(nA),
        labelB: normalizedSurfaceLabel(nB),
        transitions: [],
        measuredAverage: 0,
        affectedPointCount: 0,
      };
      byKey.set(key, g);
    }
    g.transitions.push(t);
  }

  const idToKey = new Map(transitions.map((t) => [t.id, transitionGroupKey(t)]));
  const affectedByKey = new Map<string, number>();
  for (const p of points ?? []) {
    if (!p.transitionId || p.isTransitionAnchor) continue;
    const k = idToKey.get(p.transitionId);
    if (!k) continue;
    affectedByKey.set(k, (affectedByKey.get(k) ?? 0) + 1);
  }
  for (const g of byKey.values()) {
    const rawDeltas = g.transitions.map((t) => t.readingA - t.readingB);
    g.measuredAverage =
      rawDeltas.reduce((s, v) => s + v, 0) / (rawDeltas.length || 1);
    g.affectedPointCount = affectedByKey.get(g.key) ?? 0;
  }
  return Array.from(byKey.values()).sort((a, b) =>
    a.key.localeCompare(b.key),
  );
}
