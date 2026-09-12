// Floor Survey transition-correction math, shared by every screen that
// reads corrected elevation values (Report Builder, Diagnostics).
// Ported from floor/src/lib/transitions.ts (real Floor Survey source) rather
// than reimplemented from scratch — this has to match exactly, or a Toolbox
// screen would silently disagree with what Floor Survey itself shows for
// the same floor. Reference only; the standalone repo is never edited.

function normalizeSurfaceForGrouping(name) {
  const trimmed = (name || '').trim();
  if (trimmed === 'Carpet/slab' || trimmed === 'Concrete/slab') return 'slab';
  if (trimmed === 'Subfloor' || trimmed === 'Carpet/subfloor') return 'subfloor';
  return trimmed;
}

function transitionDelta(t, groupAverages) {
  if (t.manualDeltaOverride !== undefined) return t.manualDeltaOverride;
  if (t.useGroupAverage) {
    const key = `${normalizeSurfaceForGrouping(t.surfaceA)}→${normalizeSurfaceForGrouping(t.surfaceB)}`;
    const avg = groupAverages && groupAverages[key];
    if (avg !== undefined) return avg;
  }
  return t.readingA - t.readingB;
}

// Corrected value used for stats/export/3D. Anchor points keep their stored
// value (already base-frame); everything else adds its transition's delta.
function correctedPointValue(p, transitions, groupAverages) {
  if (!p.transitionId || p.isTransitionAnchor) return p.value;
  const t = (transitions || []).find((x) => x.id === p.transitionId);
  if (!t) return p.value;
  return Math.round((p.value + transitionDelta(t, groupAverages)) * 100) / 100;
}

function computeFloorHighLowDelta(floor, allPoints) {
  const pts = (allPoints || []).filter((p) => p.floorId === floor.id);
  if (!pts.length) return null;
  const values = pts.map((p) => correctedPointValue(p, floor.transitions, floor.transitionGroupAverages));
  const high = Math.max(...values);
  const low = Math.min(...values);
  return { high, low, delta: high - low, count: pts.length };
}
