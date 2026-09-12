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

function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
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
}

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

  mediaRecorder.addEventListener('stop', async () => {
    stream.getTracks().forEach((t) => t.stop());
    const durationSec = (Date.now() - recordStartMs) / 1000;
    const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });

    if (blob.size === 0) {
      setRecordingUi(false, '');
      showToast('No audio captured — nothing saved.');
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
  });

  mediaRecorder.start();
  recordStartMs = Date.now();
  setRecordingUi(true, 'Recording… tap Stop when done.');
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

document.getElementById('btn-record').addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopRecording();
  } else {
    startRecording();
  }
});

loadCustomer();
