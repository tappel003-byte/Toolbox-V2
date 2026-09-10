// Multi-area support.
//
// A floor used to have a single outer `boundary`. It now has a list of
// `areas`, each with its own polygon, its own contour surface and its own
// High / Low / Δ. `boundary` is kept as the legacy field and always mirrors
// areas[0].polygon so older code paths keep working.

import type { Exclusion, Floor, SurveyPoint, TopoArea } from "./types";
import { pointInPolygon } from "./exclusions";

export const LEGACY_AREA_ID = "legacy";

/** Areas for a floor. Falls back to the legacy single boundary as "Area 1". */
export function getAreas(floor: Floor): TopoArea[] {
  if (floor.areas && floor.areas.length > 0) return floor.areas;
  return [
    {
      id: LEGACY_AREA_ID,
      name: "Boundary 1",
      polygon: floor.boundary ?? [],
      createdAt: floor.createdAt ?? Date.now(),
    },
  ];
}

/** Write an area list onto a floor, mirroring the first polygon to `boundary`. */
export function withAreas(floor: Floor, areas: TopoArea[]): Floor {
  return {
    ...floor,
    areas,
    boundary: areas[0]?.polygon ?? [],
    updatedAt: Date.now(),
  };
}

/** Areas with a closed (>= 3 vertex) polygon. */
export function closedAreas(floor: Floor): TopoArea[] {
  return getAreas(floor).filter((a) => a.polygon.length >= 3);
}

/** The first area whose polygon contains the point, or null. */
export function areaOfPoint(p: { x: number; y: number }, areas: TopoArea[]): TopoArea | null {
  for (const a of areas) {
    if (a.polygon.length >= 3 && pointInPolygon(p.x, p.y, a.polygon)) return a;
  }
  return null;
}

/** Points that physically sit inside one area. */
export function pointsInArea(points: SurveyPoint[], area: TopoArea): SurveyPoint[] {
  if (area.polygon.length < 3) return [];
  return points.filter((p) => pointInPolygon(p.x, p.y, area.polygon));
}

/** Map area id → points assigned to that area (first match wins). */
export function pointsByArea(
  points: SurveyPoint[],
  areas: TopoArea[],
): Map<string, SurveyPoint[]> {
  const m = new Map<string, SurveyPoint[]>();
  for (const a of areas) m.set(a.id, []);
  for (const p of points) {
    const a = areaOfPoint(p, areas);
    if (a) m.get(a.id)!.push(p);
  }
  return m;
}

/** Points inside at least one area. Points in no area contribute to nothing. */
export function pointsInAnyArea(points: SurveyPoint[], areas: TopoArea[]): SurveyPoint[] {
  const closed = areas.filter((a) => a.polygon.length >= 3);
  if (closed.length === 0) return points;
  return points.filter((p) => !!areaOfPoint(p, closed));
}

/** Centroid of a polygon (simple vertex average — good enough for anchoring). */
export function areaCentroid(area: TopoArea): { x: number; y: number } {
  const poly = area.polygon;
  if (poly.length === 0) return { x: 0, y: 0 };
  let sx = 0,
    sy = 0;
  for (const p of poly) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / poly.length, y: sy / poly.length };
}

/** Exclusion zones that fall inside a given area (by their centroid). */
export function exclusionsForArea(
  area: TopoArea,
  exclusions: Exclusion[] | undefined,
): Exclusion[] {
  if (!exclusions?.length) return [];
  if (area.polygon.length < 3) return [];
  return exclusions.filter((ex) => {
    if (ex.polygon.length < 3) return false;
    const cx = ex.polygon.reduce((s, p) => s + p.x, 0) / ex.polygon.length;
    const cy = ex.polygon.reduce((s, p) => s + p.y, 0) / ex.polygon.length;
    return pointInPolygon(cx, cy, area.polygon);
  });
}
