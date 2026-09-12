// Distress Survey — native pin capture. Tap the plan to drop a pin; the
// pin's compass direction is computed automatically from the front door
// set during job setup (js/distress-math.js), matching the real app's
// approach rather than asking the user to guess a compass heading.
// Coexists with pins brought in via the CSV import bridge: new pins number
// from whatever the current highest pin number already is.

let dsJob = null;
let dsJobKey = null;
let dsPlanUrl = null;
let dsPhotoUrls = new Map(); // pin.id -> [objectUrl, ...], rebuilt on render
let dsSelectedId = null;

function dsPins() {
  return (dsJob.distressSurvey && dsJob.distressSurvey.pins) || [];
}

async function dsSave() {
  const fresh = await getJob(dsJobKey);
  const job = fresh || dsJob;
  job.distressSurvey = {
    ...(job.distressSurvey || {}),
    pins: dsPins(),
    updatedAt: Date.now(),
  };
  await saveJob(job);
  dsJob = job;
}

function dsNextPinNumber() {
  const pins = dsPins();
  if (!pins.length) return 1;
  return Math.max(...pins.map((p) => p.pin || 0)) + 1;
}

function dsRenderMarkers() {
  const wrap = document.getElementById('ds-plan-wrap');
  wrap.querySelectorAll('.ds-pin').forEach((el) => el.remove());
  dsPins().forEach((p) => {
    const dot = document.createElement('div');
    dot.className = 'ds-pin' + (p.type === 'Exterior' ? ' exterior' : '') + (p.id === dsSelectedId ? ' selected' : '');
    dot.style.left = `${p.x * 100}%`;
    dot.style.top = `${p.y * 100}%`;
    dot.textContent = String(p.pin);
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      dsSelectPin(p.id);
    });
    wrap.appendChild(dot);
  });
}

function dsRenderRoomOptions(selectedRoom) {
  const sel = document.getElementById('f-ds-room');
  const rooms = dsJob.rooms || [];
  sel.innerHTML = '<option value="">—</option>' +
    rooms.map((r) => `<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`).join('');
  sel.value = selectedRoom || '';
}

function dsPin(id) {
  return dsPins().find((p) => p.id === id);
}

function dsRenderEditor() {
  const editor = document.getElementById('ds-editor');
  const p = dsSelectedId && dsPin(dsSelectedId);
  if (!p) { editor.style.display = 'none'; return; }
  editor.style.display = 'block';

  document.getElementById('ds-editor-title').textContent =
    `Pin #${p.pin}` + (p.direction ? ` — ${p.direction}` : '');
  document.getElementById('btn-ds-interior').classList.toggle('active', p.type !== 'Exterior');
  document.getElementById('btn-ds-exterior').classList.toggle('active', p.type === 'Exterior');
  dsRenderRoomOptions(p.room);
  document.getElementById('f-ds-desc').value = p.description || '';

  const strip = document.getElementById('ds-photo-strip');
  strip.innerHTML = '';
  (dsPhotoUrls.get(p.id) || []).forEach((u) => URL.revokeObjectURL(u));
  const urls = (p.photos || []).map((blob) => URL.createObjectURL(blob));
  dsPhotoUrls.set(p.id, urls);
  urls.forEach((url, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'ds-photo-thumb';
    thumb.innerHTML = `<img src="${url}"><button type="button" aria-label="Remove photo">×</button>`;
    thumb.querySelector('button').addEventListener('click', () => dsRemovePhoto(p.id, i));
    strip.appendChild(thumb);
  });
}

function dsRenderPinList() {
  const list = document.getElementById('ds-pin-list');
  const pins = dsPins().slice().sort((a, b) => a.pin - b.pin);
  if (!pins.length) {
    list.innerHTML = '<div class="hint" style="margin:0;">No pins yet — tap the plan above to drop one.</div>';
    return;
  }
  list.innerHTML = pins.map((p) => {
    const desc = (p.description || '').trim() || '(no description yet)';
    const meta = [p.room, p.direction].filter(Boolean).join(' · ');
    return `
      <div class="ds-pin-row${p.id === dsSelectedId ? ' selected' : ''}" data-id="${escapeHtml(p.id)}">
        <div class="ds-pin-badge${p.type === 'Exterior' ? ' exterior' : ''}">${escapeHtml(String(p.pin))}</div>
        <div class="ds-pin-meta">
          <div class="line1">${escapeHtml(meta || (p.type || 'Interior'))}</div>
          <div class="line2">${escapeHtml(desc)}</div>
        </div>
      </div>`;
  }).join('');
  list.querySelectorAll('.ds-pin-row').forEach((row) => {
    row.addEventListener('click', () => dsSelectPin(row.getAttribute('data-id')));
  });
}

function dsRenderAll() {
  dsRenderMarkers();
  dsRenderEditor();
  dsRenderPinList();
}

function dsSelectPin(id) {
  dsSelectedId = id;
  dsRenderAll();
}

async function dsCreatePinAt(x, y) {
  const pin = {
    id: 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    pin: dsNextPinNumber(),
    type: 'Interior',
    room: '',
    description: '',
    x, y,
    direction: pinCardinalDirection(x, y, dsJob.frontDoor),
    photos: [],
    // Tags this pin as native so a later CSV re-import (which replaces only
    // origin:'import' pins) never wipes it. See dsSetType/dsSetRoom/etc —
    // touching up an imported pin here re-tags it native for the same reason.
    origin: 'native',
  };
  const pins = dsPins();
  pins.push(pin);
  dsJob.distressSurvey = { ...(dsJob.distressSurvey || {}), pins };
  await dsSave();
  dsSelectPin(pin.id);
}

async function dsSetType(type) {
  const p = dsPin(dsSelectedId);
  if (!p) return;
  p.type = type;
  p.origin = 'native';
  await dsSave();
  dsRenderAll();
}

async function dsSetRoom(room) {
  const p = dsPin(dsSelectedId);
  if (!p) return;
  p.room = room;
  p.origin = 'native';
  await dsSave();
  dsRenderPinList();
}

// Split into an immediate local update (so the pin list preview stays live
// while typing) and a save that only fires on blur — saving on every
// keystroke would let overlapping async saves interleave and drop text,
// the same class of bug fixed earlier for job.js's edit form.
function dsUpdateDescriptionLocal(text) {
  const p = dsPin(dsSelectedId);
  if (!p) return;
  p.description = text;
  p.origin = 'native';
  dsRenderPinList();
}

async function dsSaveDescription() {
  await dsSave();
}

async function dsAddPhoto(file) {
  const p = dsPin(dsSelectedId);
  if (!p || !file) return;
  p.photos = p.photos || [];
  p.photos.push(file);
  p.origin = 'native';
  await dsSave();
  dsRenderEditor();
}

async function dsRemovePhoto(pinId, index) {
  const p = dsPin(pinId);
  if (!p) return;
  p.photos.splice(index, 1);
  p.origin = 'native';
  await dsSave();
  dsRenderEditor();
}

async function dsDeletePin() {
  const p = dsPin(dsSelectedId);
  if (!p) return;
  if (!confirm('Delete this pin?')) return;
  // Retire the deleted number rather than renumbering what's left. A pin's
  // number can be an imported CSV pin's, cross-referenced to a physical
  // photo numbering scheme from the old app — renumbering it out from under
  // an unrelated delete would break that. A gap is normal, not a bug: the
  // real sample export itself skips a number (1,2,4,5) from an earlier delete.
  const pins = dsPins().filter((x) => x.id !== p.id);
  dsJob.distressSurvey = { ...(dsJob.distressSurvey || {}), pins };
  dsSelectedId = null;
  await dsSave();
  dsRenderAll();
}

function dsRenderPlanImage() {
  const wrap = document.getElementById('ds-plan-wrap');
  dsPlanUrl = URL.createObjectURL(dsJob.planImage);
  wrap.innerHTML = `<img src="${dsPlanUrl}" alt="Plan photo">`;
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('.ds-pin')) return;
    const img = wrap.querySelector('img');
    const rect = img.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    dsCreatePinAt(x, y);
  });
  dsRenderMarkers();
}

async function loadDistressSurvey() {
  const params = new URLSearchParams(location.search);
  const key = params.get('job');
  if (!key) { location.href = 'index.html'; return; }
  dsJobKey = key;
  document.getElementById('back-link').href = `customer.html?job=${encodeURIComponent(key)}`;

  let job;
  try {
    job = await getJob(key);
  } catch (err) {
    document.getElementById('ds-body').innerHTML =
      `<div class="empty-state">Could not open this customer file.<br>${escapeHtml(err.message || String(err))}</div>`;
    return;
  }
  if (!job) { location.href = 'index.html'; return; }
  dsJob = job;

  const name = (job.people && job.people.primaryName) || 'Customer';
  document.querySelector('header h1').textContent = `Distress Survey — ${name}`;

  if (!job.planImage) {
    document.getElementById('ds-body').innerHTML = `
      <div class="empty-state">
        No plan photo set for this customer yet.<br>
        Add one from Edit Customer Info before dropping pins.
      </div>`;
    return;
  }

  dsRenderPlanImage();
  dsRenderPinList();

  document.getElementById('btn-ds-done').addEventListener('click', () => dsSelectPin(null));
  document.getElementById('btn-ds-interior').addEventListener('click', () => dsSetType('Interior'));
  document.getElementById('btn-ds-exterior').addEventListener('click', () => dsSetType('Exterior'));
  document.getElementById('f-ds-room').addEventListener('change', (e) => dsSetRoom(e.target.value));
  document.getElementById('f-ds-desc').addEventListener('input', (e) => dsUpdateDescriptionLocal(e.target.value));
  document.getElementById('f-ds-desc').addEventListener('change', dsSaveDescription);
  document.getElementById('btn-ds-delete').addEventListener('click', dsDeletePin);
  document.getElementById('btn-ds-photo').addEventListener('click', () => document.getElementById('f-ds-photo').click());
  document.getElementById('f-ds-photo').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) dsAddPhoto(file);
  });
}

loadDistressSurvey();
