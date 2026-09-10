# Toolbox V2

A file cabinet, not a website. One customer job — people, address, plan
photo, rooms, front door — stored once. Drawers (Distress Survey, Floor
Survey, Diagnostics, Report Builder, and one more not yet named) will
later open into that same job instead of each starting from scratch.

The cabinet (this folder's `index.html` / `job.html`) is standardized on
Distress Survey's actual color scheme and icon — see `css/styles.css`
and `icons/`. Copies of the two field apps now live here too
(`distress/`, `floor/`), so Toolbox V2 becomes the one place that owns
them going forward instead of `field-reporter-pro` and
`floorplan-topo-maker`. Neither of those original repos has been
touched.

## What's here

- `index.html` — cabinet home: list of jobs, start a new one.
- `job.html` — the customer file: people/address, plan photo, rooms
  (with OCR auto-fill, `js/room-ocr.js`), front door, and the
  (currently inert) drawer buttons.
- `js/db.js` — the job pocket: an IndexedDB store named
  `sandia-job-pocket`, object store `jobs`, keyed by a normalized
  address. This is where Toolbox V2 writes the full job, plan photo
  included (as a `Blob`, since `localStorage` can't hold it).
- `js/home.js`, `js/job.js` — cabinet screen logic.
- `css/styles.css`, `icons/`, `manifest.webmanifest` — the shared look:
  Distress Survey's palette (`--bg #f4f0e8`, `--accent #c14a2b`, etc.)
  and its navy-pin icon.
- `distress/` — a copy of the real Distress Survey field app
  (`survey.html` and its assets). Static, no build needed, but **not
  offline-capable here yet** — its service worker is built by a
  pipeline this copy doesn't have. See `distress/README.md`.
- `floor/` — a copy of Floor Survey's full source (a Lovable-managed
  TanStack Start + Cloudflare Vite app). Source only — hasn't been
  built or run here, and hasn't been re-themed onto the shared palette
  yet. See `floor/README.md`.
- `docs/PUNCHLIST.md` — what's confirmed, what's decided, and what's
  still open before any of this gets wired together or hosted.

## Running the cabinet

No build step. Serve the folder statically and open `index.html`:

```
npx http-server .
```

`distress/survey.html` is also plain static — open it directly. `floor/`
needs Bun + a Vite build before it runs; see `floor/README.md`.

## What this is not (yet)

- Not a finished look everywhere — the cabinet and Distress Survey's
  copy share the real palette now; Floor Survey's copy still has its
  old slate/gray theme and topo-line icon.
- Not wired together. The drawer buttons on the job screen don't link
  anywhere, and neither copy reads from the job pocket yet.
- Not hosted. Cloudflare Pages is the intended target later.
- Not offline-capable as a whole yet. Distress Survey's and Floor
  Survey's *original* repos keep working exactly as before — nothing
  here changes their behavior.
