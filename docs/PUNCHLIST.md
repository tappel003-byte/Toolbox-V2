# Punch list: how Distress Survey and Floor Survey would later read the job pocket

This is a plan, not a change. Nothing in this file has been applied to
`field-reporter-pro` (Distress Survey) or `floorplan-topo-maker` (Floor
Survey). Neither app has been touched. Do not apply any of this without
Tim listing the exact change first.

## Standing rule: customer contact info lives solely in Toolbox

Tim: any customer contact information — billing address, a second
address, spouse/second name, email, cell phone, etc. — is entered once,
in Toolbox V2's Customer Contact section, and nowhere else. It
propagates out to drawers as needed; drawers don't collect or ask for
it themselves. This sits alongside the existing rule for plan photo /
rooms / front door: the cabinet is the one place any of this is typed
in. `job.people` now carries `primaryName`, `secondName`, `cellPhone`,
`email`, `billingSameAsSite`, `billingAddress`, `secondAddress` — see
`job.html` / `js/job.js`.

## Architecture shift: shared backend, not local-only (in progress)

Tim: this isn't a one-off. Report Builder builds on Distress Survey's
output, something builds on Floor Survey's, Diagnostics may feed the
report too, and he may have ~10 customer files open in Toolbox at once
across devices — plus all photos need to actually live on a server
(Cloudflare) until downloaded to his own server or Google Drive. Local
IndexedDB on one phone can't satisfy that: a customer entered in
Toolbox has to be visible from Distress Survey (and any other drawer),
regardless of device.

**Direction, now underway:**
- **Cloudflare D1** database `toolbox-v2` (id
  `236b342f-3738-4d65-a29f-152836d513e0`) holds the shared customer
  roster — created, schema in place (`customers`, `rooms` tables).
- **A Cloudflare Worker** (`worker/src/index.js`) is the API in front
  of it: list/get/put/delete a customer. Written, not deployed yet —
  see `worker/README.md` for exactly what's missing (deploy access, an
  access key, and why deploy can't happen from this session).
- **R2 bucket for photos is blocked.** Creating it was refused by a
  "modify shared resources" permission gate — it touches the same
  Cloudflare account as Tim's other live sites, so it needs his
  explicit approval. Nothing to do here until that's granted.
- **IndexedDB becomes the offline cache, not the source of truth.**
  Once the Worker is live, `js/db.js` should write through to the API
  when online and fall back to the local copy when there's no signal
  — this is what keeps the "basement with no signal" case working
  while still giving every device the same roster. **Not built yet** —
  today `js/db.js` still only writes locally. This is the next real
  chunk of work, and it touches the save/load path on every screen, so
  it's being called out here rather than done silently.
- **Home screen framing.** Tim's mental model: Toolbox's first screen
  is fundamentally a customer-contact roster (list + "add a customer"),
  which is close to what `index.html` already is — worth confirming
  the framing (copy, ordering) matches once the backend is live and
  there's a real multi-customer list to look at.

**Open, needs Tim:**
1. Approve R2 bucket creation (`toolbox-v2-photos`) so photo bytes have
   somewhere to live.
2. A way to deploy the Worker — either Tim running `wrangler deploy`
   from `worker/` once, or a Cloudflare API token this session can use.
3. Access control: single shared key for now, or does anyone besides
   Tim need their own login (e.g. Lee)? Changes how much auth work this
   needs before it's safe to point a real device at it.

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

## Update: room auto-fill, ported into the cabinet (built)

Tim asked for Distress Survey's room auto-fill to happen on Toolbox's
setup screen, and for Floor Survey's setup screen to be looked at for the
same consolidation. Here's what was found and what was actually built —
all inside Toolbox-V2 only, nothing changed in Distress or Floor.

**What Distress Survey's setup screen (`#screenSetup` in `survey.html`)
actually does**, beyond address/plan/front-door:
- A **Building Type** picker (Residential, Office, Medical, Vet, Dental,
  Warehouse) that selects a preset room list — a "Common" fast-tap set
  and a larger "Specialty" set (`BUILDING_TYPES` in `survey.html`).
- **"🔍 Read labels"** — loads Tesseract.js (`cdn.jsdelivr.net/npm/tesseract.js@5.1.1`,
  loaded on demand, not bundled) and runs 7 OCR passes over the plan
  photo (color-label-pill isolation for CAD-style red/orange room tags,
  upright, block-mode, and both sideways rotations), matches recognized
  text against a large regex alias table (`ROOM_KEYWORD_ALIASES`) to snap
  it to a canonical preset name, and drops each match onto the plan at
  the position it was read from. Cross-pass voting and confidence floors
  suppress one-off misreads.
- **"➕ Find more"** — an additive deep pass: 6000px upscale, a 5×5
  tiled grid with overlap, plus a digit-only whitelist pass for
  commercial room numbers ("143", "101A"). Only adds; never renames or
  removes what's already there.
- Rooms are chips on the setup screen and pins on the plan photo; tap a
  chip or pin to remove it.

**What Floor Survey's setup screen (`SetupTab.tsx`) does** — a different
shape, not room-based:
1. **Details** — inspection date, project name, address, client,
   inspector, notes. This is a straight duplicate of fields Toolbox's
   job screen already has.
2. **Plan** — Floor Survey supports **multiple floors**, each an
   independent record with its own uploaded plan image
   (`{id, name, planDataUrl, planWidth, planHeight, boundary}`).
3. **Topo boundary** — freehand polygon(s) drawn on each floor's plan,
   used as the area a topo survey will actually measure.
4. **Excluded areas** — more polygons marking regions to skip inside a
   boundary.
There is no "rooms" concept in Floor Survey — steps 3–4 are about survey
geometry, not room labels, so Distress's OCR engine doesn't map onto it.

**Built into Toolbox-V2's job screen** (`js/room-ocr.js`, wired into
`job.html`/`js/job.js`): the Building Type picker, the fast-tap chip
list, "🔍 Read labels" and "➕ Find more", ported faithfully from
`survey.html` (same regex tables, same multi-pass/tiling/voting logic,
same Tesseract.js version/CDN). Rooms in the cabinet's schema are now
`{id, name, x?, y?}` — `x`/`y` are set when a room came from a tap or an
OCR hit, and rendered as pins on the plan photo; chip-added and manually
typed rooms stay position-less until a scan places them. This covers the
part of Floor Survey's Details step that overlaps the cabinet (address,
inspector, notes, etc. already exist here) — nothing new was needed
there.

**Not built, and flagged before going further — needs Tim/Grok's call:**

Floor Survey's **multi-floor** model and its **topo boundary /
excluded-area** drawing do not fit the cabinet's current one-plan-per-job
shape, and they read more like the drawer's own capture/thinking than
cabinet setup:
- The vision doc names "plan photo, rooms, front door" as cabinet fields.
  It does not name topo boundaries or multiple floors. Marking out where
  a topo survey will actually measure looks like survey work, not
  administrative setup — closer to "capture" than to the cabinet's job.
- If boundary/exclusion drawing does move into the cabinet anyway, the
  job pocket's schema needs a real rethink first: one `planImage` per job
  becomes a `floors: [{name, planImage, boundary, exclusions}]` array,
  which changes what "the plan photo" means everywhere else in Toolbox
  (the front-door marker is currently placed on *the* plan; which floor's
  plan would it belong to?).

Before touching either of those, or before any actual wiring of Distress
Survey / Floor Survey to read from the pocket (the "transfer out to the
apps" half), this punch list needs Tim to say explicitly: (a) does topo
boundary/exclusion drawing belong in the cabinet's job schema, and (b)
the exact change to make in each app's own repo — per the hard rule,
neither `field-reporter-pro` nor `floorplan-topo-maker` gets edited on a
general instruction alone.
