// Small helpers shared across every Toolbox screen. Loaded before each
// screen's own script on every page that needs them.

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

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

// Registers the app-shell service worker (sw.js) once, from whichever
// page happens to load first — every screen loads util.js, so this only
// needs to live in one place. Makes the app itself (not just customer
// data, already offline-safe in IndexedDB) load with no connectivity
// after the first visit.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Offline on a first-ever visit, or serving over plain HTTP where
      // service workers aren't allowed — the app still works online-only
      // in that case, just without the offline-shell benefit.
    });
  });
}
