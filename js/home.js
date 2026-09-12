// Cabinet home: lists every job in the pocket, newest first. Searchable by
// customer name (primary) or address (secondary) — name is the human-facing
// handle across devices, per the "customer file, not address file" rule.

let allJobs = [];

function jobSummaryLine(job) {
  const parts = [];
  if (job.address) parts.push(job.address);
  if (job.rooms && job.rooms.length) parts.push(`${job.rooms.length} room${job.rooms.length === 1 ? '' : 's'}`);
  if (job.updatedAt) parts.push(`updated ${formatUpdated(job.updatedAt)}`);
  return parts.join(' · ');
}

function jobName(job) {
  return (job.people && job.people.primaryName) || '(no name yet)';
}

function matchesSearch(job, term) {
  if (!term) return true;
  const haystack = `${jobName(job)} ${job.address || ''}`.toLowerCase();
  return haystack.includes(term);
}

function renderList() {
  const listEl = document.getElementById('job-list');
  const term = document.getElementById('f-search').value.trim().toLowerCase();

  if (!allJobs.length) {
    listEl.innerHTML = `<div class="empty-state">No jobs yet.<br>Tap "New Job" to start a customer file.</div>`;
    return;
  }

  const filtered = allJobs.filter((job) => matchesSearch(job, term));

  if (!filtered.length) {
    listEl.innerHTML = `<div class="empty-state">No customers match "${escapeHtml(document.getElementById('f-search').value.trim())}".</div>`;
    return;
  }

  listEl.innerHTML = '';
  for (const job of filtered) {
    const a = document.createElement('a');
    a.className = 'card job-card';
    a.href = `customer.html?job=${encodeURIComponent(job.addressKey)}`;
    a.innerHTML = `
      <div class="address">${escapeHtml(jobName(job))}</div>
      <div class="meta">${escapeHtml(jobSummaryLine(job))}</div>
    `;
    listEl.appendChild(a);
  }
}

async function renderJobList() {
  const listEl = document.getElementById('job-list');
  try {
    allJobs = await getAllJobs();
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">Could not open the job pocket on this device.<br>${err.message || err}</div>`;
    return;
  }

  allJobs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  renderList();
}

document.getElementById('f-search').addEventListener('input', renderList);

renderJobList();
