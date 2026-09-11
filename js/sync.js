// Offline-first sync: every save writes to the local job pocket first
// (that always works, signal or not), then this tries to push the same
// job to the shared Toolbox V2 API (worker/) so every drawer sees it too.
// No signal, or the API rejects it? The job stays marked "pending" and
// this retries automatically the moment the browser comes back online.
//
// API_BASE is empty until the Worker is actually deployed (see
// worker/README.md) — until then every job is "offline-only" and this
// file makes no network calls at all. Fill it in once there's a real
// URL, e.g. 'https://toolbox-v2-api.<subdomain>.workers.dev'.
const API_BASE = '';

function apiConfigured() {
  return !!API_BASE;
}

function jobToApiPayload(job) {
  // Same shape the Worker's PUT /api/customers/:id expects. The plan
  // photo is a Blob — it goes through the separate /photo endpoint,
  // not embedded in this JSON body.
  return {
    address: job.address,
    people: job.people,
    inspector: job.inspector,
    date: job.date,
    notes: job.notes,
    buildingType: job.buildingType,
    rooms: job.rooms,
    frontDoor: job.frontDoor,
  };
}

async function pushJobToApi(job) {
  const res = await fetch(`${API_BASE}/api/customers/${encodeURIComponent(job.addressKey)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jobToApiPayload(job)),
  });
  if (!res.ok) throw new Error(`API rejected job save (${res.status})`);
}

async function pushPhotoToApi(job) {
  if (!job.planImage) return;
  const res = await fetch(`${API_BASE}/api/customers/${encodeURIComponent(job.addressKey)}/photo`, {
    method: 'PUT',
    headers: { 'Content-Type': job.planImageType || 'application/octet-stream' },
    body: job.planImage,
  });
  if (!res.ok) throw new Error(`API rejected photo upload (${res.status})`);
}

// Try to sync one job right now. Never throws — resolves to the status
// the caller should record: 'offline-only' (no API configured yet),
// 'pending' (tried, no luck — no signal or the API errored), or 'synced'.
async function syncJob(job) {
  if (!apiConfigured()) return 'offline-only';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'pending';
  try {
    await pushJobToApi(job);
    await pushPhotoToApi(job);
    return 'synced';
  } catch (err) {
    return 'pending';
  }
}

// Sweep every locally pending job and retry. Each page that includes this
// script wires it to page load and the browser's 'online' event itself
// (see js/home.js, js/job.js) — kept out of this file so it fires once
// per page, not once per script include.
async function trySyncPendingJobs() {
  if (!apiConfigured() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  let jobs;
  try {
    jobs = await getAllJobs();
  } catch (err) {
    return;
  }
  for (const job of jobs) {
    if (job.syncStatus === 'synced') continue;
    const status = await syncJob(job);
    if (status !== job.syncStatus) {
      try { await updateSyncStatus(job.addressKey, status); } catch (err) { /* best effort */ }
    }
  }
}
