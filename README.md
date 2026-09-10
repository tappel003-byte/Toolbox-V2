# Toolbox V2

A file cabinet, not a website. One customer job — people, address, plan
photo, rooms, front door — stored once. Drawers (Distress Survey, Floor
Survey, Diagnostics, Report Builder, and one more not yet named) will
later open into that same job instead of each starting from scratch.

This is the first pass: **the cabinet only.** No drawer code lives here
yet, and the drawer buttons on the job screen don't go anywhere yet.

## What's here

- `index.html` — cabinet home: list of jobs, start a new one.
- `job.html` — the customer file: people/address, plan photo, rooms,
  front door, and the (currently inert) drawer buttons.
- `js/db.js` — the job pocket: an IndexedDB store named
  `sandia-job-pocket`, object store `jobs`, keyed by a normalized
  address. This is where Toolbox V2 writes the full job, plan photo
  included (as a `Blob`, since `localStorage` can't hold it).
- `js/home.js`, `js/job.js` — screen logic.
- `docs/PUNCHLIST.md` — a plan (not yet applied) for how the field
  drawers would later read a job from the pocket without Toolbox
  changing their offline behavior.

## Running it

No build step. Serve the folder statically and open `index.html`:

```
npx http-server .
```

## What this is not (yet)

- Not a finished look — colors, chrome, and icons are placeholders.
- Not connected to Distress Survey or Floor Survey. Those repos are
  untouched; see `docs/PUNCHLIST.md` for the plan.
- Not hosted. Cloudflare Pages is the intended target later.
- Not offline-capable yet itself — that's the next pass, and it must not
  come at the expense of Distress Survey's or Floor Survey's existing
  offline behavior.
