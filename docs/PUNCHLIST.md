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

## Floor Survey — first native drawer build (all four drawers now live)

Floor Survey now has its own capture screen too (`floor-survey.html` /
`js/floor-survey-capture.js`): draw a floor's boundary, then tap inside it
to drop survey points and type each elevation reading. This is the second
"sacred cow" rebuild, and it closes out the hub — every drawer button on
customer.html is now a real screen, none are "coming soon" placeholders.

- **Same schema-reuse trick as Distress Survey, and it paid off
  immediately.** A native floor is stored in the exact same
  `job.floorSurvey.{floors,points}` shape the import bridge already
  produces, just tagged `origin:'native'`. Diagnostics' 3D view and Report
  Builder's H/L/Δ needed zero code changes to pick it up — verified
  directly (drew a floor, placed 3 points with real values, opened both
  screens, got a correct mesh and the exact right H 9.25"/L 8.75"/Δ 0.50").
- **v1 scope, on purpose (same pattern as Distress Survey):** no
  transitions, no exclusions, no scale calibration, and native capture
  always creates its own new floor rather than adding points to an
  already-imported one — avoids the ambiguity of two very different
  sources both claiming to own one floor's boundary/plan.
- **The import-vs-native collision fix from Distress Survey applies here
  too, adapted to floors instead of pins.** A re-imported bundle replaces
  only `origin:'import'` floors/points and always preserves native ones;
  a native floor id colliding with an imported one (vanishingly unlikely,
  but handled rather than assumed away) gets regenerated rather than
  letting the import silently take precedence.
- **Point numbering doesn't need the same "never renumber" caution pins
  needed.** A Floor Survey point's index isn't cross-referenced to a
  physical photo print — there's no camera involved — so reusing a
  retired index after a delete is harmless. Simpler than the Distress
  Survey rule, deliberately, because the underlying risk is different.
- Verified end to end: the new-floor form appears immediately when a job
  has no native floors yet, Finish Boundary stays disabled under 3
  vertices, tapping outside a finished boundary is rejected with a toast
  instead of silently creating a bad point, the first point on a floor
  becomes its base point, value/label persist across reload, and the
  import/native coexistence case above.

## Flooring-transition capture added — and a real save-race bug found doing it

Floor Survey's real, shipped correction math (already consumed by
Diagnostics and Report Builder) had no way to be *created* natively:
without this, a floor with an actual material change at a doorway
(hardwood → tile) would silently report a wrong H/L/Δ once captured
through the native screen instead of imported. Added it: mark a point as
a transition anchor with a real surface pair from
`floor/src/lib/transitions.ts`'s own `COMMON_SURFACES` list (kept
identical, not invented) and a B-side reading, then tag later points to
that transition so their raw reading gets corrected automatically.

**Verifying it with a real 3-point scenario surfaced an actual
concurrency bug, not a test-flakiness issue — worth recording in detail
because it's the kind of bug that would have shipped silently.** Every
`fsSave()`/`dsSave()` call is a read-modify-write: fetch the latest job
record, patch in this screen's own data, write it back — the same
pattern used throughout this session to safely coexist with other
screens' concurrent edits. But a single user action can trigger *two* of
these concurrently (e.g. selecting a transition from the dropdown blurs
the value field first, firing its own save, while the select's own
`change` fires a second save). Two overlapping `fsSave()` calls can
finish in either order; whichever's `saveJob()` commits *last* wins,
and if that one was built from an earlier `getJob()` snapshot, it can
silently overwrite the other's change. Reproduced this deterministically
(100% of runs) with a real 3-point transition scenario before fixing it —
and confirmed by instrumenting that naive `console.log` tracing perturbed
the timing enough to hide it again, which is why it wasn't caught by eye
the first time.

**Fix:** queue every `fsSave()`/`dsSave()` call through one promise
chain (`js/floor-survey-capture.js`, `js/distress-survey.js`), so each
read-modify-write runs to completion before the next one starts. This
removes the interleaving entirely rather than making it merely less
likely — verified with 5 consecutive clean runs of the exact scenario
that failed 100% of the time before the fix, plus the full regression
suite. The same two files also had a smaller, related ordering bug on
their own: `fsSelectedPointId`/`fsSelectedFloorId`/`dsSelectedId` were
being set *after* awaiting the save instead of before, leaving a real
window where a fast follow-up edit could target a stale selection or
silently no-op. Fixed alongside the queue.

## Exclusion-zone capture added

Same gap pattern as transitions, closed the same way: Diagnostics and
`topo-grid.js`'s `buildGrid()` already fully support `floor.exclusions[]`
(holes that drop readings from the interpolated surface without hiding
them from the point list) — real, ported, tested weeks ago — but native
capture had no way to draw one. Added "+ Add Exclusion Zone" to the
Floor Survey drawer: reuses the same tap-to-place-vertex interaction as
boundary drawing, stores into the same `floor.exclusions[]` array the
import bundle already uses, with a list + delete.

Verified with a constructed case rather than assumed: placed a 500"
outlier point, drew an exclusion zone around it, then asked the real
production functions (`buildGrid`, `topoPointInPolygon` — not a
reimplementation in the test) whether it was actually dropped from the
interpolated range. It was (active count 3 of 4, grid max 9.3" instead of
500"), and Diagnostics rendered a clean mesh from the same data with zero
code changes — the same schema-reuse payoff as every native-capture
feature added this session.

## Distress Survey photos now appear in the PDF report — for real

`buildReportPdf()` only ever printed a photo *count* for a pin, even
though native capture stores the real photo Blob. Added a Photos
appendix section: each native pin's photos get embedded as real images
(Blob → data URL → `jsPDF.addImage()`), labeled by pin number,
paginated. Imported pins still only carry `photoNumbers` (the old app's
cross-reference to a separate physical photo folder, never the actual
image), so there's nothing to embed for them — correct, not a gap.

Caught two things building this that are worth recording:
- My first verification attempt used the same minimal hand-crafted PNG
  used elsewhere in this session's tests for plain `<img>` rendering —
  jsPDF's own PNG decoder is stricter than a browser's and rejected it
  ("Incomplete or corrupt PNG file"). Confirmed with a properly-formed
  PNG that the actual code path works correctly; real camera JPEGs won't
  hit this, but it's worth knowing this specific fixture isn't safe for
  anything that gets parsed by jsPDF rather than just displayed.
- My first PDF-content check (`text.includes('/Image')`) was a false
  positive — jsPDF's standard `/ProcSet` always lists `/ImageB /ImageC
  /ImageI`, and every page declares an `/XObject` dict even when empty.
  The real signal is a populated `/Subtype /Image` object; fixed the test
  to check that, with a negative control (a photo-less job produces none).

## A real, deeper data-loss bug found chasing a "flaky" test — the save
## race wasn't the save logic, it was navigation cutting saves off mid-flight

Adding transition capture's test (a 3-point scenario) surfaced a Report
Builder Δ that was wrong roughly one run in five — not the deterministic
100%-reproducible bug fixed earlier in the session (the save-interleaving
one), a rarer, load-dependent one that survived every attempted fix to
the save logic itself: serializing `fsSave()`/`dsSave()` through a queue,
coalescing rapid calls into one, caching the shared IndexedDB connection
(which was also leaking a new connection on every single call — a real
fix in its own right, kept regardless), and finally removing the
read-modify-write entirely (writing the live, ever-mutated job object
directly instead of re-fetching first). None of it moved the failure
rate to zero, which was the tell that the save logic wasn't actually
where the bug lived.

The actual mechanism: the point list on the capture screen already showed
the *correct* data in every failing run — the corruption only showed up
after navigating to Report Builder. `fsCreatePointAt`/`fsSaveValue`/etc.
fire their save without the caller awaiting it (so the UI doesn't stall),
and nothing was waiting for that save to actually finish before the page
was allowed to navigate away. Confirmed by adding a bare 300ms wait
before navigating with *zero* code changes: 15/15 clean, versus failing
under load without it. That is exactly the same bug class already fixed
this session for voice memo recording (customer.js's click-interceptor
that finishes and saves a recording before honoring a link click) —
Distress Survey and Floor Survey's own capture screens were never given
the same guard.

**Fix:** the same pattern, applied to both. `js/floor-survey-capture.js`
and `js/distress-survey.js` now intercept every link click on the page,
await whatever's currently queued in the save chain (a no-op if nothing's
pending), and only then navigate. Verified two ways: 20/20 clean runs
navigating through real clicks (the actual user path), versus a residual
~20% failure rate when the test used `page.goto()` directly to jump
between pages — which bypasses any click-based guard and is not a path a
real user of this app can trigger (there's no address bar to type into
here), confirming the fix addresses the real product behavior and the
remaining test flakiness is a test-methodology artifact, not a live bug.

**Worth being honest about:** the earlier "fixed" save-interleaving bug
this session already documented was real and is still correctly fixed —
but it was not, on its own, sufficient. This is the second, deeper layer
of the same underlying carelessness (auto-save fired-and-forgotten,
never confirmed before something else happens). Every current auto-save
path in both native capture screens is now covered by this guard; if a
third drawer ever gets its own auto-saving capture screen, it needs the
same click-interceptor from day one, not bolted on after a bug report.

**One more layer found immediately after, by the same regression suite
doing its job:** the click-interceptor only covers `<a href>` clicks — a
reload, browser back/forward, or closing the tab bypasses it entirely,
since there's no click to intercept. A test reloading the page right
after typing a label caught exactly this. `beforeunload` can't reliably
await an async save (a real, unavoidable web-platform limitation — no
API guarantees a page will wait for pending work during unload), but it
*can* put up the browser's own "leave site? changes may not be saved"
confirmation while a save is still in flight, which buys the write real
time to land instead of guaranteeing nothing. Added to both screens as
defense-in-depth alongside the click-interceptor, not a replacement for
it — verified the click-guarded path is still what actually matters most
(20/20 clean via real navigation, per the section above).

## Distress Survey room auto-guess ported

Native pin capture always required manually picking a room from a
dropdown. Real survey.html auto-guesses it from the plan's placed room
labels (`pinRoom()`) — nearest-room scoring with two guards: an absolute
distance cutoff, and an ambiguity check that refuses to guess when a
runner-up room is nearly as close as the winner. Ported faithfully,
including the generic-label skip list (a label like "Room 3" is never
guessed). Fires once, the first time a pin's editor opens with no room
set yet — never overwrites a manual pick, matching the real app's own
exact tradeoff (a deliberately-cleared room looks identical to "never
set" and can get re-guessed on next open; accepted, not fixed, because
the real app has the same behavior).

**Deliberately not ported:** the real app also disambiguates duplicate
room names for display ("Bedroom" x2 → "North Bedroom"/"South Bedroom"
using the same front-door bearing math already ported for pin direction).
Skipped because Toolbox's room picker shows raw `job.rooms` names as its
options — a disambiguated label wouldn't match any option in the
dropdown. Revisit if duplicate room names turn out to be common in
practice.

Verified with seeded room positions (standing in for what OCR detection
would produce) rather than driving the slow Tesseract OCR pipeline in
the test: a pin dropped near "Kitchen" auto-fills Kitchen, a pin dropped
near a generic "Room 3" label stays blank, a pin dropped far from
everything stays blank, and a manual pick survives reopening the editor.

## Service worker added — the app shell now works with zero connectivity

Customer data was already offline-safe (IndexedDB never needed a
network), but the app's own files still needed one on every fresh visit.
Tim's actual use case is a drilling site with no reliable signal, so this
was a real gap, not a nice-to-have — added `sw.js` precaching the full
app shell (every HTML page, every script, the vendor libs, icons), with
a cache-first fetch strategy and old-cache cleanup on activate.

**Real bug caught before it shipped, not after:** almost every navigation
in this app carries a `?job=<key>` query string (`job.html?job=...`,
`report.html?job=...`, every drawer). The Cache API's default match is an
*exact* URL comparison, so without `{ ignoreSearch: true }` on the
lookup, every one of those would have missed the precached plain
`job.html` entry and silently fallen through to the network — meaning
the service worker would have done nothing for any real navigation past
the very first `index.html` load, while looking like it worked in a
naive test that never checked a URL with a query string.

Verified with `context.setOffline(true)` — actually cutting the
connection, not just guessing — rather than assuming registration alone
proves it works: full page reload while offline, navigating to a
query-stringed URL while offline, and creating a whole new customer
(a real IndexedDB write, unrelated to the cache) while offline, all
succeeded.

Registered from `js/util.js` (already loaded on every screen) rather
than repeating a script tag across all seven HTML pages. This is also
the concrete piece discussed with Tim toward eventual installability —
the manifest and icons were already in place; this was the missing half.

## Floor Survey: a floor can finally be renamed or deleted

Real gap, not hypothetical: a floor's name and plan photo were set once
at creation with no way to fix a mistake afterward — no rename, no
delete, ever. Added both. Rename is a plain prompt (matches the existing
lightweight `confirm()`-based interactions elsewhere on this screen
rather than a whole inline edit form). Delete cascades to the floor's
own points (never leaves orphaned points referencing a floorId that no
longer exists) and falls back to the "+ New Floor" form when it was the
last floor left.

Caught one real bug before it shipped: deleting the last floor left the
Rename/Delete button row visibly showing (stale, since `fsShowNewFloorForm()`
only ever hid the floor picker itself, never this newer row added
alongside it) — fixed and specifically asserted against in the test
rather than just eyeballing the happy path.
