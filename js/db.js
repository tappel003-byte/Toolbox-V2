// Job pocket: the shared IndexedDB store that holds one record per customer job.
// Toolbox V2 is the only writer. Field drawers (Distress, Floor, etc.) will later
// read a job once on launch — see docs/PUNCHLIST.md. Nothing here talks to a server.

const JOB_POCKET_DB = 'sandia-job-pocket';
const JOB_POCKET_VERSION = 1;
const JOBS_STORE = 'jobs';

// Every getJob/saveJob/etc. call used to open a brand-new IDBDatabase
// connection and never close it — a real connection leak on any long
// session with a lot of edits. Caching one shared connection promise
// means every caller reuses the same open connection instead of piling
// up new ones.
let __jobPocketPromise = null;
function openJobPocket() {
  if (!__jobPocketPromise) {
    __jobPocketPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(JOB_POCKET_DB, JOB_POCKET_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(JOBS_STORE)) {
          db.createObjectStore(JOBS_STORE, { keyPath: 'addressKey' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        __jobPocketPromise = null;
        reject(req.error);
      };
    });
  }
  return __jobPocketPromise;
}

// Normalize an address into a stable lookup key: lowercase, collapse
// whitespace, strip punctuation. This is the primary key for a job —
// it's how a field drawer will later match "the job already on this phone".
function normalizeAddress(address) {
  return String(address || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function saveJob(job) {
  const addressKey = normalizeAddress(job.address);
  if (!addressKey) throw new Error('Job needs an address before it can be saved.');
  const record = { ...job, addressKey, updatedAt: Date.now() };
  const db = await openJobPocket();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(JOBS_STORE, 'readwrite');
    tx.objectStore(JOBS_STORE).put(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

async function getJob(addressKey) {
  const db = await openJobPocket();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(JOBS_STORE, 'readonly');
    const req = tx.objectStore(JOBS_STORE).get(addressKey);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function getAllJobs() {
  const db = await openJobPocket();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(JOBS_STORE, 'readonly');
    const req = tx.objectStore(JOBS_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function deleteJob(addressKey) {
  const db = await openJobPocket();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(JOBS_STORE, 'readwrite');
    tx.objectStore(JOBS_STORE).delete(addressKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
