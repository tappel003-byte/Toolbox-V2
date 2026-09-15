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

// sw.js is NOT registered — it broke Safari (serving a redirect from a
// service worker permanently kills the page: "Response served by service
// worker has redirections"). Left in the repo, unregistered, from every
// page that loads util.js.
if ('serviceWorker' in navigator && new URLSearchParams(location.search).get('sw') === 'off') {
  // Escape hatch for a device still stuck on a previously-installed worker:
  // ?sw=off unregisters every service worker on this origin.
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
}
