// Customer hub: the four-drawer landing page for one existing customer.
// Read-only — editing anything about the customer happens on job.html.

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function formatUpdated(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

async function loadCustomer() {
  const params = new URLSearchParams(location.search);
  const key = params.get('job');
  const editLink = document.getElementById('btn-edit-info');

  if (!key) {
    // No customer specified — nothing to show, send back to the cabinet.
    location.href = 'index.html';
    return;
  }

  editLink.href = `job.html?job=${encodeURIComponent(key)}`;

  let job;
  try {
    job = await getJob(key);
  } catch (err) {
    document.getElementById('customer-address').textContent = 'Could not open this customer file.';
    document.getElementById('customer-meta').textContent = err.message || String(err);
    return;
  }

  if (!job) {
    location.href = 'index.html';
    return;
  }

  const name = (job.people && job.people.primaryName) || '';
  document.getElementById('customer-title').textContent = name || 'Customer';
  document.getElementById('customer-address').textContent = job.address || '(no address)';

  const metaParts = [];
  if (name) metaParts.push(name);
  if (job.rooms && job.rooms.length) metaParts.push(`${job.rooms.length} room${job.rooms.length === 1 ? '' : 's'}`);
  if (job.updatedAt) metaParts.push(`updated ${formatUpdated(job.updatedAt)}`);
  document.getElementById('customer-meta').textContent = metaParts.join(' · ');
}

loadCustomer();
