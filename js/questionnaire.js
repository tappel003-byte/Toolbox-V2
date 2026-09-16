// Symptom questionnaire: three fields, saved onto the job. Opened from
// job.html's setup screen once a job exists; not a stand-alone entry point.

const params = new URLSearchParams(location.search);
const jobKey = params.get('job');

const els = {
  backLink: document.getElementById('back-link'),
  form: document.getElementById('questionnaire-form'),
  startedWhen: document.getElementById('f-started-when'),
  noticed: document.getElementById('f-noticed'),
  otherNotes: document.getElementById('f-other-notes'),
};

if (!jobKey) {
  location.href = 'index.html';
} else {
  els.backLink.href = `job.html?job=${encodeURIComponent(jobKey)}`;
}

async function loadQuestionnaire() {
  if (!jobKey) return;
  const job = await getJob(jobKey);
  if (!job) {
    location.href = 'index.html';
    return;
  }
  const q = job.questionnaire || {};
  els.startedWhen.value = q.startedWhen || '';
  els.noticed.value = q.noticed || '';
  els.otherNotes.value = q.otherNotes || '';
}

els.form.addEventListener('submit', async (evt) => {
  evt.preventDefault();
  const job = await getJob(jobKey);
  if (!job) {
    showToast('Could not find this job.');
    return;
  }
  job.questionnaire = {
    startedWhen: els.startedWhen.value.trim(),
    noticed: els.noticed.value.trim(),
    otherNotes: els.otherNotes.value.trim(),
    updatedAt: Date.now(),
  };
  try {
    await saveJob(job);
    location.href = `job.html?job=${encodeURIComponent(jobKey)}`;
  } catch (err) {
    showToast(`Could not save: ${err.message || err}`);
  }
});

loadQuestionnaire();
