// Report Builder — first real screen: a live pin schedule.
// Strictly read-only. Nothing here ever writes back to Distress Survey's
// data; it just renders whatever's currently imported. Fix it at the
// source, it shows up here automatically.

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
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

  if (!job.distressSurvey || !job.distressSurvey.pins || !job.distressSurvey.pins.length) {
    body.innerHTML = `
      <div class="empty-state">
        No Distress Survey data imported for this customer yet.<br>
        Go to their hub and import a pins.csv to see the pin schedule here.
      </div>`;
    return;
  }

  const pins = job.distressSurvey.pins.slice().sort((a, b) => a.pin - b.pin);

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

  body.innerHTML = `
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
    <div class="hint" style="margin-top:10px;">${pins.length} pin${pins.length === 1 ? '' : 's'} · imported ${new Date(job.distressSurvey.importedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
  `;
}

loadReport();
