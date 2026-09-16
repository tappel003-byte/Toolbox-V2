// Customer file screen: one job, loaded by address key from the query string.
// This is the only screen that writes into sandia-job-pocket.

const params = new URLSearchParams(location.search);
const existingKey = params.get('job');

let planBlob = null;      // File/Blob currently attached to this job
let planObjectUrl = null; // object URL for previewing planBlob
let doorMarker = null;    // { x: 0..1, y: 0..1 } relative to the plan photo
let rooms = [];           // [{ id, name, levelId, x?, y? }] — x/y set only for rooms placed on the plan
let roomCounter = 0;
let ocrRanOnce = false;
let levels = [];          // [{ id, name }] — a level (floor) a room can belong to
let currentLevelId = null;

const els = {
  address: document.getElementById('f-address'),
  firstName: document.getElementById('f-first-name'),
  lastName: document.getElementById('f-last-name'),
  secondName: document.getElementById('f-second-name'),
  cellPhone: document.getElementById('f-cell-phone'),
  email: document.getElementById('f-email'),
  billingSame: document.getElementById('f-billing-same'),
  billingAddressWrap: document.getElementById('f-billing-address-wrap'),
  billingAddress: document.getElementById('f-billing-address'),
  secondAddress: document.getElementById('f-second-address'),
  date: document.getElementById('f-date'),
  notes: document.getElementById('f-notes'),
  questionnaireBtn: document.getElementById('btn-questionnaire'),
  questionnaireHint: document.getElementById('questionnaire-hint'),
  planWrap: document.getElementById('plan-photo-wrap'),
  planPlaceholder: document.getElementById('plan-placeholder'),
  planInput: document.getElementById('f-plan-input'),
  btnAddPlan: document.getElementById('btn-add-plan'),
  buildingType: document.getElementById('f-building-type'),
  levelTabs: document.getElementById('level-tabs'),
  btnAddLevel: document.getElementById('btn-add-level'),
  btnRemoveLevel: document.getElementById('btn-remove-level'),
  currentLevelName: document.getElementById('current-level-name'),
  roomChips: document.getElementById('room-chips'),
  roomList: document.getElementById('room-list'),
  roomsStatus: document.getElementById('rooms-status'),
  btnAddRoom: document.getElementById('btn-add-room'),
  btnOcrScan: document.getElementById('btn-ocr-scan'),
  btnOcrMore: document.getElementById('btn-ocr-more'),
  ocrMessage: document.getElementById('ocr-message'),
  doorFacing: document.getElementById('f-door-facing'),
  doorMarkerStatus: document.getElementById('door-marker-status'),
  form: document.getElementById('job-form'),
  btnDelete: document.getElementById('btn-delete'),
  backLink: document.getElementById('back-link'),
};

if (existingKey) {
  els.backLink.href = `customer.html?job=${encodeURIComponent(existingKey)}`;
  els.questionnaireBtn.href = `questionnaire.html?job=${encodeURIComponent(existingKey)}`;
  els.questionnaireHint.style.display = 'none';
} else {
  els.questionnaireBtn.addEventListener('click', (e) => {
    e.preventDefault();
    showToast('Save this job first, then the questionnaire will be right here.');
  });
}

function showOcrMessage(text) {
  els.ocrMessage.textContent = text;
  els.ocrMessage.style.display = text ? '' : 'none';
}

// A legacy job saved before the first/last name split only has a single
// "primaryName" string — best-effort split so it doesn't look wiped the
// first time this screen reopens it.
function splitLegacyName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

// ---- levels (floors a room can belong to) ----

function currentLevel() {
  return levels.find((l) => l.id === currentLevelId) || levels[0];
}

function renderLevelTabs() {
  els.levelTabs.innerHTML = '';
  for (const level of levels) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (level.id === currentLevelId ? ' chip-added' : '');
    chip.textContent = level.name || '(unnamed)';
    chip.addEventListener('click', () => {
      currentLevelId = level.id;
      renderLevelTabs();
      renderRoomsList();
      renderRoomMarkers();
      renderChips();
    });
    els.levelTabs.appendChild(chip);
  }
  const cur = currentLevel();
  els.currentLevelName.textContent = cur ? cur.name : '';
  els.btnRemoveLevel.disabled = levels.length <= 1;
}

els.btnAddLevel.addEventListener('click', () => {
  const name = (prompt('Level name (e.g. Basement, Main, Second):') || '').trim();
  if (!name) return;
  const level = { id: `level-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name };
  levels.push(level);
  currentLevelId = level.id;
  renderLevelTabs();
  renderRoomsList();
  renderRoomMarkers();
  renderChips();
});

els.btnRemoveLevel.addEventListener('click', () => {
  if (levels.length <= 1) return;
  const level = currentLevel();
  if (!level) return;
  if (!confirm(`Delete "${level.name}" and every room on it? This cannot be undone.`)) return;
  levels = levels.filter((l) => l.id !== level.id);
  rooms = rooms.filter((r) => r.levelId !== level.id);
  currentLevelId = levels[0].id;
  renderLevelTabs();
  renderRoomsList();
  renderRoomMarkers();
  renderChips();
});

// ---- rooms: list rows + plan markers, kept in sync from one `rooms` array ----
// `rooms` holds every room across every level; everything below filters to
// the currently selected level so Rooms/chips/markers only ever show one
// level's rooms at a time.

function roomsOnCurrentLevel() {
  return rooms.filter((r) => r.levelId === currentLevelId);
}

function renderRoomsList() {
  els.roomList.innerHTML = '';
  const levelRooms = roomsOnCurrentLevel();
  for (const room of levelRooms) {
    const row = document.createElement('div');
    row.className = 'room-row';
    row.dataset.roomId = room.id;
    const hasPos = typeof room.x === 'number';
    row.innerHTML = `
      <input type="text" value="${escapeHtml(room.name)}" placeholder="Room name">
      ${hasPos ? '<span class="room-pos-badge">on plan</span>' : ''}
      <button type="button" class="icon-btn" aria-label="Remove room">&times;</button>
    `;
    row.querySelector('input').addEventListener('input', (e) => {
      room.name = e.target.value;
      renderRoomMarkers();
      renderChips();
    });
    row.querySelector('.icon-btn').addEventListener('click', () => {
      rooms = rooms.filter((r) => r.id !== room.id);
      renderRoomsList();
      renderRoomMarkers();
      renderChips();
    });
    els.roomList.appendChild(row);
  }
  els.roomsStatus.textContent = levelRooms.length ? `— ${levelRooms.length} room${levelRooms.length === 1 ? '' : 's'}` : '';
}

function renderRoomMarkers() {
  els.planWrap.querySelectorAll('.room-marker').forEach((el) => el.remove());
  if (!els.planWrap.querySelector('img')) return;
  for (const room of roomsOnCurrentLevel()) {
    if (typeof room.x !== 'number' || typeof room.y !== 'number') continue;
    const marker = document.createElement('div');
    marker.className = 'room-marker';
    marker.style.left = `${room.x * 100}%`;
    marker.style.top = `${room.y * 100}%`;
    marker.innerHTML = `<span class="dot"></span>${escapeHtml(room.name)}`;
    marker.title = 'Tap to remove';
    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      rooms = rooms.filter((r) => r.id !== room.id);
      renderRoomsList();
      renderRoomMarkers();
      renderChips();
    });
    els.planWrap.appendChild(marker);
  }
}

function addRoom(name, x, y) {
  roomCounter += 1;
  const room = { id: `r${roomCounter}-${Date.now()}`, name, levelId: currentLevelId };
  if (typeof x === 'number' && typeof y === 'number') {
    room.x = x;
    room.y = y;
  }
  rooms.push(room);
  return room;
}

function findRoomByName(name) {
  const lower = name.trim().toLowerCase();
  return roomsOnCurrentLevel().find((r) => r.name.trim().toLowerCase() === lower);
}

// Quick-tap chips for the selected building type's common rooms. Tapping an
// unused name adds it (no plan position); tapping an already-added name
// removes it. Mirrors Distress Survey's fast-tap room picker.
function renderChips() {
  const type = els.buildingType.value;
  const common = RoomOCR.getCommonRooms(type);
  els.roomChips.innerHTML = '';
  for (const name of common) {
    const added = !!findRoomByName(name);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (added ? ' chip-added' : '');
    chip.textContent = added ? `${name} ✓` : name;
    chip.addEventListener('click', () => {
      const existing = findRoomByName(name);
      if (existing) {
        rooms = rooms.filter((r) => r.id !== existing.id);
      } else {
        addRoom(name);
      }
      renderRoomsList();
      renderRoomMarkers();
      renderChips();
    });
    els.roomChips.appendChild(chip);
  }
}

els.buildingType.addEventListener('change', renderChips);
els.btnAddRoom.addEventListener('click', () => {
  addRoom('');
  renderRoomsList();
});

// ---- customer contact ----

function renderBillingAddressField() {
  els.billingAddressWrap.style.display = els.billingSame.checked ? 'none' : '';
}

els.billingSame.addEventListener('change', renderBillingAddressField);

// ---- plan photo + front door marker ----

function renderPlanPhoto(blob) {
  if (planObjectUrl) URL.revokeObjectURL(planObjectUrl);
  els.planWrap.innerHTML = '';
  if (!blob) {
    els.planWrap.appendChild(els.planPlaceholder);
    els.btnOcrScan.disabled = true;
    return;
  }
  planObjectUrl = URL.createObjectURL(blob);
  const img = document.createElement('img');
  img.src = planObjectUrl;
  img.alt = 'Plan photo';
  els.planWrap.appendChild(img);
  img.addEventListener('click', onPlanPhotoClick);
  els.btnOcrScan.disabled = false;
  renderDoorMarker();
  renderRoomMarkers();
}

function renderDoorMarker() {
  const existing = els.planWrap.querySelector('.door-marker');
  if (existing) existing.remove();
  if (!doorMarker || !els.planWrap.querySelector('img')) {
    els.doorMarkerStatus.textContent = 'Not set.';
    return;
  }
  const dot = document.createElement('div');
  dot.className = 'door-marker';
  dot.style.left = `${doorMarker.x * 100}%`;
  dot.style.top = `${doorMarker.y * 100}%`;
  els.planWrap.appendChild(dot);
  els.doorMarkerStatus.textContent = `Set at ${Math.round(doorMarker.x * 100)}%, ${Math.round(doorMarker.y * 100)}%.`;
}

function onPlanPhotoClick(evt) {
  const rect = evt.target.getBoundingClientRect();
  doorMarker = {
    x: (evt.clientX - rect.left) / rect.width,
    y: (evt.clientY - rect.top) / rect.height,
  };
  renderDoorMarker();
}

els.btnAddPlan.addEventListener('click', () => els.planInput.click());

els.planInput.addEventListener('change', () => {
  const file = els.planInput.files && els.planInput.files[0];
  if (!file) return;
  planBlob = file;
  doorMarker = null; // a new photo invalidates the old pin position
  // Room positions were measured against the old photo; drop them but keep names/levels.
  rooms = rooms.map((r) => ({ id: r.id, name: r.name, levelId: r.levelId }));
  ocrRanOnce = false;
  els.btnOcrMore.style.display = 'none';
  showOcrMessage('');
  renderPlanPhoto(planBlob);
  renderRoomsList();
});

// ---- OCR room auto-fill ----

// Merge freshly-scanned rooms into the current level's list without
// clobbering manual entries: a name match with no position yet is upgraded
// with the scanned position; a hit near an existing pin is skipped;
// everything else is added new, on the level being worked on right now.
function mergeScannedRooms(found) {
  let addedCount = 0;
  for (const f of found) {
    const levelRooms = roomsOnCurrentLevel();
    const nearby = levelRooms.find((r) => typeof r.x === 'number' && Math.hypot(r.x - f.x, r.y - f.y) < 0.05);
    if (nearby) continue;
    const byName = findRoomByName(f.name);
    if (byName && typeof byName.x !== 'number') {
      byName.x = f.x;
      byName.y = f.y;
    } else {
      addRoom(f.name, f.x, f.y);
    }
    addedCount++;
  }
  return addedCount;
}

els.btnOcrScan.addEventListener('click', async () => {
  if (!planObjectUrl) return;
  els.btnOcrScan.disabled = true;
  const oldText = els.btnOcrScan.textContent;
  showOcrMessage('Loading text reader…');
  try {
    const { rooms: found, droppedCount } = await RoomOCR.scan(planObjectUrl, els.buildingType.value, (msg) => {
      els.btnOcrScan.textContent = msg;
      showOcrMessage(msg);
    });
    const addedCount = mergeScannedRooms(found);
    renderRoomsList();
    renderRoomMarkers();
    renderChips();
    ocrRanOnce = true;
    els.btnOcrMore.style.display = '';
    const msg = addedCount
      ? `Read ${addedCount} label${addedCount === 1 ? '' : 's'}${droppedCount ? ` (dropped ${droppedCount} low-confidence)` : ''}. Tap a room on the plan to remove it.`
      : 'No room labels found. Add rooms with the chips or "+ Add Custom Room".';
    showOcrMessage(msg);
    showToast(addedCount ? `Found ${addedCount} label${addedCount === 1 ? '' : 's'}` : 'No labels found');
  } catch (err) {
    const msg = (err && err.message) || 'Could not read labels. Add rooms manually.';
    showOcrMessage(msg);
    showToast(msg);
  } finally {
    els.btnOcrScan.disabled = false;
    els.btnOcrScan.textContent = oldText;
  }
});

els.btnOcrMore.addEventListener('click', async () => {
  if (!planObjectUrl) return;
  els.btnOcrMore.disabled = true;
  const oldText = els.btnOcrMore.textContent;
  showOcrMessage('Preparing deep scan…');
  try {
    const levelRooms = roomsOnCurrentLevel();
    const { rooms: merged, addedCount } = await RoomOCR.findMore(planObjectUrl, els.buildingType.value, levelRooms, (msg) => {
      els.btnOcrMore.textContent = msg;
      showOcrMessage(msg);
    });
    const mergedWithIds = merged.map((r, i) => ({
      id: levelRooms[i] ? levelRooms[i].id : `r${++roomCounter}-${Date.now()}`,
      name: r.name,
      x: r.x,
      y: r.y,
      levelId: currentLevelId,
    }));
    rooms = rooms.filter((r) => r.levelId !== currentLevelId).concat(mergedWithIds);
    renderRoomsList();
    renderRoomMarkers();
    renderChips();
    const msg = addedCount ? `Found ${addedCount} more. Tap a room on the plan to remove it.` : 'No additional labels found.';
    showOcrMessage(msg);
    showToast(addedCount ? `Added ${addedCount}` : 'Nothing new');
  } catch (err) {
    const msg = (err && err.message) || 'Deep scan failed.';
    showOcrMessage(msg);
    showToast(msg);
  } finally {
    els.btnOcrMore.disabled = false;
    els.btnOcrMore.textContent = oldText;
  }
});

// ---- delete / save / load ----

els.btnDelete.addEventListener('click', async () => {
  if (!existingKey) return;
  if (!confirm('Delete this job from the pocket? This cannot be undone.')) return;
  await deleteJob(existingKey);
  location.href = 'index.html';
});

els.form.addEventListener('submit', async (evt) => {
  evt.preventDefault();
  const address = els.address.value.trim();
  if (!address) {
    showToast('Address is required.');
    return;
  }

  // This form only ever edits the fields below. Anything else already on the
  // record — imported drawer data, voice memos, whatever gets added later —
  // has to survive a save here untouched, so start from the existing record
  // (if any) and overlay just what this form actually controls. A plain
  // `{ address, people, ... }` object would silently wipe everything else
  // on the next full-record put().
  let existingRecord = null;
  if (existingKey) {
    try {
      existingRecord = await getJob(existingKey);
    } catch (err) {
      // Fall through to a fresh record rather than blocking the save.
    }
  }

  const firstName = els.firstName.value.trim();
  const lastName = els.lastName.value.trim();

  const job = {
    ...(existingRecord || {}),
    address,
    people: {
      firstName,
      lastName,
      // Derived display name — home.js, report.js, and diagnostics.js all
      // show one string for "who this job is"; keeping it in sync here
      // means none of those had to change just for the first/last split.
      primaryName: [firstName, lastName].filter(Boolean).join(' '),
      secondName: els.secondName.value.trim(),
      cellPhone: els.cellPhone.value.trim(),
      email: els.email.value.trim(),
      billingSameAsSite: els.billingSame.checked,
      billingAddress: els.billingSame.checked ? '' : els.billingAddress.value.trim(),
      secondAddress: els.secondAddress.value.trim(),
    },
    date: els.date.value,
    notes: els.notes.value.trim(),
    planImage: planBlob || null,
    planImageType: planBlob ? planBlob.type : null,
    buildingType: els.buildingType.value,
    levels: levels.map((l) => ({ id: l.id, name: l.name.trim() || l.name })),
    rooms: rooms.map((r) => ({ id: r.id, name: r.name.trim(), levelId: r.levelId, x: r.x, y: r.y })).filter((r) => r.name),
    frontDoor: {
      facing: els.doorFacing.value,
      marker: doorMarker,
    },
  };

  try {
    const saved = await saveJob(job);
    location.href = `customer.html?job=${encodeURIComponent(saved.addressKey)}`;
  } catch (err) {
    showToast(`Could not save: ${err.message || err}`);
  }
});

async function loadExistingJob() {
  // Brand-new job: start with one default level so Rooms has somewhere to attach.
  levels = [{ id: 'level-1', name: 'Main' }];
  currentLevelId = levels[0].id;
  renderLevelTabs();
  renderChips();
  if (!existingKey) return;
  const job = await getJob(existingKey);
  if (!job) return;

  els.address.value = job.address || '';
  const people = job.people || {};
  let firstName = people.firstName || '';
  let lastName = people.lastName || '';
  if (!firstName && !lastName && people.primaryName) {
    const split = splitLegacyName(people.primaryName);
    firstName = split.firstName;
    lastName = split.lastName;
  }
  els.firstName.value = firstName;
  els.lastName.value = lastName;
  els.secondName.value = people.secondName || '';
  els.cellPhone.value = people.cellPhone || '';
  els.email.value = people.email || '';
  els.billingSame.checked = people.billingSameAsSite !== false;
  els.billingAddress.value = people.billingAddress || '';
  els.secondAddress.value = people.secondAddress || '';
  renderBillingAddressField();
  els.date.value = job.date || '';
  els.notes.value = job.notes || '';
  els.buildingType.value = job.buildingType || 'residential';

  planBlob = job.planImage || null;
  renderPlanPhoto(planBlob);

  // A job saved before Levels existed has no job.levels and no levelId on
  // its rooms — keep the default "Main" level and put every such room on
  // it, rather than losing them.
  levels = Array.isArray(job.levels) && job.levels.length
    ? job.levels.map((l) => ({ id: l.id, name: l.name }))
    : levels;
  currentLevelId = levels[0].id;

  rooms = (job.rooms || []).map((r) => {
    roomCounter += 1;
    const room = {
      id: r.id || `r${roomCounter}-${Date.now()}`,
      name: r.name,
      levelId: r.levelId || levels[0].id,
    };
    if (typeof r.x === 'number' && typeof r.y === 'number') {
      room.x = r.x;
      room.y = r.y;
    }
    return room;
  });
  renderLevelTabs();
  renderRoomsList();
  renderRoomMarkers();
  renderChips();

  els.doorFacing.value = (job.frontDoor && job.frontDoor.facing) || '';
  doorMarker = (job.frontDoor && job.frontDoor.marker) || null;
  renderDoorMarker();

  els.btnDelete.style.display = '';
}

loadExistingJob();
