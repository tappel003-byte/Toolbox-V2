# Toolbox-V2 — agent rules

Toolbox is a file cabinet. A customer job is the folder. Distress Survey, Floor Survey, Diagnostics, and Report Builder are drawers.

## Frozen UI
The capture interaction design of Distress Survey (`distress/survey.html`) and Floor Survey (`floor/src/` except `floor/src/lib/db.ts`) is frozen.

Do not change layout, setup flow, bottom sheet, stacked pins, keypad, Interior/Exterior default, photo annotation, theme, or any other capture UX unless Tim Appel explicitly signs off first, in writing, in that session.

Reason (2026-09-12): a prior agent rebuilt those screens, said it had not, and was wrong. The standalone apps `field-reporter-pro` and `floorplan-topo-maker` are reference-only. Never edit them.

## Allowed without asking
- Dual-write / job-key plumbing
- Hub drawer URLs
- Diagnostics and Report *readers* of pocket data
- `floor/src/lib/db.ts` persistence only
- `floor/vite.config.ts` only when required to serve the existing app

## Not allowed
- New capture pages
- Skipping setup
- “While I’m here” refactors of frozen files
- Treating chat as proof the UI is unchanged — the diff is the proof

## Approved freeze exception (2026-09-13)
Export→Edit on the Export screen/tab is approved: each drawer's existing Export
surface (`distress/survey.html`'s Export sheet; Floor's `ExportTab.tsx`) may be
repurposed into a desktop-oriented editor for that drawer's own data
(descriptions, room/label, notes, and plan position) in addition to its
existing export/download functions. Capture UX everywhere else — setup, the
bottom sheet, stacked pins, the keypad, the Interior/Exterior default, photo
annotation, theme, and Report Builder's read-only rule — remains frozen and
was not touched by this exception.
