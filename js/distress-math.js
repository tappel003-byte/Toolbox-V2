// Distress Survey pin-direction math, shared by the native capture screen.
// Ported from pinCardinal()/_orientationOffset()/_originXY() in
// distress/survey.html (real source) rather than reimplemented from scratch.
// survey.html works in plan-pixel space and divides by plan width/height to
// get a fraction; Toolbox already stores pin/room/front-door positions as
// 0-1 fractions directly (job.rooms[].x/y, job.frontDoor.marker), so the
// pixel-normalization step is skipped — the bearing math itself is unchanged.

const DISTRESS_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const DISTRESS_BEARINGS = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

// Plan-up direction in real-world bearing = opposite of front-door facing.
function distressOrientationOffset(frontDoor) {
  if (!frontDoor || !frontDoor.facing) return null;
  const beta = DISTRESS_BEARINGS[frontDoor.facing];
  if (beta == null) return null;
  return (beta + 180) % 360;
}

// Use the placed front-door marker as origin when available (sharper
// front/back geometry); otherwise fall back to the plan center.
function distressOriginXY(frontDoor) {
  if (frontDoor && frontDoor.marker && typeof frontDoor.marker.x === 'number') {
    return { x: frontDoor.marker.x, y: frontDoor.marker.y };
  }
  return { x: 0.5, y: 0.5 };
}

// pinX/pinY: 0-1 fractions of the plan image. Returns a compass letter,
// 'Center', or '' if no front-door facing has been set yet.
function pinCardinalDirection(pinX, pinY, frontDoor) {
  const offset = distressOrientationOffset(frontDoor);
  if (offset == null) return '';
  const o = distressOriginXY(frontDoor);
  const dx = pinX - o.x;
  const dy = pinY - o.y;
  if (Math.hypot(dx, dy) < 0.03) return 'Center';
  const alpha = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  const bearing = (alpha + offset) % 360;
  return DISTRESS_DIRS[Math.round(bearing / 45) % 8];
}

// Room auto-guess, ported from pinRoom()/_isGenericRoomLabel() in
// distress/survey.html rather than reinvented — nearest-room-label
// scoring with the same two guards the real app uses: an absolute
// distance cutoff, and an ambiguity check that refuses to guess when a
// runner-up room is nearly as close as the winner. v1 simplification:
// the real app also disambiguates duplicate room names for display
// ("Bedroom" x2 -> "North Bedroom"/"South Bedroom") using the same
// front-door bearing math above; not ported here, since Toolbox's room
// picker shows raw job.rooms names and a disambiguated label wouldn't
// match any option in it. Deferred, not dropped silently — see the punch list.
const DISTRESS_GENERIC_ROOM_WORDS = new Set([
  'room', 'rooms', 'area', 'areas', 'notes', 'note', 'label', 'labels',
  'space', 'spaces', 'zone', 'zones', 'section', 'sections', 'plan', 'plans',
  'floor', 'floors', 'level', 'levels', 'unit', 'units', 'tbd', 'n/a', 'na',
]);

function isGenericRoomLabel(name) {
  const s = (name || '').trim().toLowerCase();
  if (!s) return true;
  const core = s.replace(/[\s\-#_.:]*\d+$/, '').trim();
  if (!core) return true;
  return DISTRESS_GENERIC_ROOM_WORDS.has(core);
}

// rooms: job.rooms, [{id,name,x?,y?}] (x/y already 0-1 fractions; a room
// typed but never placed on the plan has no x/y and can't be guessed
// against). pinX/pinY: 0-1 fractions of the same plan.
function guessPinRoom(rooms, pinX, pinY) {
  if (!rooms || !rooms.length) return '';
  const scored = [];
  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i];
    if (r.x == null || r.y == null) continue;
    if (isGenericRoomLabel(r.name)) continue;
    scored.push({ i, d: Math.hypot(r.x - pinX, r.y - pinY) });
  }
  if (!scored.length) return '';
  scored.sort((a, b) => a.d - b.d);
  const best = scored[0];
  // Absolute guard: closest label is very far from the pin — don't guess.
  if (best.d > 0.28) return '';
  // Ambiguity guard: require a clear winner over the runner-up.
  if (scored.length > 1) {
    const next = scored[1];
    if (best.d > 0.02 && next.d < best.d * 1.25) return '';
  }
  return rooms[best.i].name;
}
