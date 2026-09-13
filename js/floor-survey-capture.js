// Floor Survey — native capture: draw a floor's boundary, then tap inside
// it to drop survey points and enter each elevation reading. Stores into
// the exact same job.floorSurvey.{floors,points} shape the CSV/JSON import
// bridge already produces (each floor/point tagged origin:'native' vs
// 'import'), so a floor captured here needs zero changes to show up
// correctly in Diagnostics' 3D view or Report Builder's H/L/Δ — both
// already read job.floorSurvey generically.
//
// v1 scope, on purpose: no scale calibration, and native capture always
// creates its OWN new floor rather than adding points to an
// already-imported one (avoids ambiguous shared ownership of a floor's
// boundary/plan across two very different sources). Flooring transitions
// and exclusion zones ARE supported — both are real, shipped
// infrastructure already consumed by Diagnostics/topo-grid.js, so
// skipping capture here would leave native floors unable to represent
// data the rest of the app already knows how to render correctly.

// Real vocabulary from floor/src/lib/transitions.ts's COMMON_SURFACES —
// kept identical rather than invented, so a surface name here means the
// same thing it would in the real app.
const FS_COMMON_SURFACES = [
  'Tile', 'Hardwood', 'Engineered wood', 'Laminate', 'LVP', 'Vinyl sheet',
  'Linoleum', 'Concrete/slab', 'Carpet/slab', 'Subfloor', 'Carpet/subfloor', 'Other',
];

let fsJob = null;
let fsJobKey = null;
let fsSelectedFloorId = null;
let fsSelectedPointId = null;
let fsMode = 'boundary'; // 'boundary' | 'points'
let fsPendingBoundary = [];
let fsDrawingExclusion = false;
let fsPendingExclusion = [];
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

// fsJob is loaded once at page load and every mutator below patches it
// in place (fsAllFloors()/fsAllPoints() always return references into
// the SAME live fsJob.floorSurvey, never a copy) — so fsJob is always the
// complete, current, correct state for this screen's own data, no re-read
// needed. An earlier version re-fetched the job from IndexedDB on every
// single save to protect against another screen's concurrent edit to a
// field this screen doesn't own; in practice that turned the save into a
// read-modify-write, and two of those firing from one interaction (e.g. a
// value field's blur-triggered save racing a transition tag's own save)
// could let a save built from an earlier snapshot commit last, silently
// dropping the other's change — reproduced deterministically, and still
// residually raceable under heavy load even after queuing/coalescing the
// calls. Writing the live fsJob directly removes the read side of that
// race entirely: every save is unconditionally built from the one
// ever-current object, so there is no earlier snapshot left to overwrite
// with. Still queued so rapid saves don't pile up redundant writes.
let __fsSaveQueue = Promise.resolve();
let __fsSavesInFlight = 0;
function fsSave() {
  __fsSavesInFlight += 1;
  __fsSaveQueue = __fsSaveQueue.then(async () => {
    fsJob.floorSurvey = {
      ...(fsJob.floorSurvey || {}),
      floors: fsAllFloors(),
      points: fsAllPoints(),
      updatedAt: Date.now(),
    };
    await saveJob(fsJob);
  }).finally(() => { __fsSavesInFlight -= 1; });
  return __fsSaveQueue;
}

// Link clicks are covered by the click-interceptor below, but a reload,
// browser-back, or closing the tab bypasses that entirely — there's no
// click to intercept. beforeunload can't reliably await an async save,
// but it CAN block navigation with the browser's own confirmation prompt
// while a save is still in flight, buying it time to actually commit
// instead of silently losing the edit.
window.addEventListener('beforeunload', (e) => {
  if (__fsSavesInFlight > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});

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
  // Select and render before awaiting the save — see the matching comment
  // in fsCreatePointAt for why this ordering matters.
  fsSelectedFloorId = floor.id;
  fsHideNewFloorForm();
  fsRenderAll();
  await fsSave();
}

function fsShowNewFloorForm() {
  document.getElementById('fs-new-floor-form').style.display = 'flex';
  document.getElementById('fs-floor-picker').style.display = 'none';
  document.getElementById('fs-floor-actions').style.display = 'none';
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
  const actions = document.getElementById('fs-floor-actions');
  const sel = document.getElementById('f-fs-floor-select');
  const floors = fsNativeFloors().slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!floors.length) {
    wrap.style.display = 'none';
    actions.style.display = 'none';
    return;
  }
  wrap.style.display = 'flex';
  actions.style.display = 'flex';
  sel.innerHTML = floors.map((f) => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)}</option>`).join('');
  if (!fsSelectedFloorId || !floors.some((f) => f.id === fsSelectedFloorId)) {
    fsSelectedFloorId = floors[0].id;
  }
  sel.value = fsSelectedFloorId;
}

async function fsRenameFloor() {
  const floor = fsFloor(fsSelectedFloorId);
  if (!floor) return;
  const name = prompt('Rename this floor', floor.name);
  if (name == null) return; // cancelled
  const trimmed = name.trim();
  if (!trimmed) { showToast('Floor name cannot be blank'); return; }
  floor.name = trimmed;
  await fsSave();
  fsRenderFloorPicker();
}

async function fsDeleteFloor() {
  const floor = fsFloor(fsSelectedFloorId);
  if (!floor) return;
  if (!confirm(`Delete "${floor.name}" and all ${fsFloorPoints(floor.id).length} of its points? This can't be undone.`)) return;
  const floors = fsAllFloors().filter((f) => f.id !== floor.id);
  const points = fsAllPoints().filter((p) => p.floorId !== floor.id);
  fsJob.floorSurvey = { ...(fsJob.floorSurvey || {}), floors, points };
  fsSelectedFloorId = null;
  fsSelectedPointId = null;
  fsPendingBoundary = [];
  fsDrawingExclusion = false;
  fsPendingExclusion = [];
  await fsSave();
  if (fsNativeFloors().length) {
    fsSelectedFloorId = fsNativeFloors().slice().sort((a, b) => (a.order || 0) - (b.order || 0))[0].id;
    fsRenderAll();
  } else {
    fsShowNewFloorForm();
  }
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
  document.getElementById('fs-boundary-controls').style.display = (!fsDrawingExclusion && fsMode === 'boundary') ? 'flex' : 'none';
  document.getElementById('fs-points-controls').style.display = (!fsDrawingExclusion && fsMode === 'points') ? 'flex' : 'none';
  document.getElementById('fs-exclusion-controls').style.display = fsDrawingExclusion ? 'flex' : 'none';
  document.getElementById('btn-fs-finish-boundary').disabled = fsPendingBoundary.length < 3;
  document.getElementById('btn-fs-finish-exclusion').disabled = fsPendingExclusion.length < 3;
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
  ((floor && floor.exclusions) || []).forEach((ex) => {
    html += `<polygon class="fs-exclusion-line" points="${ex.polygon.map((p) => `${p.x},${p.y}`).join(' ')}"></polygon>`;
  });
  if (fsMode === 'boundary' && !fsDrawingExclusion && fsPendingBoundary.length) {
    html += `<polyline class="fs-boundary-line" style="fill:none;" points="${fsPendingBoundary.map((p) => `${p.x},${p.y}`).join(' ')}"></polyline>`;
    fsPendingBoundary.forEach((p) => {
      html += `<circle class="fs-vertex" cx="${p.x}" cy="${p.y}" r="0.012"></circle>`;
    });
  }
  if (fsDrawingExclusion && fsPendingExclusion.length) {
    html += `<polyline class="fs-exclusion-line" style="fill:none;" points="${fsPendingExclusion.map((p) => `${p.x},${p.y}`).join(' ')}"></polyline>`;
    fsPendingExclusion.forEach((p) => {
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
  fsRenderTransitionSection(p);
}

function fsTransitionLabel(floor, id) {
  const t = (floor.transitions || []).find((x) => x.id === id);
  return t ? `${t.surfaceA} → ${t.surfaceB}` : null;
}

function fsRenderTransitionSection(p) {
  const floor = fsFloor(fsSelectedFloorId);
  const normalWrap = document.getElementById('fs-transition-normal');
  const anchorInfo = document.getElementById('fs-transition-anchor-info');
  const newForm = document.getElementById('fs-new-transition-form');
  if (!floor) return;

  if (p.isTransitionAnchor) {
    normalWrap.style.display = 'none';
    newForm.style.display = 'none';
    const t = (floor.transitions || []).find((x) => x.id === p.transitionId);
    anchorInfo.style.display = 'block';
    anchorInfo.textContent = t
      ? `Doorway anchor: ${t.surfaceA} → ${t.surfaceB} (B reading ${t.readingB.toFixed(2)}")`
      : 'Doorway anchor (transition record missing)';
    return;
  }

  anchorInfo.style.display = 'none';
  normalWrap.style.display = 'block';
  newForm.style.display = 'none';
  const sel = document.getElementById('f-fs-transition');
  const options = ['<option value="">— none —</option>', '<option value="__new__">+ New transition anchor here</option>']
    .concat((floor.transitions || []).map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.surfaceA)} → ${escapeHtml(t.surfaceB)}</option>`));
  sel.innerHTML = options.join('');
  sel.value = p.transitionId || '';
}

function fsPopulateSurfaceSelect(sel) {
  sel.innerHTML = FS_COMMON_SURFACES.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
}

async function fsHandleTransitionSelectChange(value) {
  const p = fsPoint(fsSelectedPointId);
  if (!p) return;
  if (value === '__new__') {
    document.getElementById('fs-new-transition-form').style.display = 'block';
    fsPopulateSurfaceSelect(document.getElementById('f-fs-surface-a'));
    fsPopulateSurfaceSelect(document.getElementById('f-fs-surface-b'));
    document.getElementById('f-fs-surface-a-other').style.display = 'none';
    document.getElementById('f-fs-surface-b-other').style.display = 'none';
    document.getElementById('f-fs-reading-b').value = '';
    return;
  }
  document.getElementById('fs-new-transition-form').style.display = 'none';
  p.transitionId = value || undefined;
  p.isTransitionAnchor = false;
  await fsSave();
  fsRenderPointList();
}

async function fsCreateTransition() {
  const p = fsPoint(fsSelectedPointId);
  const floor = fsFloor(fsSelectedFloorId);
  if (!p || !floor) return;
  const selA = document.getElementById('f-fs-surface-a');
  const selB = document.getElementById('f-fs-surface-b');
  const surfaceA = selA.value === 'Other' ? document.getElementById('f-fs-surface-a-other').value.trim() : selA.value;
  const surfaceB = selB.value === 'Other' ? document.getElementById('f-fs-surface-b-other').value.trim() : selB.value;
  const readingB = parseFloat(document.getElementById('f-fs-reading-b').value);
  if (!surfaceA || !surfaceB) { showToast('Enter both surfaces'); return; }
  if (isNaN(readingB)) { showToast('Enter a reading for the B side'); return; }

  const t = {
    id: 'trans_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    x: p.x, y: p.y,
    surfaceA, surfaceB,
    readingA: p.value,
    readingB,
    createdAt: Date.now(),
  };
  floor.transitions = floor.transitions || [];
  floor.transitions.push(t);
  p.isTransitionAnchor = true;
  p.transitionId = t.id;
  await fsSave();
  fsRenderEditor();
  fsRenderPointList();
}

function fsRenderPointList() {
  const list = document.getElementById('fs-point-list');
  const floor = fsFloor(fsSelectedFloorId);
  const points = floor ? fsFloorPoints(floor.id).slice().sort((a, b) => a.index - b.index) : [];
  if (!points.length) {
    list.innerHTML = '<div class="hint" style="margin:0;">No points yet — finish the boundary, then tap inside it to drop one.</div>';
    return;
  }
  list.innerHTML = points.map((p) => {
    let extra = '';
    if (p.isTransitionAnchor) {
      const label = fsTransitionLabel(floor, p.transitionId);
      extra = label ? ` · anchor (${escapeHtml(label)})` : ' · anchor';
    } else if (p.transitionId) {
      const label = fsTransitionLabel(floor, p.transitionId);
      if (label) extra = ` · via ${escapeHtml(label)}`;
    }
    return `
    <div class="fs-point-row${p.id === fsSelectedPointId ? ' selected' : ''}" data-id="${escapeHtml(p.id)}">
      <div class="fs-badge${p.isBasePoint ? ' base' : ''}">${escapeHtml(String(p.index))}</div>
      <div class="fs-meta">${p.value.toFixed(2)}"${p.label ? ' · ' + escapeHtml(p.label) : ''}${extra}</div>
    </div>`;
  }).join('');
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
  fsRenderExclusionList();
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
  // Select and render before awaiting the save — a fast follow-up edit
  // (typing a value, tagging a transition) must never land on a stale
  // fsSelectedPointId from the brief window while the write is in flight.
  fsSelectedPointId = point.id;
  fsRenderOverlay();
  fsRenderEditor();
  fsRenderPointList();
  await fsSave();
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

  if (fsDrawingExclusion) {
    fsPendingExclusion.push({ x, y });
    fsRenderOverlay();
    document.getElementById('btn-fs-finish-exclusion').disabled = fsPendingExclusion.length < 3;
    return;
  }

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

function fsStartExclusion() {
  fsDrawingExclusion = true;
  fsPendingExclusion = [];
  fsSelectedPointId = null;
  fsUpdateModeUI();
  fsRenderEditor();
  fsRenderOverlay();
}

function fsCancelExclusion() {
  fsDrawingExclusion = false;
  fsPendingExclusion = [];
  fsUpdateModeUI();
  fsRenderOverlay();
}

function fsUndoExclusionVertex() {
  fsPendingExclusion.pop();
  fsRenderOverlay();
  document.getElementById('btn-fs-finish-exclusion').disabled = fsPendingExclusion.length < 3;
}

async function fsFinishExclusion() {
  const floor = fsFloor(fsSelectedFloorId);
  if (!floor || fsPendingExclusion.length < 3) return;
  const exclusion = {
    id: 'excl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    polygon: fsPendingExclusion.slice(),
    createdAt: Date.now(),
  };
  floor.exclusions = floor.exclusions || [];
  floor.exclusions.push(exclusion);
  fsDrawingExclusion = false;
  fsPendingExclusion = [];
  await fsSave();
  fsUpdateModeUI();
  fsRenderOverlay();
  fsRenderExclusionList();
}

async function fsDeleteExclusion(id) {
  const floor = fsFloor(fsSelectedFloorId);
  if (!floor) return;
  if (!confirm('Delete this exclusion zone?')) return;
  floor.exclusions = (floor.exclusions || []).filter((ex) => ex.id !== id);
  await fsSave();
  fsRenderOverlay();
  fsRenderExclusionList();
}

function fsRenderExclusionList() {
  const list = document.getElementById('fs-exclusion-list');
  const floor = fsFloor(fsSelectedFloorId);
  const exclusions = (floor && floor.exclusions) || [];
  if (!exclusions.length) {
    list.innerHTML = '<div class="hint" style="margin:0;">None yet.</div>';
    return;
  }
  list.innerHTML = exclusions.map((ex, i) => `
    <div class="fs-exclusion-row">
      <div class="fs-meta">Zone ${i + 1} (${ex.polygon.length}-point polygon)</div>
      <button type="button" class="btn btn-danger" data-id="${escapeHtml(ex.id)}">Delete</button>
    </div>`).join('');
  list.querySelectorAll('button[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => fsDeleteExclusion(btn.getAttribute('data-id')));
  });
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
  document.getElementById('btn-fs-rename-floor').addEventListener('click', fsRenameFloor);
  document.getElementById('btn-fs-delete-floor').addEventListener('click', fsDeleteFloor);
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
    fsDrawingExclusion = false;
    fsPendingExclusion = [];
    fsSelectedPointId = null;
    fsRenderAll();
  });
  document.getElementById('btn-fs-undo-vertex').addEventListener('click', fsUndoVertex);
  document.getElementById('btn-fs-finish-boundary').addEventListener('click', fsFinishBoundary);
  document.getElementById('btn-fs-redraw-boundary').addEventListener('click', fsRedrawBoundary);
  document.getElementById('btn-fs-add-exclusion').addEventListener('click', fsStartExclusion);
  document.getElementById('btn-fs-cancel-exclusion').addEventListener('click', fsCancelExclusion);
  document.getElementById('btn-fs-undo-exclusion-vertex').addEventListener('click', fsUndoExclusionVertex);
  document.getElementById('btn-fs-finish-exclusion').addEventListener('click', fsFinishExclusion);
  document.getElementById('btn-fs-done').addEventListener('click', () => fsSelectPoint(null));
  document.getElementById('btn-fs-delete').addEventListener('click', fsDeletePoint);
  document.getElementById('f-fs-value').addEventListener('input', (e) => fsUpdateValueLocal(e.target.value));
  document.getElementById('f-fs-value').addEventListener('change', fsSaveValue);
  document.getElementById('f-fs-label').addEventListener('input', (e) => fsUpdateLabelLocal(e.target.value));
  document.getElementById('f-fs-label').addEventListener('change', fsSaveLabel);
  document.getElementById('f-fs-transition').addEventListener('change', (e) => fsHandleTransitionSelectChange(e.target.value));
  document.getElementById('f-fs-surface-a').addEventListener('change', (e) => {
    document.getElementById('f-fs-surface-a-other').style.display = e.target.value === 'Other' ? 'block' : 'none';
  });
  document.getElementById('f-fs-surface-b').addEventListener('change', (e) => {
    document.getElementById('f-fs-surface-b-other').style.display = e.target.value === 'Other' ? 'block' : 'none';
  });
  document.getElementById('btn-fs-create-transition').addEventListener('click', fsCreateTransition);

  if (!fsNativeFloors().length) {
    fsShowNewFloorForm();
  } else {
    fsSelectedFloorId = fsNativeFloors().slice().sort((a, b) => (a.order || 0) - (b.order || 0))[0].id;
    fsRenderAll();
  }
}

// A save fired by the click that's navigating away (e.g. a value field's
// blur-triggered save right before the back link is clicked) can still be
// mid-flight — its IndexedDB transaction not yet committed — when the page
// starts unloading, silently dropping that edit. Same bug class fixed
// earlier this session for voice memo recording (customer.js): intercept
// every link click, wait for whatever's currently queued in __fsSaveQueue
// (already-resolved if nothing is pending, so this costs nothing when
// idle), then navigate manually.
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href]');
  if (!link) return;
  e.preventDefault();
  const destination = link.href;
  __fsSaveQueue.then(() => { location.href = destination; });
}, true);

loadFloorSurveyCapture();
