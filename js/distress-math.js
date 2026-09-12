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
