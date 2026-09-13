// Diagnostics — 3D elevation view.
// Real Diagnostics screen #1 per the brief: a rotatable colored elevation
// mesh, informed by Floor Survey's own ThreeDTab.tsx (real source) but built
// fresh here, vanilla JS + vendored three.js. Read-only with respect to
// drawer data — nothing here ever writes to job.floorSurvey or job.distressSurvey.
// The one write this file performs is Capture: appending its own exported
// image to job.exhibits[], a field Diagnostics owns, for Report Builder to
// display — not a mutation of any drawer's data.

const DIAG_PALETTE = 'topographic';
const DIAG_REVERSE_PALETTE = false;
const DIAG_EXHIBIT_MARGIN_PX = 40; // white margin baked into the exported/stored image

let diagJob = null;
let diagJobKey = null;
let diagFloors = [];
let diagPoints = [];
let diagActiveScreen = '3d';

let renderer, scene, camera, controls, mesh, pointsGroup;
let baseZ = null;
let zScale = 1;
let currentGrid = null;
let currentActivePoints = [];
let animationFrame = 0;
let resizeObserver = null;

// ---------- Tilt / Deflection screen ----------
// Second Diagnostics view: user picks two existing survey points to define a
// line; β = δ/L along that line, plus a deflection ratio (max residual from
// the straight line / span) when other points fall on the same line. Reuses
// the same corrected-value math as the 3D view (floor-survey-math.js) so the
// numbers agree with what Floor Survey itself reports.
const TILT_THRESHOLD_DENOMS = [500, 300, 150];
let tiltCanvas = null;
let tiltCtx = null;
let tiltResizeObserver = null;
let tiltFloor = null;
let tiltPointsAll = [];
let tiltSelected = []; // up to 2 point ids
let tiltLineResult = null;
let tiltTransform = null;

function pointInsideAnyExclusion(p, exclusions) {
  return (exclusions || []).some((ex) => topoPointInPolygon(p.x, p.y, ex.polygon));
}

function setStatus(msg) {
  const el = document.getElementById('diag-status');
  if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
  el.style.display = 'flex';
  el.textContent = msg;
}

function initThree() {
  const mount = document.getElementById('diag-mount');

  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x0b0b0b, 1);
  mount.appendChild(renderer.domElement);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
  camera.position.set(0, -1.2, 0.9);
  camera.up.set(0, 0, 1);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.enablePan = true;
  controls.screenSpacePanning = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 0.7);
  key.position.set(1, 1, 2);
  scene.add(key);

  const animate = () => {
    controls.update();
    renderer.render(scene, camera);
    animationFrame = requestAnimationFrame(animate);
  };
  animate();

  const resize = () => {
    const w = mount.clientWidth, h = mount.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(mount);
}

function clearMesh() {
  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    mesh = null;
  }
  if (pointsGroup) {
    scene.remove(pointsGroup);
    pointsGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    pointsGroup = null;
  }
}

function buildMeshForFloor(floor) {
  clearMesh();
  document.getElementById('btn-export-png').disabled = true;

  const floorPoints = diagPoints
    .filter((p) => p.floorId === floor.id)
    .map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      value: correctedPointValue(p, floor.transitions, floor.transitionGroupAverages),
    }));

  const activePoints = pointInsideAnyExclusionFilter(floorPoints, floor.exclusions);
  currentActivePoints = activePoints;

  if (activePoints.length < 3 || !floor.boundary || floor.boundary.length < 3) {
    currentGrid = null;
    setStatus(activePoints.length < 3 ? 'Need at least 3 survey points.' : 'Boundary is missing.');
    document.getElementById('diag-panel').style.display = 'none';
    return;
  }

  const exclusionPolys = (floor.exclusions || []).map((e) => e.polygon);
  const grid = buildGrid(activePoints, floor.boundary, TOPO_GRID_TARGET_COLS, exclusionPolys);
  if (!grid) {
    setStatus('Not enough data to build a surface.');
    document.getElementById('diag-panel').style.display = 'none';
    return;
  }
  currentGrid = grid;
  setStatus(null);
  document.getElementById('diag-panel').style.display = 'block';

  const { width: cols, height: rows, values, mask, minValue, maxValue, x0, y0, step } = grid;
  const planW = cols * step;
  const planH = rows * step;
  const planScale = 1 / Math.max(planW, planH);
  const zRange = Math.max(0.001, maxValue - minValue);
  const baseZScale = ((Math.min(planW, planH) * planScale) * 0.15) / zRange;
  zScale = baseZScale;

  const vertIndex = new Int32Array(cols * rows).fill(-1);
  const positions = [];
  const colors = [];
  const baseZArr = [];
  const cx = x0 + planW / 2;
  const cy = y0 + planH / 2;
  const exaggeration = getExaggeration();

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (!mask[idx] || !isFinite(values[idx])) continue;
      const px = x0 + c * step;
      const py = y0 + r * step;
      const v = values[idx];
      const wx = (px - cx) * planScale;
      const wy = -(py - cy) * planScale;
      const wz = (v - minValue) * baseZScale * exaggeration;
      vertIndex[idx] = positions.length / 3;
      positions.push(wx, wy, wz);
      baseZArr.push((v - minValue) * baseZScale);

      const t = clampValue(v, minValue, maxValue);
      const rgb = paletteColor(t, DIAG_PALETTE, DIAG_REVERSE_PALETTE);
      const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(rgb);
      if (m) colors.push(+m[1] / 255, +m[2] / 255, +m[3] / 255);
      else colors.push(1, 1, 1);
    }
  }

  const indices = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = vertIndex[r * cols + c];
      const b = vertIndex[r * cols + (c + 1)];
      const d = vertIndex[(r + 1) * cols + c];
      const e = vertIndex[(r + 1) * cols + (c + 1)];
      if (a < 0 || b < 0 || d < 0 || e < 0) continue;
      indices.push(a, d, b);
      indices.push(b, d, e);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  baseZ = new Float32Array(baseZArr);

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide, flatShading: false,
  });
  mesh = new THREE.Mesh(geom, mat);
  scene.add(mesh);

  controls.target.set(0, 0, 0);
  camera.position.set(0.6, -0.9, 0.7);
  controls.update();

  const group = new THREE.Group();
  const sphereGeom = new THREE.SphereGeometry(planScale * step * 1.5, 12, 10);
  const sphereMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, metalness: 0.2 });
  for (const p of activePoints) {
    const s = new THREE.Mesh(sphereGeom, sphereMat);
    const wx = (p.x - cx) * planScale;
    const wy = -(p.y - cy) * planScale;
    const wz = (p.value - minValue) * baseZScale * exaggeration + planScale * step * 1.5;
    s.position.set(wx, wy, wz);
    group.add(s);
  }
  group.visible = document.getElementById('f-show-points').checked;
  scene.add(group);
  pointsGroup = group;

  document.getElementById('btn-export-png').disabled = false;
}

function pointInsideAnyExclusionFilter(points, exclusions) {
  if (!exclusions || !exclusions.length) return points;
  return points.filter((p) => !pointInsideAnyExclusion(p, exclusions));
}

function getExaggeration() {
  return Number(document.getElementById('f-exaggeration').value) || 1;
}

function applyExaggeration() {
  const exaggeration = getExaggeration();
  document.getElementById('exaggeration-value').textContent = exaggeration.toFixed(1);
  if (!mesh || !baseZ || !currentGrid) return;

  const pos = mesh.geometry.getAttribute('position');
  for (let i = 0; i < baseZ.length; i++) pos.setZ(i, baseZ[i] * exaggeration);
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();

  if (pointsGroup) {
    const { minValue, step, x0, y0, width, height } = currentGrid;
    const planW = width * step;
    const planH = height * step;
    const planScale = 1 / Math.max(planW, planH);
    const cx = x0 + planW / 2;
    const cy = y0 + planH / 2;
    const bump = planScale * step * 1.5;
    let i = 0;
    for (const p of currentActivePoints) {
      const s = pointsGroup.children[i++];
      if (!s) break;
      const wx = (p.x - cx) * planScale;
      const wy = -(p.y - cy) * planScale;
      const wz = (p.value - minValue) * zScale * exaggeration + bump;
      s.position.set(wx, wy, wz);
    }
  }
}

function selectedFloor() {
  const sel = document.getElementById('f-floor-select');
  return diagFloors.find((f) => f.id === sel.value) || diagFloors[0];
}

function populateFloorPicker() {
  const wrap = document.getElementById('diag-floor-picker');
  const sel = document.getElementById('f-floor-select');
  if (diagFloors.length <= 1) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'block';
  sel.innerHTML = diagFloors
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((f) => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name || 'Floor')}</option>`)
    .join('');
  sel.addEventListener('change', () => {
    const floor = selectedFloor();
    if (diagActiveScreen === 'tilt') {
      setTiltFloor(floor);
    } else {
      buildMeshForFloor(floor);
    }
  });
}

// Composes the 3D view's canvas onto a white-backed canvas with a margin,
// so a capture is exhibit-ready straight out of Diagnostics — no manual
// cropping/framing later.
function padCanvasWithWhiteMargin(sourceCanvas, marginPx) {
  const out = document.createElement('canvas');
  out.width = sourceCanvas.width + marginPx * 2;
  out.height = sourceCanvas.height + marginPx * 2;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(sourceCanvas, marginPx, marginPx);
  return out;
}

// ---------- Toolbox cabinet integration (Diagnostics -> Report exhibit) ----------
// Appends the captured image to job.exhibits[] so Report Builder can show it
// without an import step. Diagnostics' own storage (the local download) is
// unaffected; this is an additional write, never a replacement, and is the
// only field this file ever writes — floor/pin data stays untouched.
function saveDiagnosticsExhibit(canvas, label, source) {
  if (!diagJobKey || typeof getJob !== 'function' || typeof saveJob !== 'function') return;
  canvas.toBlob(async (blob) => {
    if (!blob) return;
    try {
      const job = await getJob(diagJobKey);
      if (!job) return;
      job.exhibits = job.exhibits || [];
      job.exhibits.push({
        id: 'exhibit_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        createdAt: Date.now(),
        source: source || 'diagnostics-3d',
        label,
        mimeType: 'image/png',
        blob,
      });
      await saveJob(job);
    } catch (e) {
      console.warn('Toolbox exhibit save failed (local download is unaffected):', e);
    }
  }, 'image/png');
}

// ---------- Tilt / Deflection: canvas + math ----------

function buildTiltPointsForFloor(floor) {
  return diagPoints
    .filter((p) => p.floorId === floor.id)
    .map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      label: p.label || '',
      value: correctedPointValue(p, floor.transitions, floor.transitionGroupAverages),
    }));
}

function computeTiltTransform(points, boundary, cssW, cssH) {
  const xs = [];
  const ys = [];
  (boundary || []).forEach((b) => { xs.push(b.x); ys.push(b.y); });
  points.forEach((p) => { xs.push(p.x); ys.push(p.y); });
  if (!xs.length || !cssW || !cssH) return null;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const padX = spanX * 0.08;
  const padY = spanY * 0.08;
  const fitW = spanX + padX * 2;
  const fitH = spanY + padY * 2;
  const scale = Math.min(cssW / fitW, cssH / fitH);
  const offsetX = (cssW - fitW * scale) / 2 - (minX - padX) * scale;
  const offsetY = (cssH - fitH * scale) / 2 - (minY - padY) * scale;
  return { scale, offsetX, offsetY };
}

function planToCanvas(pt, t) {
  return { x: pt.x * t.scale + t.offsetX, y: pt.y * t.scale + t.offsetY };
}

// Two selected points define a line (A -> B). δ/L along that line is β.
// Any other points within a small perpendicular tolerance of the line are
// treated as lying on it; with 3+ such points, the deflection ratio is the
// largest residual from the straight A-B line (over the intermediate
// points) divided by the A-B span — the usual beam-deflection reading.
function computeTiltLine(idA, idB) {
  const a = tiltPointsAll.find((p) => p.id === idA);
  const b = tiltPointsAll.find((p) => p.id === idB);
  if (!a || !b) return null;
  const pixelLen = Math.hypot(b.x - a.x, b.y - a.y);
  if (pixelLen < 1e-6) return null;

  const scaleInfo = tiltFloor && tiltFloor.scale;
  let inchesPerPixel = null;
  if (scaleInfo && scaleInfo.a && scaleInfo.b && scaleInfo.lengthInches) {
    const calPixelLen = Math.hypot(scaleInfo.b.x - scaleInfo.a.x, scaleInfo.b.y - scaleInfo.a.y);
    if (calPixelLen > 1e-6) inchesPerPixel = scaleInfo.lengthInches / calPixelLen;
  }
  const hasScale = !!inchesPerPixel;
  const realLenInches = hasScale ? pixelLen * inchesPerPixel : null;
  const deltaValue = Math.abs(b.value - a.value);
  const beta = hasScale ? deltaValue / realLenInches : null;

  const dx = (b.x - a.x) / pixelLen;
  const dy = (b.y - a.y) / pixelLen;
  const tolerancePx = Math.max(pixelLen * 0.05, 8);
  const near = [];
  for (const p of tiltPointsAll) {
    const vx = p.x - a.x;
    const vy = p.y - a.y;
    const proj = vx * dx + vy * dy;
    const perp = Math.abs(vx * dy - vy * dx);
    if (perp <= tolerancePx && proj >= -tolerancePx && proj <= pixelLen + tolerancePx) {
      near.push({ ...p, t: proj / pixelLen });
    }
  }
  near.sort((x, y) => x.t - y.t);

  let deflection = null;
  if (hasScale && near.length >= 3) {
    let maxResidual = 0;
    for (const p of near) {
      const expected = a.value + (b.value - a.value) * p.t;
      maxResidual = Math.max(maxResidual, Math.abs(p.value - expected));
    }
    deflection = maxResidual / realLenInches;
  }

  return { a, b, pixelLen, realLenInches, hasScale, deltaValue, beta, nearPoints: near, deflection };
}

function resizeTiltCanvas() {
  if (!tiltCanvas) return;
  const viewport = tiltCanvas.parentElement;
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  tiltCanvas.width = Math.round(w * dpr);
  tiltCanvas.height = Math.round(h * dpr);
  tiltCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderTiltCanvas();
}

function renderTiltCanvas() {
  if (!tiltCtx || !tiltCanvas) return;
  const cssW = tiltCanvas.parentElement.clientWidth;
  const cssH = tiltCanvas.parentElement.clientHeight;
  tiltCtx.clearRect(0, 0, cssW, cssH);
  tiltCtx.fillStyle = '#ffffff';
  tiltCtx.fillRect(0, 0, cssW, cssH);

  if (!tiltFloor || !tiltPointsAll.length) {
    tiltTransform = null;
    tiltCtx.fillStyle = '#8a8378';
    tiltCtx.font = '13px system-ui, sans-serif';
    tiltCtx.textAlign = 'center';
    tiltCtx.fillText('No survey points on this floor.', cssW / 2, cssH / 2);
    return;
  }

  tiltTransform = computeTiltTransform(tiltPointsAll, tiltFloor.boundary, cssW, cssH);
  const t = tiltTransform;
  if (!t) return;

  if (tiltFloor.boundary && tiltFloor.boundary.length >= 3) {
    tiltCtx.beginPath();
    tiltFloor.boundary.forEach((pt, i) => {
      const c = planToCanvas(pt, t);
      if (i === 0) tiltCtx.moveTo(c.x, c.y); else tiltCtx.lineTo(c.x, c.y);
    });
    tiltCtx.closePath();
    tiltCtx.strokeStyle = '#d8d2c4';
    tiltCtx.lineWidth = 1;
    tiltCtx.stroke();
  }

  const selectedPts = tiltSelected.map((id) => tiltPointsAll.find((p) => p.id === id)).filter(Boolean);
  const nearIds = new Set(selectedPts.length === 2 && tiltLineResult ? tiltLineResult.nearPoints.map((p) => p.id) : []);

  if (selectedPts.length === 2) {
    const ca = planToCanvas(selectedPts[0], t);
    const cb = planToCanvas(selectedPts[1], t);
    tiltCtx.beginPath();
    tiltCtx.moveTo(ca.x, ca.y);
    tiltCtx.lineTo(cb.x, cb.y);
    tiltCtx.strokeStyle = '#2a6f4b';
    tiltCtx.lineWidth = 2;
    tiltCtx.stroke();
  }

  for (const p of tiltPointsAll) {
    const c = planToCanvas(p, t);
    const isSelected = tiltSelected.includes(p.id);
    const isNear = nearIds.has(p.id) && !isSelected;
    tiltCtx.beginPath();
    tiltCtx.arc(c.x, c.y, isSelected ? 7 : 5, 0, Math.PI * 2);
    tiltCtx.fillStyle = isSelected ? '#2a6f4b' : (isNear ? '#c98a2c' : '#5b5346');
    tiltCtx.fill();
    if (isSelected) {
      tiltCtx.lineWidth = 2;
      tiltCtx.strokeStyle = '#ffffff';
      tiltCtx.stroke();
    }
    if (p.label) {
      tiltCtx.fillStyle = '#3a352c';
      tiltCtx.font = '11px system-ui, sans-serif';
      tiltCtx.textAlign = 'left';
      tiltCtx.fillText(p.label, c.x + 9, c.y - 9);
    }
  }
}

function formatRatio(x) {
  if (!isFinite(x) || x <= 0) return '—';
  const denom = Math.round(1 / x);
  if (denom > 9999) return '< 1 / 9999 (negligible)';
  return `1 / ${denom}`;
}

function renderTiltResults() {
  const el = document.getElementById('diag-tilt-results');
  if (!el) return;

  if (!tiltPointsAll.length) {
    el.innerHTML = '';
    return;
  }
  if (!tiltSelected.length) {
    el.innerHTML = '<div class="hint" style="margin:0;">Tap a survey point to start a line.</div>';
    return;
  }
  if (tiltSelected.length === 1) {
    const p = tiltPointsAll.find((x) => x.id === tiltSelected[0]);
    el.innerHTML = `<div class="hint" style="margin:0;">Line start: ${escapeHtml(p && p.label ? p.label : 'point')}. Tap a second point.</div>`;
    return;
  }

  const r = tiltLineResult;
  if (!r) { el.innerHTML = ''; return; }

  const rows = [];
  rows.push(`<div class="row-line"><span>Points</span><strong>${escapeHtml(r.a.label || 'A')} → ${escapeHtml(r.b.label || 'B')}</strong></div>`);
  rows.push(`<div class="row-line"><span>Span (L)</span><strong>${r.hasScale ? r.realLenInches.toFixed(1) + ' in' : r.pixelLen.toFixed(0) + ' px — no scale set'}</strong></div>`);
  rows.push(`<div class="row-line"><span>Δ reading</span><strong>${r.deltaValue.toFixed(3)}</strong></div>`);

  let primaryRatio = null;
  if (r.hasScale) {
    rows.push(`<div class="row-line"><span>β = δ/L (tilt)</span><strong>${formatRatio(r.beta)}</strong></div>`);
    if (r.deflection != null) {
      rows.push(`<div class="row-line"><span>Deflection ratio (Δ/L, ${r.nearPoints.length} pts on line)</span><strong>${formatRatio(r.deflection)}</strong></div>`);
      primaryRatio = r.deflection;
    } else {
      rows.push('<div class="row-line"><span>Deflection ratio</span><strong>No other points fall on this line</strong></div>');
      primaryRatio = r.beta;
    }
  } else {
    rows.push('<div class="row-line"><span>β / deflection ratio</span><strong>Set a scale in Floor Survey to compute</strong></div>');
  }

  const pills = TILT_THRESHOLD_DENOMS.map((denom) => {
    let near = false;
    if (primaryRatio) {
      const thresholdRatio = 1 / denom;
      near = primaryRatio >= thresholdRatio / 1.6 && primaryRatio <= thresholdRatio * 1.6;
    }
    return `<span class="${near ? 'near' : ''}">1/${denom}</span>`;
  }).join('');

  el.innerHTML = `
    ${rows.join('')}
    <div class="diag-tilt-thresholds">${pills}</div>
    <div class="hint" style="margin-top:10px;">Reference only — not a structural or legal determination.</div>
  `;
}

function onTiltCanvasClick(evt) {
  if (!tiltTransform || !tiltPointsAll.length) return;
  const rect = tiltCanvas.getBoundingClientRect();
  const cx = evt.clientX - rect.left;
  const cy = evt.clientY - rect.top;
  let best = null;
  let bestDist = Infinity;
  for (const p of tiltPointsAll) {
    const c = planToCanvas(p, tiltTransform);
    const d = Math.hypot(c.x - cx, c.y - cy);
    if (d < bestDist) { bestDist = d; best = p; }
  }
  const HIT_RADIUS = 22;
  if (!best || bestDist > HIT_RADIUS) {
    tiltSelected = [];
    tiltLineResult = null;
  } else if (tiltSelected.length === 2) {
    tiltSelected = [best.id];
    tiltLineResult = null;
  } else if (tiltSelected.includes(best.id)) {
    tiltSelected = tiltSelected.filter((id) => id !== best.id);
    tiltLineResult = null;
  } else {
    tiltSelected.push(best.id);
    if (tiltSelected.length === 2) tiltLineResult = computeTiltLine(tiltSelected[0], tiltSelected[1]);
  }
  renderTiltCanvas();
  renderTiltResults();
}

function initTiltCanvas() {
  tiltCanvas = document.getElementById('diag-tilt-canvas');
  tiltCtx = tiltCanvas.getContext('2d');
  tiltCanvas.addEventListener('click', onTiltCanvasClick);
  tiltResizeObserver = new ResizeObserver(resizeTiltCanvas);
  tiltResizeObserver.observe(tiltCanvas.parentElement);
  resizeTiltCanvas();
}

function setTiltFloor(floor) {
  tiltFloor = floor;
  tiltPointsAll = buildTiltPointsForFloor(floor);
  tiltSelected = [];
  tiltLineResult = null;
  if (!tiltCanvas) initTiltCanvas(); else resizeTiltCanvas();
  renderTiltResults();
  document.getElementById('btn-export-png').disabled = tiltPointsAll.length === 0;
}

function setDiagScreen(screen) {
  const is3d = screen === '3d';
  document.getElementById('diag-3d-view').style.display = is3d ? '' : 'none';
  document.getElementById('diag-tilt-view').style.display = is3d ? 'none' : '';
  document.getElementById('btn-screen-3d').classList.toggle('active', is3d);
  document.getElementById('btn-screen-tilt').classList.toggle('active', !is3d);
  diagActiveScreen = screen;
  if (is3d) {
    document.getElementById('btn-export-png').disabled = !mesh;
  } else {
    setTiltFloor(selectedFloor());
  }
}

async function loadDiagnostics() {
  const params = new URLSearchParams(location.search);
  const key = params.get('job');
  if (!key) { location.href = 'index.html'; return; }
  document.getElementById('back-link').href = `customer.html?job=${encodeURIComponent(key)}`;

  let job;
  try {
    job = await getJob(key);
  } catch (err) {
    document.getElementById('diag-body').innerHTML =
      `<div class="empty-state">Could not open this customer file.<br>${escapeHtml(err.message || String(err))}</div>`;
    return;
  }
  if (!job) { location.href = 'index.html'; return; }
  diagJob = job;
  diagJobKey = key;

  const name = (job.people && job.people.primaryName) || 'Customer';
  document.querySelector('header h1').textContent = `Diagnostics — ${name}`;

  const fs = job.floorSurvey;
  if (!fs || !fs.floors || !fs.floors.length) {
    document.getElementById('diag-floor-picker').style.display = 'none';
    document.getElementById('diag-body').innerHTML = `
      <div class="empty-state">
        No Floor Survey data for this customer yet.<br>
        Capture one in Floor Survey, or import a .floorsurvey.json from their hub.
      </div>`;
    return;
  }

  diagFloors = fs.floors;
  diagPoints = fs.points || [];

  document.getElementById('diag-screen-tabs').style.display = 'flex';
  document.getElementById('btn-screen-3d').addEventListener('click', () => setDiagScreen('3d'));
  document.getElementById('btn-screen-tilt').addEventListener('click', () => setDiagScreen('tilt'));

  populateFloorPicker();
  initThree();
  buildMeshForFloor(selectedFloor());

  document.getElementById('f-exaggeration').addEventListener('input', applyExaggeration);
  document.getElementById('f-show-points').addEventListener('change', (e) => {
    if (pointsGroup) pointsGroup.visible = e.target.checked;
  });
  document.getElementById('btn-export-png').addEventListener('click', () => {
    const floor = selectedFloor();

    if (diagActiveScreen === 'tilt') {
      if (!tiltCanvas) return;
      const padded = padCanvasWithWhiteMargin(tiltCanvas, DIAG_EXHIBIT_MARGIN_PX);
      const dataUrl = padded.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${(floor.name || 'floor').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-tilt.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Toolbox cabinet integration: also store this capture as a Report
      // Builder exhibit — the customer folder, not just a file on the phone.
      saveDiagnosticsExhibit(padded, `${floor.name || 'Floor'} — Tilt / Deflection`, 'diagnostics-tilt');
      return;
    }

    renderer.render(scene, camera);
    const padded = padCanvasWithWhiteMargin(renderer.domElement, DIAG_EXHIBIT_MARGIN_PX);

    // Local download — unchanged behavior, now from the padded/exhibit-ready image.
    const dataUrl = padded.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${(floor.name || 'floor').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-3d.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Toolbox cabinet integration: also store this capture as a Report
    // Builder exhibit — the customer folder, not just a file on the phone.
    saveDiagnosticsExhibit(padded, `${floor.name || 'Floor'} — 3D view`, 'diagnostics-3d');
  });
}

loadDiagnostics();
