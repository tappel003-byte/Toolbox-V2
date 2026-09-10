# Punch list: how Distress Survey and Floor Survey would later read the job pocket

This is a plan, not a change. Nothing in this file has been applied to
`field-reporter-pro` (Distress Survey) or `floorplan-topo-maker` (Floor
Survey). Neither app has been touched. Do not apply any of this without
Tim listing the exact change first.

## What exists today (confirmed)

**Distress Survey** (`field-reporter-pro`)
- The real field app is `public/survey.html`, one file, no build step.
- Own IndexedDB: `pgg_photos_v1`, used for pin photos. Separate from the
  job pocket. Nothing in Distress currently reads `rooms` or `frontDoor`.
- Service worker: Workbox, `src/sw.ts`, `injectManifest` strategy.
  - HTML navigations: `NetworkFirst`, cache `html-navigations`, 3s
    network timeout, falls back to cache offline.
  - Same-origin JS/CSS/worker: `CacheFirst`, cache `app-shell-assets`.
  - manifest `start_url`: `/survey.html?pwa=fr-v2` (not just `/survey.html`)
  - manifest `scope`: `/`

**Floor Survey** (`floorplan-topo-maker`)
- TanStack Start + React, routes `index.tsx`, `projects.$id.tsx`.
- Service worker: Workbox, `src/sw.ts`, `injectManifest` strategy, same
  `NetworkFirst` / `CacheFirst` pattern, same cache names
  (`html-navigations`, `app-shell-assets`).
- manifest `start_url`: `/`

## The rule this punch list has to satisfy

Offline capture in the basement is paramount. A drawer's installed PWA
must keep launching at its existing `start_url` inside its existing
`scope`, from its existing caches, with its existing service worker
untouched. Toolbox V2 reading or writing anything must never become a
precondition for a drawer opening offline. If a drawer page itself was
never cached on a given phone, no amount of pocket-reading fixes that —
that's an honest "not cached here," not a bug to route around.

## Proposed read-only integration (not yet built)

1. **Read once, on launch, best-effort.**
   Each drawer's app-shell JS (already served from `app-shell-assets`)
   would, after its own boot, try to open `sandia-job-pocket` and read
   the job matching the current address context (however that drawer
   already identifies "which job am I on" — TBD per drawer, see below).
   If IndexedDB is unavailable, empty, or throws, the drawer proceeds
   exactly as it does today. The read is a bonus, never a dependency.

2. **No writes back.** Drawers only capture into their own storage
   (`pgg_photos_v1` for Distress, whatever Floor already uses). They
   never write into `sandia-job-pocket`. Toolbox V2 remains the only
   writer, so there's one source of truth for people/address/plan/rooms/
   front door and no merge conflicts to resolve.

3. **No live-locking.** A drawer reads the pocket once at launch, not on
   an interval, not via a live subscription. Toolbox being closed, or
   never having been opened on that phone, cannot block or slow a
   drawer's own launch or capture.

4. **Address as the join key.** The pocket's key is a normalized address
   (see `js/db.js` `normalizeAddress()` in this repo). A drawer would
   need its own concept of "current address" to look up against — for
   Distress that likely means reading it from wherever the field app
   already tracks a job/site identifier today (needs Tim/Grok to confirm
   where that lives in `survey.html`); for Floor, likely tied to the
   `projects.$id` route param resolving to an address somewhere.
   This is the open question before any code changes: neither app has
   a `rooms`/`frontDoor` concept yet, so "which job is this" has to be
   answered first.

5. **Never touch the service worker for this.** The pocket read happens
   in application JS after the shell is already running — it is not a
   fetch the service worker needs to intercept, cache, or know about.
   `src/sw.ts`, the cache names, and `start_url` in both apps stay
   exactly as they are.

6. **Deep-linking, if ever wanted.** If Toolbox V2 later needs to open a
   drawer with a job pre-selected, the link has to resolve to the
   drawer's real `start_url` (`/survey.html?pwa=fr-v2` for Distress, `/`
   for Floor) or the installed PWA won't recognize it as its own launch
   point and may open a second, uninstalled browser tab instead. A
   query string cannot carry the plan photo (too large for a URL) — the
   photo has to already be sitting in the pocket for the drawer to pick
   up locally.

## Explicitly out of scope for this punch list

- Changing `pgg_photos_v1` or any Distress storage.
- Changing Floor Survey's storage.
- Wiring the drawer buttons in `job.html` to real URLs.
- Any multi-device live sync (that's the longer-term vision, not this).
