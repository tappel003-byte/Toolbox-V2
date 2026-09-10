// Customer file screen: one job, loaded by address key from the query string.
// This is the only screen that writes into sandia-job-pocket.

const params = new URLSearchParams(location.search);
const existingKey = params.get('job');

let planBlob = null;      // File/Blob currently attached to this job
let planObjectUrl = null; // object URL for previewing planBlob
let doorMarker = null;    // { x: 0..1, y: 0..1 } relative to the plan photo
let rooms = [];           // [{ id, name, x?, y? }] — x/y set only for rooms placed on the plan
let roomCounter = 0;
let ocrRanOnce = false;

const els = {
  address: document.getElementById('f-address'),
  names: document.getElementById('f-names'),
  phone: document.getElementById('f-phone'),
  email: document.getElementById('f-email'),
  inspector: document.getElementById('f-inspector'),
  date: document.getElementById('f-date'),
  notes: document.getElementById('f-notes'),
  planWrap: document.getElementById('plan-photo-wrap'),
  planPlaceholder: document.getElementById('plan-placeholder'),
  planInput: document.getElementById('f-plan-input'),
  btnAddPlan: document.getElementById('btn-add-plan'),
  buildingType: document.getElementById('f-building-type'),
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
};

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function showOcrMessage(text) {
  els.ocrMessage.textContent = text;
  els.ocrMessage.style.display = text ? '' : 'none';
}

// ---- rooms: list rows + plan markers, kept in sync from one `rooms` array ----

function renderRoomsList() {
  els.roomList.innerHTML = '';
  for (const room of rooms) {
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
  els.roomsStatus.textContent = rooms.length ? `— ${rooms.length} room${rooms.length === 1 ? '' : 's'}` : '';
}

function renderRoomMarkers() {
  els.planWrap.querySelectorAll('.room-marker').forEach((el) => el.remove());
  if (!els.planWrap.querySelector('img')) return;
  for (const room of rooms) {
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
  const room = { id: `r${roomCounter}-${Date.now()}`, name };
  if (typeof x === 'number' && typeof y === 'number') {
    room.x = x;
    room.y = y;
  }
  rooms.push(room);
  return room;
}

function findRoomByName(name) {
  const lower = name.trim().toLowerCase();
  return rooms.find((r) => r.name.trim().toLowerCase() === lower);
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
  // Room positions were measured against the old photo; drop them but keep names.
  rooms = rooms.map((r) => ({ id: r.id, name: r.name }));
  ocrRanOnce = false;
  els.btnOcrMore.style.display = 'none';
  showOcrMessage('');
  renderPlanPhoto(planBlob);
  renderRoomsList();
});

// ---- OCR room auto-fill ----

// Merge freshly-scanned rooms into the current list without clobbering
// manual entries: a name match with no position yet is upgraded with the
// scanned position; a hit near an existing pin is skipped; everything else
// is added new.
function mergeScannedRooms(found) {
  let addedCount = 0;
  for (const f of found) {
    const nearby = rooms.find((r) => typeof r.x === 'number' && Math.hypot(r.x - f.x, r.y - f.y) < 0.05);
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
    const { rooms: merged, addedCount } = await RoomOCR.findMore(planObjectUrl, els.buildingType.value, rooms, (msg) => {
      els.btnOcrMore.textContent = msg;
      showOcrMessage(msg);
    });
    rooms = merged.map((r, i) => ({ id: rooms[i] ? rooms[i].id : `r${++roomCounter}-${Date.now()}`, name: r.name, x: r.x, y: r.y }));
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

  const job = {
    address,
    people: {
      names: els.names.value.trim(),
      phone: els.phone.value.trim(),
      email: els.email.value.trim(),
    },
    inspector: els.inspector.value.trim(),
    date: els.date.value,
    notes: els.notes.value.trim(),
    planImage: planBlob || null,
    planImageType: planBlob ? planBlob.type : null,
    buildingType: els.buildingType.value,
    rooms: rooms.map((r) => ({ id: r.id, name: r.name.trim(), x: r.x, y: r.y })).filter((r) => r.name),
    frontDoor: {
      facing: els.doorFacing.value,
      marker: doorMarker,
    },
  };

  try {
    const saved = await saveJob(job);
    showToast('Job saved.');
    if (!existingKey) {
      history.replaceState(null, '', `job.html?job=${encodeURIComponent(saved.addressKey)}`);
      els.btnDelete.style.display = '';
    }
  } catch (err) {
    showToast(`Could not save: ${err.message || err}`);
  }
});

async function loadExistingJob() {
  renderChips();
  if (!existingKey) return;
  const job = await getJob(existingKey);
  if (!job) return;

  els.address.value = job.address || '';
  els.names.value = (job.people && job.people.names) || '';
  els.phone.value = (job.people && job.people.phone) || '';
  els.email.value = (job.people && job.people.email) || '';
  els.inspector.value = job.inspector || '';
  els.date.value = job.date || '';
  els.notes.value = job.notes || '';
  els.buildingType.value = job.buildingType || 'residential';

  planBlob = job.planImage || null;
  renderPlanPhoto(planBlob);

  rooms = (job.rooms || []).map((r) => {
    roomCounter += 1;
    const room = { id: r.id || `r${roomCounter}-${Date.now()}`, name: r.name };
    if (typeof r.x === 'number' && typeof r.y === 'number') {
      room.x = r.x;
      room.y = r.y;
    }
    return room;
  });
  renderRoomsList();
  renderRoomMarkers();
  renderChips();

  els.doorFacing.value = (job.frontDoor && job.frontDoor.facing) || '';
  doorMarker = (job.frontDoor && job.frontDoor.marker) || null;
  renderDoorMarker();

  els.btnDelete.style.display = '';
}

loadExistingJob();
