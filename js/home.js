// Cabinet home: lists every job in the pocket, newest first.

function formatUpdated(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function jobSummaryLine(job) {
  const parts = [];
  if (job.address) parts.push(job.address);
  if (job.rooms && job.rooms.length) parts.push(`${job.rooms.length} room${job.rooms.length === 1 ? '' : 's'}`);
  if (job.updatedAt) parts.push(`updated ${formatUpdated(job.updatedAt)}`);
  return parts.join(' · ');
}

async function renderJobList() {
  const listEl = document.getElementById('job-list');
  let jobs = [];
  try {
    jobs = await getAllJobs();
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">Could not open the job pocket on this device.<br>${err.message || err}</div>`;
    return;
  }

  jobs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  if (!jobs.length) {
    listEl.innerHTML = `<div class="empty-state">No jobs yet.<br>Tap "New Job" to start a customer file.</div>`;
    return;
  }

  listEl.innerHTML = '';
  for (const job of jobs) {
    const name = (job.people && job.people.primaryName) || '(no name yet)';
    const a = document.createElement('a');
    a.className = 'card job-card';
    a.href = `customer.html?job=${encodeURIComponent(job.addressKey)}`;
    a.innerHTML = `
      <div class="address">${escapeHtml(name)}</div>
      <div class="meta">${escapeHtml(jobSummaryLine(job))}</div>
    `;
    listEl.appendChild(a);
  }
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

renderJobList();
