// Floor Survey — native capture: draw a floor's boundary, then tap inside
// it to drop survey points and enter each elevation reading. Stores into
// the exact same job.floorSurvey.{floors,points} shape the CSV/JSON import
// bridge already produces (each floor/point tagged origin:'native' vs
// 'import'), so a floor captured here needs zero changes to show up
// correctly in Diagnostics' 3D view or Report Builder's H/L/Δ — both
// already read job.floorSurvey generically.
//
// v1 scope, on purpose: no transitions, no exclusions, no scale
// calibration, and native capture always creates its OWN new floor rather
// than adding points to an already-imported one (avoids ambiguous shared
// ownership of a floor's boundary/plan across two very different sources).

let fsJob = null;
let fsJobKey = null;
let fsSelectedFloorId = null;
let fsSelectedPointId = null;
let fsMode = 'boundary'; // 'boundary' | 'points'
let fsPendingBoundary = [];
let fsPlanUrl = null;
let fsNewFloorPlanBlob = null;

function fsAllFloors() {
  return (fsJob.floorSurvey && fsJob.floorSurvey.floors) || [];
}
function fsAllPoints() {
  return (fsJob.floorSurvey && fsJob.floorSurvey.points) || [];
}
function fsNativeFloors() {
  return fsAllFloors().filter((f) => f.origin === 'native');
}
function fsFloor(id) {
  return fsAllFloors().find((f) => f.id === id);
}
function fsFloorPoints(floorId) {
  return fsAllPoints().filter((p) => p.floorId === floorId);
}
function fsPoint(id) {
  return fsAllPoints().find((p) => p.id === id);
}

async function fsSave() {
  const fresh = await getJob(fsJobKey);
  const job = fresh || fsJob;
  job.floorSurvey = {
    ...(job.floorSurvey || {}),
    floors: fsAllFloors(),
    points: fsAllPoints(),
    updatedAt: Date.now(),
  };
  await saveJob(job);
  fsJob = job;
}

// ---------- Floor management ----------

async function fsCreateFloor(name, planBlob) {
  const floor = {
    id: 'floor_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name: (name || '').trim() || 'Floor',
    order: fsAllFloors().length,
    boundary: [],
    planImageBlob: planBlob || null,
    origin: 'native',
  };
  const floors = fsAllFloors();
  floors.push(floor);
  fsJob.floorSurvey = { ...(fsJob.floorSurvey || {}), floors, points: fsAllPoints() };
  await fsSave();
  fsSelectedFloorId = floor.id;
  fsHideNewFloorForm();
  fsRenderAll();
}

function fsShowNewFloorForm() {
  document.getElementById('fs-new-floor-form').style.display = 'flex';
  document.getElementById('fs-floor-picker').style.display = 'none';
  document.getElementById('fs-body').style.display = 'none';
  document.getElementById('f-fs-floor-name').value = '';
  document.getElementById('fs-new-plan-preview').innerHTML = '';
  fsNewFloorPlanBlob = null;
}

function fsHideNewFloorForm() {
  document.getElementById('fs-new-floor-form').style.display = 'none';
  document.getElementById('fs-body').style.display = 'block';
}

// ---------- Rendering ----------

function fsRenderFloorPicker() {
  const wrap = document.getElementById('fs-floor-picker');
  const sel = document.getElementById('f-fs-floor-select');
  const floors = fsNativeFloors().slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!floors.length) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'flex';
  sel.innerHTML = floors.map((f) => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)}</option>`).join('');
  if (!fsSelectedFloorId || !floors.some((f) => f.id === fsSelectedFloorId)) {
    fsSelectedFloorId = floors[0].id;
  }
  sel.value = fsSelectedFloorId;
}

function fsRenderPlan() {
  const wrap = document.getElementById('fs-plan-wrap');
  const floor = fsFloor(fsSelectedFloorId);
  if (fsPlanUrl) { URL.revokeObjectURL(fsPlanUrl); fsPlanUrl = null; }
  if (!floor || !floor.planImageBlob) {
    wrap.innerHTML = '<div class="plan-photo-placeholder">No plan photo for this floor</div>';
    return;
  }
  fsPlanUrl = URL.createObjectURL(floor.planImageBlob);
  wrap.innerHTML = `<img src="${fsPlanUrl}" alt="Plan photo"><svg class="fs-svg-overlay" viewBox="0 0 1 1" preserveAspectRatio="none"></svg>`;
}

function fsUpdateModeUI() {
  const floor = fsFloor(fsSelectedFloorId);
  const hasBoundary = !!(floor && floor.boundary && floor.boundary.length >= 3);
  fsMode = hasBoundary ? 'points' : 'boundary';
  document.getElementById('fs-boundary-controls').style.display = fsMode === 'boundary' ? 'flex' : 'none';
  document.getElementById('fs-points-controls').style.display = fsMode === 'points' ? 'flex' : 'none';
  document.getElementById('btn-fs-finish-boundary').disabled = fsPendingBoundary.length < 3;
}

function fsRenderOverlay() {
  const svg = document.querySelector('#fs-plan-wrap svg.fs-svg-overlay');
  if (!svg) return;
  const floor = fsFloor(fsSelectedFloorId);
  let html = '';

  const boundary = (floor && floor.boundary) || [];
  if (boundary.length >= 3) {
    html += `<polygon class="fs-boundary-line" points="${boundary.map((p) => `${p.x},${p.y}`).join(' ')}"></polygon>`;
  }
  if (fsMode === 'boundary' && fsPendingBoundary.length) {
    html += `<polyline class="fs-boundary-line" style="fill:none;" points="${fsPendingBoundary.map((p) => `${p.x},${p.y}`).join(' ')}"></polyline>`;
    fsPendingBoundary.forEach((p) => {
      html += `<circle class="fs-vertex" cx="${p.x}" cy="${p.y}" r="0.012"></circle>`;
    });
  }
  if (floor) {
    fsFloorPoints(floor.id).forEach((p) => {
      const cls = 'fs-point' + (p.isBasePoint ? ' base' : '') + (p.id === fsSelectedPointId ? ' selected' : '');
      html += `<circle class="${cls}" data-id="${escapeHtml(p.id)}" cx="${p.x}" cy="${p.y}" r="0.014"></circle>`;
    });
  }
  svg.innerHTML = html;
  svg.querySelectorAll('.fs-point').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      fsSelectPoint(el.getAttribute('data-id'));
    });
  });
}

function fsRenderEditor() {
  const editor = document.getElementById('fs-editor');
  const p = fsSelectedPointId && fsPoint(fsSelectedPointId);
  if (!p) { editor.style.display = 'none'; return; }
  editor.style.display = 'block';
  document.getElementById('fs-editor-title').textContent = `Point #${p.index}` + (p.isBasePoint ? ' (Base Point)' : '');
  document.getElementById('f-fs-value').value = p.value;
  document.getElementById('f-fs-label').value = p.label || '';
}

function fsRenderPointList() {
  const list = document.getElementById('fs-point-list');
  const floor = fsFloor(fsSelectedFloorId);
  const points = floor ? fsFloorPoints(floor.id).slice().sort((a, b) => a.index - b.index) : [];
  if (!points.length) {
    list.innerHTML = '<div class="hint" style="margin:0;">No points yet — finish the boundary, then tap inside it to drop one.</div>';
    return;
  }
  list.innerHTML = points.map((p) => `
    <div class="fs-point-row${p.id === fsSelectedPointId ? ' selected' : ''}" data-id="${escapeHtml(p.id)}">
      <div class="fs-badge${p.isBasePoint ? ' base' : ''}">${escapeHtml(String(p.index))}</div>
      <div class="fs-meta">${p.value.toFixed(2)}"${p.label ? ' · ' + escapeHtml(p.label) : ''}</div>
    </div>`).join('');
  list.querySelectorAll('.fs-point-row').forEach((row) => {
    row.addEventListener('click', () => fsSelectPoint(row.getAttribute('data-id')));
  });
}

function fsRenderAll() {
  fsRenderFloorPicker();
  fsRenderPlan();
  fsUpdateModeUI();
  fsRenderOverlay();
  fsRenderEditor();
  fsRenderPointList();
}

// ---------- Interaction ----------

function fsSelectPoint(id) {
  fsSelectedPointId = id;
  fsRenderOverlay();
  fsRenderEditor();
  fsRenderPointList();
}

async function fsCreatePointAt(floor, x, y) {
  const existing = fsFloorPoints(floor.id);
  const isFirst = existing.length === 0;
  const point = {
    id: 'pt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    floorId: floor.id,
    index: existing.length + 1,
    x, y,
    value: 9.0,
    isBasePoint: isFirst,
    label: isFirst ? 'BP1' : '',
    origin: 'native',
  };
  const points = fsAllPoints();
  points.push(point);
  fsJob.floorSurvey = { ...(fsJob.floorSurvey || {}), points };
  await fsSave();
  fsSelectPoint(point.id);
  fsRenderPointList();
}

function fsHandlePlanClick(e) {
  if (e.target.closest('.fs-point')) return;
  const floor = fsFloor(fsSelectedFloorId);
  if (!floor) return;
  const img = document.querySelector('#fs-plan-wrap img');
  if (!img) return;
  const rect = img.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;

  if (fsMode === 'boundary') {
    fsPendingBoundary.push({ x, y });
    fsRenderOverlay();
    document.getElementById('btn-fs-finish-boundary').disabled = fsPendingBoundary.length < 3;
  } else {
    if (!topoPointInPolygon(x, y, floor.boundary)) {
      showToast('Tap inside the boundary to add a point');
      return;
    }
    fsCreatePointAt(floor, x, y);
  }
}

async function fsFinishBoundary() {
  const floor = fsFloor(fsSelectedFloorId);
  if (!floor || fsPendingBoundary.length < 3) return;
  floor.boundary = fsPendingBoundary.slice();
  fsPendingBoundary = [];
  await fsSave();
  fsUpdateModeUI();
  fsRenderOverlay();
  fsRenderPointList();
}

function fsUndoVertex() {
  fsPendingBoundary.pop();
  fsRenderOverlay();
  document.getElementById('btn-fs-finish-boundary').disabled = fsPendingBoundary.length < 3;
}

async function fsRedrawBoundary() {
  const floor = fsFloor(fsSelectedFloorId);
  if (!floor) return;
  if (!confirm("Redraw this floor's boundary? Existing points stay where they are.")) return;
  floor.boundary = [];
  fsPendingBoundary = [];
  fsSelectedPointId = null;
  await fsSave();
  fsUpdateModeUI();
  fsRenderOverlay();
  fsRenderEditor();
}

function fsUpdateValueLocal(text) {
  const p = fsPoint(fsSelectedPointId);
  if (!p) return;
  const num = parseFloat(text);
  if (!isNaN(num)) p.value = num;
}
async function fsSaveValue() {
  await fsSave();
  fsRenderPointList();
  fsRenderOverlay();
}

function fsUpdateLabelLocal(text) {
  const p = fsPoint(fsSelectedPointId);
  if (!p) return;
  p.label = text;
}
async function fsSaveLabel() {
  await fsSave();
  fsRenderPointList();
}

async function fsDeletePoint() {
  const p = fsPoint(fsSelectedPointId);
  if (!p) return;
  if (!confirm('Delete this point?')) return;
  const points = fsAllPoints().filter((x) => x.id !== p.id);
  fsJob.floorSurvey = { ...(fsJob.floorSurvey || {}), points };
  fsSelectedPointId = null;
  await fsSave();
  fsRenderOverlay();
  fsRenderEditor();
  fsRenderPointList();
}

// ---------- Boot ----------

async function loadFloorSurveyCapture() {
  const params = new URLSearchParams(location.search);
  const key = params.get('job');
  if (!key) { location.href = 'index.html'; return; }
  fsJobKey = key;
  document.getElementById('back-link').href = `customer.html?job=${encodeURIComponent(key)}`;

  let job;
  try {
    job = await getJob(key);
  } catch (err) {
    document.getElementById('fs-body').innerHTML =
      `<div class="empty-state">Could not open this customer file.<br>${escapeHtml(err.message || String(err))}</div>`;
    return;
  }
  if (!job) { location.href = 'index.html'; return; }
  fsJob = job;

  const name = (job.people && job.people.primaryName) || 'Customer';
  document.querySelector('header h1').textContent = `Floor Survey — ${name}`;

  document.getElementById('fs-plan-wrap').addEventListener('click', fsHandlePlanClick);
  document.getElementById('btn-fs-new-floor').addEventListener('click', fsShowNewFloorForm);
  document.getElementById('btn-fs-cancel-floor').addEventListener('click', () => {
    fsHideNewFloorForm();
    fsRenderAll();
  });
  document.getElementById('btn-fs-add-plan').addEventListener('click', () => document.getElementById('f-fs-plan-input').click());
  document.getElementById('f-fs-plan-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    fsNewFloorPlanBlob = file;
    const url = URL.createObjectURL(file);
    document.getElementById('fs-new-plan-preview').innerHTML = `<img src="${url}" style="max-width:100%;border-radius:8px;">`;
  });
  document.getElementById('btn-fs-create-floor').addEventListener('click', () => {
    const nameVal = document.getElementById('f-fs-floor-name').value;
    fsCreateFloor(nameVal, fsNewFloorPlanBlob);
  });
  document.getElementById('f-fs-floor-select').addEventListener('change', (e) => {
    fsSelectedFloorId = e.target.value;
    fsPendingBoundary = [];
    fsSelectedPointId = null;
    fsRenderAll();
  });
  document.getElementById('btn-fs-undo-vertex').addEventListener('click', fsUndoVertex);
  document.getElementById('btn-fs-finish-boundary').addEventListener('click', fsFinishBoundary);
  document.getElementById('btn-fs-redraw-boundary').addEventListener('click', fsRedrawBoundary);
  document.getElementById('btn-fs-done').addEventListener('click', () => fsSelectPoint(null));
  document.getElementById('btn-fs-delete').addEventListener('click', fsDeletePoint);
  document.getElementById('f-fs-value').addEventListener('input', (e) => fsUpdateValueLocal(e.target.value));
  document.getElementById('f-fs-value').addEventListener('change', fsSaveValue);
  document.getElementById('f-fs-label').addEventListener('input', (e) => fsUpdateLabelLocal(e.target.value));
  document.getElementById('f-fs-label').addEventListener('change', fsSaveLabel);

  if (!fsNativeFloors().length) {
    fsShowNewFloorForm();
  } else {
    fsSelectedFloorId = fsNativeFloors().slice().sort((a, b) => (a.order || 0) - (b.order || 0))[0].id;
    fsRenderAll();
  }
}

loadFloorSurveyCapture();
