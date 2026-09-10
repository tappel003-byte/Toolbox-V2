# Floor Survey — copy

A copy of the full source from `tappel003-byte/floorplan-topo-maker` as of
the copy date below, made because Tim asked for Toolbox V2 to hold the
copies going forward instead of the original repos. `floorplan-topo-maker`
itself is untouched and stays the live app until this copy is ready to
take over.

**Copied as-is:** `src/`, `public/` (icons + manifest), `package.json`,
`vite.config.ts`, `components.json`, `bunfig.toml`, `bun.lock`,
`eslint.config.js`, `.prettierrc`, `.prettierignore`, `.gitignore`,
`AGENTS.md`.

**What this is, unlike the Distress Survey copy next door:** Floor Survey
has no single standalone HTML file — it's a full Lovable-managed
TanStack Start + Cloudflare Vite app (Bun, Radix UI/shadcn, ~90 source
files). It needs its own `bun install` + `vite build` to run or produce a
working service worker; nothing here has been built or run yet. This
folder is the source, not yet a working copy.

**Its own concepts stay here, per Tim.** Multiple floors per project,
topo boundary polygons, and excluded areas (`SetupTab.tsx`,
`src/lib/areas.ts`, `src/lib/exclusions.ts`) are Floor Survey's own
setup/capture, not part of the cabinet's shared job data. Toolbox V2's
job pocket only carries what's genuinely shared (address, inspector,
date, notes, plan photo, rooms, front door).

**Not yet done, and needs a decision before it is:**
1. Getting this to actually build (Bun install, Vite build, verifying
   the injectManifest service worker still works from wherever it ends
   up being served).
2. Re-theming it onto Distress Survey's palette (`--bg #f4f0e8` etc.) —
   this app uses Tailwind + shadcn's own CSS-variable theme
   (`src/styles.css`), a different system than Distress Survey's plain
   CSS custom properties, so this isn't a drop-in swap.
3. Swapping its icon/manifest for the shared one (Distress Survey's
   navy pin) — currently still its own topo-line icon and slate palette
   in `public/manifest.webmanifest`.
4. Deciding how this and the Distress Survey copy actually get hosted
   together under one roof (see `../docs/PUNCHLIST.md`).

See `../docs/PUNCHLIST.md` for the full picture.
