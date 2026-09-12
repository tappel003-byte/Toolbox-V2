// Customer hub: the four-drawer landing page for one existing customer.
// Also owns voice memo capture — memos live with the customer, not any one
// drawer, per today's rule that anything about the customer (not a specific
// technical survey) belongs at the cabinet level.

let currentJob = null;
let currentKey = null;
let mediaRecorder = null;
let audioChunks = [];
let recordStartMs = 0;
const clipObjectUrls = {}; // clip.id -> object URL, so we can revoke on re-render

function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

async function loadCustomer() {
  const params = new URLSearchParams(location.search);
  currentKey = params.get('job');
  const editLink = document.getElementById('btn-edit-info');

  if (!currentKey) {
    location.href = 'index.html';
    return;
  }

  editLink.href = `job.html?job=${encodeURIComponent(currentKey)}`;
  document.getElementById('drawer-report-builder').href = `report.html?job=${encodeURIComponent(currentKey)}`;
  document.getElementById('drawer-diagnostics').href = `diagnostics.html?job=${encodeURIComponent(currentKey)}`;
  document.getElementById('drawer-distress-survey').href = `distress-survey.html?job=${encodeURIComponent(currentKey)}`;

  try {
    currentJob = await getJob(currentKey);
  } catch (err) {
    document.getElementById('customer-address').textContent = 'Could not open this customer file.';
    document.getElementById('customer-meta').textContent = err.message || String(err);
    return;
  }

  if (!currentJob) {
    location.href = 'index.html';
    return;
  }

  const name = (currentJob.people && currentJob.people.primaryName) || '';
  document.getElementById('customer-title').textContent = name || 'Customer';
  document.getElementById('customer-address').textContent = currentJob.address || '(no address)';

  const metaParts = [];
  if (name) metaParts.push(name);
  if (currentJob.rooms && currentJob.rooms.length) metaParts.push(`${currentJob.rooms.length} room${currentJob.rooms.length === 1 ? '' : 's'}`);
  if (currentJob.updatedAt) metaParts.push(`updated ${formatUpdated(currentJob.updatedAt)}`);
  document.getElementById('customer-meta').textContent = metaParts.join(' · ');

  renderClips();
  renderDrawerDataSummary();
}

// ---- drawer data import (bridge until drawers live inside Toolbox) ----

function showImportStatus(text) {
  const el = document.getElementById('import-status');
  el.textContent = text;
  el.style.display = text ? '' : 'none';
}

function renderDrawerDataSummary() {
  const list = document.getElementById('drawer-data-summary');
  const parts = [];
  if (currentJob.distressSurvey) {
    const ds = currentJob.distressSurvey;
    const dateLabel = ds.updatedAt ? `updated ${formatUpdated(ds.updatedAt)}` : `imported ${formatUpdated(ds.importedAt)}`;
    parts.push(`<div class="card" style="padding:10px;">Distress Survey — ${ds.pins.length} pin${ds.pins.length === 1 ? '' : 's'} ${dateLabel}</div>`);
  }
  if (currentJob.floorSurvey) {
    const fs = currentJob.floorSurvey;
    parts.push(`<div class="card" style="padding:10px;">Floor Survey — ${fs.floors.length} floor${fs.floors.length === 1 ? '' : 's'}, ${fs.points.length} point${fs.points.length === 1 ? '' : 's'} imported ${formatUpdated(fs.importedAt)}</div>`);
  }
  list.innerHTML = parts.join('');
}

document.getElementById('btn-import-ds').addEventListener('click', () => {
  document.getElementById('f-import-ds').click();
});
document.getElementById('btn-import-fs').addEventListener('click', () => {
  document.getElementById('f-import-fs').click();
});

document.getElementById('f-import-ds').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    // Re-importing replaces only the previously-imported pins (a corrected
    // export overwrites the old one); any pins captured natively in the
    // Distress Survey drawer since then are tagged origin:'native' and are
    // never touched by an import, so they can't be silently wiped.
    const importedPins = parseDistressSurveyCsv(text).map((p) => ({ ...p, origin: 'import' }));
    let nativePins = ((currentJob.distressSurvey && currentJob.distressSurvey.pins) || [])
      .filter((p) => p.origin === 'native');
    // Imported numbers are fixed — they match Tim's physical photo prints
    // from the old app. A native pin created before this import could
    // coincidentally reuse one of those numbers; if so, bump the native
    // pin (never the import) to the next free number instead.
    const usedNumbers = new Set(importedPins.map((p) => p.pin));
    let nextFree = importedPins.length ? Math.max(...importedPins.map((p) => p.pin)) + 1 : 1;
    nativePins = nativePins.map((p) => {
      if (!usedNumbers.has(p.pin)) { usedNumbers.add(p.pin); return p; }
      const bumped = { ...p, pin: nextFree };
      usedNumbers.add(nextFree);
      nextFree += 1;
      return bumped;
    });
    currentJob.distressSurvey = {
      ...(currentJob.distressSurvey || {}),
      pins: importedPins.concat(nativePins),
      importedAt: Date.now(),
    };
    await saveJob(currentJob);
    renderDrawerDataSummary();
    showImportStatus('');
    showToast(`Imported ${importedPins.length} pins.`);
  } catch (err) {
    showImportStatus(`Distress Survey import failed: ${err.message || err}`);
  }
});

document.getElementById('f-import-fs').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const bundle = parseFloorSurveyJson(text);
    currentJob.floorSurvey = { ...bundle, importedAt: Date.now() };
    await saveJob(currentJob);
    renderDrawerDataSummary();
    showImportStatus('');
    showToast(`Imported ${bundle.floors.length} floor(s), ${bundle.points.length} points.`);
  } catch (err) {
    showImportStatus(`Floor Survey import failed: ${err.message || err}`);
  }
});

// ---- voice memos ----

function renderClips() {
  const list = document.getElementById('clip-list');
  const clips = (currentJob && currentJob.audioClips) || [];

  Object.values(clipObjectUrls).forEach((url) => URL.revokeObjectURL(url));
  for (const k in clipObjectUrls) delete clipObjectUrls[k];

  if (!clips.length) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = '';
  for (const clip of clips) {
    const url = URL.createObjectURL(clip.blob);
    clipObjectUrls[clip.id] = url;

    const row = document.createElement('div');
    row.className = 'card';
    row.style.padding = '10px';
    row.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
        <span style="font-size:13px;color:var(--ink-soft);">${escapeHtml(formatUpdated(clip.recordedAt))} · ${escapeHtml(formatDuration(clip.durationSec))}</span>
        <button type="button" class="icon-btn" data-clip-id="${escapeHtml(clip.id)}" aria-label="Delete voice memo">&times;</button>
      </div>
      <audio controls style="width:100%;" src="${url}"></audio>
    `;
    row.querySelector('.icon-btn').addEventListener('click', () => deleteClip(clip.id));
    list.appendChild(row);
  }
}

async function deleteClip(id) {
  if (!confirm('Delete this voice memo? This cannot be undone.')) return;
  currentJob.audioClips = (currentJob.audioClips || []).filter((c) => c.id !== id);
  await saveJob(currentJob);
  renderClips();
  showToast('Voice memo deleted.');
}

function setRecordingUi(recording, statusText) {
  const btn = document.getElementById('btn-record');
  const status = document.getElementById('record-status');
  btn.textContent = recording ? '■ Stop Recording' : '● Record Voice Memo';
  btn.classList.toggle('btn-danger', recording);
  btn.classList.toggle('btn-primary', !recording);
  if (statusText) {
    status.textContent = statusText;
    status.style.display = '';
  } else {
    status.style.display = 'none';
  }
}

// Resolves once the in-flight recording has been fully stopped, assembled,
// and saved (or discarded as empty) — set fresh each time recording starts.
// Anything that needs to navigate away has to await this first, or a
// recording in progress gets silently lost.
let recordingStopped = Promise.resolve();

async function startRecording() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    showToast('Could not access the microphone. Check permissions.');
    return;
  }

  audioChunks = [];
  const mimeType = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
  mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

  mediaRecorder.addEventListener('dataavailable', (e) => {
    if (e.data && e.data.size > 0) audioChunks.push(e.data);
  });

  recordingStopped = new Promise((resolveStopped) => {
    mediaRecorder.addEventListener('stop', async () => {
      stream.getTracks().forEach((t) => t.stop());
      const durationSec = (Date.now() - recordStartMs) / 1000;
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });

      if (blob.size === 0) {
        setRecordingUi(false, '');
        showToast('No audio captured — nothing saved.');
        resolveStopped();
        return;
      }

      const clip = {
        id: `clip-${Date.now()}`,
        blob,
        mimeType: blob.type,
        durationSec,
        recordedAt: Date.now(),
      };
      currentJob.audioClips = currentJob.audioClips || [];
      currentJob.audioClips.push(clip);

      setRecordingUi(false, 'Saving…');
      try {
        await saveJob(currentJob);
        showToast('Voice memo saved.');
      } catch (err) {
        showToast(`Could not save: ${err.message || err}`);
      }
      setRecordingUi(false, '');
      renderClips();
      resolveStopped();
    });
  });

  mediaRecorder.start();
  recordStartMs = Date.now();
  setRecordingUi(true, 'Recording… tap Stop when done.');
}

// Stops recording (if any) and returns a promise that resolves once the
// clip has actually been saved — callers that need to navigate away must
// await this rather than firing stop() and moving on immediately.
function stopRecordingAndWait() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
  return recordingStopped;
}

document.getElementById('btn-record').addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopRecordingAndWait();
  } else {
    startRecording();
  }
});

// A recording in progress must never be abandoned by navigating away —
// intercept any link click on this page, finish and save the recording
// first, then continue to wherever the link was headed.
document.addEventListener('click', (e) => {
  if (!(mediaRecorder && mediaRecorder.state === 'recording')) return;
  const link = e.target.closest('a[href]');
  if (!link) return;
  e.preventDefault();
  const destination = link.href;
  showToast('Saving your recording before leaving…');
  stopRecordingAndWait().then(() => {
    location.href = destination;
  });
}, true);

loadCustomer();
