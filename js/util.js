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
// worker has redirections"). Left in the repo, unregistered.
//
// Unconditional, every page load: a device that already installed the old
// worker before this fix shipped needs it removed, not just left alone —
// waiting on a ?sw=off query the customer would never think to type is not
// a real fix.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
}
