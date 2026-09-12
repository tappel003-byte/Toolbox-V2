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

## Update: verified against real exports and real source (not inference)

Tim sent real Distress Survey / Floor Survey export files from real jobs
and pushed back when a couple of things I'd said turned out to be guesses
dressed up as fact. Re-read the actual source instead of relying on
summarized memory of it. Corrections and confirmations below — read this
before assuming anything about either app's data shape.

**Distress Survey's real `pins.csv` schema** (verified against a real
export, cross-checked against `survey.html`'s own export code, line ~6078):

```
Pin, Type, Description, Photo Count, Photo Numbers, Room, Direction, X, Y
```

- `Pin` — a plain sequential number. Earlier I said pin identifiers were
  room names based on one rendered PDF that happened to display Room in
  the pin badge instead of the number — that was wrong as a general rule.
  Pin (number) and Room (name) are two distinct columns.
- `Photo Numbers` — a human-readable range **string** ("2 to 3", "10 to
  11"), not a structured list. One pin can absorb several consecutive
  shutter presses under one description.
- `Direction` — compass letter (N/S/E/W/etc.), **relative to the front
  door's established orientation**, not absolute. Not something I'd seen
  in any code I'd read before — real, exists, worth remembering.
- `X`, `Y` — 0–1 fractions of the plan image, confirmed.

**The pin-log PDF (`buildPinLogPdf()`) is only partly flattened.** The
plan-plus-pin-dots map is a single baked PNG (`composeMapImage`) — moving
a pin's position does need a re-export. But the Photo/#/Location/Notes
table is real vector PDF text, rebuilt fresh from `project.pins` on every
export — not a picture. So the "fix a typo without re-exporting" idea was
already half-true for the text table; it's specifically pin *position on
the map* that's baked in, not the descriptive text.

**Floor Survey's real data model is considerably richer than what I'd
described from memory.** Verified directly against `src/lib/types.ts`:

- **Scale calibration already exists and ships today** — `Floor.scale =
  { a: {x,y}, b: {x,y}, lengthInches }`. The "measure a known wall length"
  feature Tim and I designed from scratch a few days ago, treating it as
  a gap to fill later, is not a gap — it's already built. Diagnostics can
  assume real-unit conversion is available now, not pending a future
  build.
- **`SurveyPoint.value` is already a real elevation reading in inches**
  (instrument-calibrated), not a normalized unit. Only the `x`/`y` plan
  position is pixel-space needing `Floor.scale` to become real feet.
- **`TopoArea[]`** — multiple independently-named survey areas per floor,
  each its own polygon and its own H/L/Δ stat pill position. This is the
  real mechanism behind "several localized topo exhibits from one floor
  plan" (confirmed against the real Vegas NM report's Figures 1–4).
- **`Exclusion[]`** — polygon holes inside the boundary, real and typed,
  though absent from both real export files reviewed so far (may just be
  unused on those two jobs, not evidence the feature doesn't work).
- **`Transition[]`** — flooring-material-change corrections at doorways
  (e.g. Hardwood→Laminate), readings on both sides, `parentId` chaining
  when transitions compound, and an opt-in `useGroupAverage` to apply one
  averaged correction across every doorway of the same surface pair
  instead of each one's own noisy reading. This is real, already-shipped
  infrastructure for exactly the "adjust for floor coverings before
  analysis" pre-processing step the Diagnostics brief calls for — it does
  not need to be invented, only consumed.
- **Real gap, confirmed across two independent real jobs, not a guess:**
  points essentially never carry a `label` beyond the one base point
  ("BP1"). Epoch Comparison's design (in the Diagnostics brief) matches
  points *by label* between two surveys — that data mostly doesn't exist
  yet. Needs a decision from Tim: add point labeling to Floor Survey's
  capture flow, or have Epoch Comparison match by index/position instead.

**3D visualization already exists in Floor Survey — `ThreeDTab.tsx`.**
Real, working, Three.js-based: rotatable colored elevation mesh built
from the same grid as the 2D Topo view, free-orbit camera, height
exaggeration slider, optional point spheres, and PNG screenshot export
already built in. This is Diagnostics screen #1 from the brief, already
shipped — not a green-field build.

**Locked decision (Tim, this conversation):** going forward, 3D
visualization lives in Diagnostics only. The Toolbox-native Floor Survey
rebuild will not include a 3D tab at all. Diagnostics' own 3D screen gets
built fresh in Toolbox, informed by `ThreeDTab.tsx`'s proven approach —
never by editing or removing anything in the standalone
`floorplan-topo-maker` repo, which stays untouched per the hard rule.

**Still an open question, not resolved:** the Diagnostics brief also
describes tilt/deflection, IQR, time-change, and monitoring as "existing
screens" to wire up. Searched all of Floor Survey's source for
deflection, IQR, monitoring, time-change, epoch, angular distortion, and
Skempton — none of it exists anywhere in this codebase. Either those four
live in some other tool/file Tim has that hasn't been shared, or
"existing" in the brief meant "already agreed as a screen to build," not
"already coded." Needs Tim to clarify before assuming either way.

## Diagnostics screen #1 (3D elevation view) — built

Diagnostics is now a live drawer on the hub, not a placeholder. First
screen: a rotatable colored elevation mesh, `diagnostics.html` /
`js/diagnostics.js`. It reads the same imported Floor Survey data Report
Builder reads (strictly read-only, same rule) and applies the same
transition corrections before building the surface.

- **The math is ported, not reinvented.** `js/topo-grid.js` carries the
  thin-plate-spline interpolation (`buildGrid`) straight from
  `floor/src/lib/topo.ts`, and the mesh-building steps (grid → colored
  vertices → triangle indices → point spheres) follow
  `floor/src/components/ThreeDTab.tsx`'s approach. Both are reference-only
  reads of the standalone repo; nothing there was touched.
- **`js/floor-survey-math.js`** — the transition-correction functions
  (`correctedPointValue` etc.) were pulled out of `report.js` into their
  own shared module so Diagnostics and Report Builder use the exact same
  corrected values, not two copies that could drift apart.
- **three.js is vendored locally** (`js/vendor/three.min.js` +
  `OrbitControls.js`, r128 — the last version with a plain global-script
  build), same reasoning as jsPDF: the actual deliverable shouldn't depend
  on a CDN being reachable.
- **No palette picker in v1.** Real Floor Survey's `ThreeDTab` takes
  `palette`/`reversePalette` from the app's `RenderSettings`, which
  Toolbox doesn't store (the imported bundle doesn't carry them). Shipped
  with one fixed palette (`topographic`) instead of inventing a settings
  layer that doesn't exist yet. Revisit if Tim wants palette choice here.
- Verified end to end: empty state with no Floor Survey data, mesh
  renders and colors correctly from real point data, floor picker across
  multiple floors, height-exaggeration slider and show-points toggle work
  without mutating stored data (checked byte-for-byte), PNG export
  produces a real image, and the friendly "need at least 3 points" /
  "boundary missing" messages match Floor Survey's own.

## Distress Survey — first native drawer build (no longer import-only)

Distress Survey is now a live drawer with its own capture screen
(`distress-survey.html` / `js/distress-survey.js`), not just the CSV
import bridge. This is the first of the two "sacred cow" drawers actually
rebuilt inside Toolbox — Floor Survey's own native capture is still ahead.

- **Direction is computed, never typed.** `js/distress-math.js` ports
  `pinCardinal()`/`_orientationOffset()`/`_originXY()` from the real
  `distress/survey.html` verbatim (cross-checked against `_rvPointToPlan()`
  to confirm both apps store front-door/pin coordinates as the same 0-1
  fraction, so the port only drops survey.html's own pixel-to-fraction
  division — the bearing math itself is untouched). A pin's compass
  direction comes straight from where you tapped relative to the front
  door set in job setup, same as the real app.
- **v1 is the core loop, not full parity, on purpose.** Tap to drop a pin,
  interior/exterior, room (picked from the room list already captured in
  setup — real survey.html's OCR-based auto-room-guess wasn't ported this
  pass), description, real attached photos. Not carried over: photo
  annotation/strokes, the photo viewer, project-level internal/external
  "mode", and the whole trash/backup/export-reminder system — all
  superseded by Toolbox's own job pocket and cabinet, which already do
  that job at the customer level instead of per-survey.
- **Real photos replace the old photo-number placeholder.** The CSV
  bridge's pins carry a `photoNumbers` text range because that format
  cross-references a separate folder of camera-roll photos; native
  capture stores the actual photo as a Blob (same pattern as voice
  memos), so that whole numbering-reservation scheme doesn't apply and
  wasn't ported. Report Builder shows whichever the pin actually has
  (`photoNumbers` for imported pins, a real "N photo(s)" count for
  native ones).
- **Import and native capture coexist safely — found and fixed two real
  bugs getting there, not assumed.** Testing the two mechanisms together
  (not just each alone) surfaced actual data-loss and numbering-collision
  bugs before they could ship:
  - The CSV import handler used to replace `job.distressSurvey` wholesale.
    Once native pins could exist in the same job, that would silently
    wipe them on any re-import. Fixed: every pin is tagged
    `origin: 'native'` or `'import'`; import now only replaces
    `'import'`-tagged pins and always keeps `'native'` ones (editing an
    imported pin from the native screen re-tags it `'native'` too, so a
    touched-up import survives a later re-import as well).
  - Pin numbers aren't interchangeable: an imported pin's number matches
    a physical photo print from the old app and must never move, while a
    native pin has no such paper trail and is safe to renumber. So on
    import, a colliding native pin number gets bumped to the next free
    slot — the import's own numbers are never touched. Verified with a
    constructed collision (native pin captured as #1, then a CSV
    imported whose own pins are also numbered 1/2/4/5) rather than
    assumed to be fine.
  - Also decided against the real app's own behavior of renumbering all
    remaining pins sequentially after a delete — that's fine in
    survey.html where every pin comes from the same source, but here it
    would drag imported pin numbers out from under their photo prints.
    Deleting a pin now just retires its number; gaps are normal (the real
    sample export itself skips pin 3).
  - Saving the description field on every keystroke (the first draft)
    would have let overlapping async saves interleave and drop text —
    the same class of bug fixed earlier in job.js's edit form. Fixed
    before it shipped: local state updates live, the actual save only
    fires on blur.
- Verified end to end: empty state with no plan photo, direction computed
  correctly against a known front-door facing, room/type/description/photo
  all persist across reload, delete doesn't renumber survivors, the
  import/native collision case above, and Report Builder rendering both
  pin sources correctly in one schedule.
