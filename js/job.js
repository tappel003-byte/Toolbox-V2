// Customer file screen: one job, loaded by address key from the query string.
// This is the only screen that writes into sandia-job-pocket.

const params = new URLSearchParams(location.search);
const existingKey = params.get('job');

let planBlob = null;      // File/Blob currently attached to this job
let planObjectUrl = null; // object URL for previewing planBlob
let doorMarker = null;    // { x: 0..1, y: 0..1 } relative to the plan photo
let roomCounter = 0;

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
  roomList: document.getElementById('room-list'),
  btnAddRoom: document.getElementById('btn-add-room'),
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

function addRoomRow(name) {
  roomCounter += 1;
  const row = document.createElement('div');
  row.className = 'room-row';
  row.dataset.roomId = `r${roomCounter}-${Date.now()}`;
  row.innerHTML = `
    <input type="text" value="${name ? escapeHtml(name) : ''}" placeholder="Room name">
    <button type="button" class="icon-btn" aria-label="Remove room">&times;</button>
  `;
  row.querySelector('.icon-btn').addEventListener('click', () => row.remove());
  els.roomList.appendChild(row);
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function readRooms() {
  return Array.from(els.roomList.querySelectorAll('.room-row')).map((row) => ({
    id: row.dataset.roomId,
    name: row.querySelector('input').value.trim(),
  })).filter((r) => r.name);
}

function renderPlanPhoto(blob) {
  if (planObjectUrl) URL.revokeObjectURL(planObjectUrl);
  els.planWrap.innerHTML = '';
  if (!blob) {
    els.planWrap.appendChild(els.planPlaceholder);
    return;
  }
  planObjectUrl = URL.createObjectURL(blob);
  const img = document.createElement('img');
  img.src = planObjectUrl;
  img.alt = 'Plan photo';
  els.planWrap.appendChild(img);
  img.addEventListener('click', onPlanPhotoClick);
  renderDoorMarker();
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
  renderPlanPhoto(planBlob);
});

els.btnAddRoom.addEventListener('click', () => addRoomRow(''));

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
    rooms: readRooms(),
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

  planBlob = job.planImage || null;
  renderPlanPhoto(planBlob);

  els.roomList.innerHTML = '';
  (job.rooms || []).forEach((r) => addRoomRow(r.name));

  els.doorFacing.value = (job.frontDoor && job.frontDoor.facing) || '';
  doorMarker = (job.frontDoor && job.frontDoor.marker) || null;
  renderDoorMarker();

  els.btnDelete.style.display = '';
}

loadExistingJob();
