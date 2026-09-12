// Report Builder — first real screens: Floor Survey's High/Low/Δ summary
// and a live Distress Survey pin schedule.
// Strictly read-only. Nothing here ever writes back to a drawer's data; it
// just renders whatever's currently imported. Fix it at the source, it
// shows up here automatically.

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function renderFloorSurveySection(job) {
  const fs = job.floorSurvey;
  if (!fs || !fs.floors || !fs.floors.length) return '';

  const cards = fs.floors.map((floor) => {
    const pts = (fs.points || []).filter((p) => p.floorId === floor.id);
    if (!pts.length) {
      return `<div class="hl-card"><div class="floor-name">${escapeHtml(floor.name || 'Floor')}</div><div class="hint" style="margin:0;">No points on this floor.</div></div>`;
    }
    const values = pts.map((p) => p.value);
    const high = Math.max(...values);
    const low = Math.min(...values);
    const delta = high - low;
    return `
      <div class="hl-card">
        <div class="floor-name">${escapeHtml(floor.name || 'Floor')}</div>
        <div class="hl-pill">
          <span class="hi">H ${high.toFixed(2)}"</span>
          <span class="lo">L ${low.toFixed(2)}"</span>
          <span>Δ ${delta.toFixed(2)}"</span>
          <span class="hint" style="margin:0;">${pts.length} point${pts.length === 1 ? '' : 's'}</span>
        </div>
      </div>`;
  }).join('');

  return `
    <div style="font-weight:700;margin-bottom:8px;">Floor Survey — Elevation Summary</div>
    ${cards}
    <div class="hint" style="margin-top:2px;margin-bottom:18px;">imported ${new Date(fs.importedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
  `;
}

function renderPinScheduleSection(job) {
  const ds = job.distressSurvey;
  if (!ds || !ds.pins || !ds.pins.length) return '';

  const pins = ds.pins.slice().sort((a, b) => a.pin - b.pin);
  const rows = pins.map((p) => {
    const isExterior = (p.type || '').toLowerCase() === 'exterior';
    return `
      <tr>
        <td><span class="pin-badge${isExterior ? ' exterior' : ''}">${escapeHtml(String(p.pin))}</span></td>
        <td>${escapeHtml(p.photoNumbers || '')}</td>
        <td>${escapeHtml(p.room || '')}</td>
        <td>${escapeHtml(p.direction || '')}</td>
        <td>${escapeHtml(p.description || '')}</td>
      </tr>`;
  }).join('');

  return `
    <div style="font-weight:700;margin-bottom:8px;">Distress Survey — Pin Schedule</div>
    <table class="pin-schedule">
      <thead>
        <tr>
          <th>Pin</th>
          <th>Photo</th>
          <th>Room</th>
          <th>Direction</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="hint" style="margin-top:10px;">${pins.length} pin${pins.length === 1 ? '' : 's'} · imported ${new Date(ds.importedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
  `;
}

async function loadReport() {
  const params = new URLSearchParams(location.search);
  const key = params.get('job');
  const body = document.getElementById('report-body');

  if (!key) {
    location.href = 'index.html';
    return;
  }
  document.getElementById('back-link').href = `customer.html?job=${encodeURIComponent(key)}`;

  let job;
  try {
    job = await getJob(key);
  } catch (err) {
    body.innerHTML = `<div class="empty-state">Could not open this customer file.<br>${escapeHtml(err.message || String(err))}</div>`;
    return;
  }

  if (!job) {
    location.href = 'index.html';
    return;
  }

  const name = (job.people && job.people.primaryName) || 'Customer';
  document.querySelector('header h1').textContent = `Report Builder — ${name}`;

  const floorSection = renderFloorSurveySection(job);
  const pinSection = renderPinScheduleSection(job);

  if (!floorSection && !pinSection) {
    body.innerHTML = `
      <div class="empty-state">
        No drawer data imported for this customer yet.<br>
        Go to their hub and import a Distress Survey pins.csv or a Floor Survey .floorsurvey.json to see it here.
      </div>`;
    return;
  }

  body.innerHTML = floorSection + pinSection;
}

loadReport();
