# Distress Survey — copy

A verbatim copy of the real field app from `tappel003-byte/field-reporter-pro`
as of the copy date below, made because Tim asked for Toolbox V2 to hold the
copies going forward instead of the original repos. `field-reporter-pro`
itself is untouched and stays the live app until this copy is ready to take
over.

**Copied as-is, byte-for-byte:**
- `survey.html` — the actual field app (identical to `public/survey.html`
  in the source repo).
- `mock-sheet.html`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png`
  — same as the source repo's `public/`.
- `sw.ts` — the service worker *source*. In the original repo this is
  compiled into a real `sw.js` by a Workbox `injectManifest` build step
  (Vite + `vite-plugin-pwa`, run through Lovable's TanStack/Cloudflare
  tooling). That build step has **not** been reproduced here yet, so this
  copy has no working service worker and is **not offline-capable** in
  this location — opening `distress/survey.html` here needs a live
  connection every time, unlike the real app.

**Not yet decided:** whether Toolbox V2 brings over the *whole* build
pipeline (the real app is a full Lovable-managed TanStack Start + Cloudflare
Vite project with a large npm dependency tree — not just this one file) so
this copy can build its own working `sw.js`, or whether Distress Survey
keeps building separately and only its output gets synced in here. See the
note in `../docs/PUNCHLIST.md`.

**Do not wire a drawer button to this folder yet.** It looks like the real
app but doesn't have the real app's offline guarantee — pointing a door at
it before that's resolved would be the "fake one roof" the brief warns
against.
