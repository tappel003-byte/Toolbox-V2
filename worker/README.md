# Toolbox V2 API

A Cloudflare Worker + D1 database holding the shared customer roster —
the thing that lets Distress Survey, Floor Survey, and any other drawer
see the same customers Toolbox does, on any device, instead of each app
only knowing about what's in its own local storage.

## What exists right now

- **D1 database** `toolbox-v2` (id `236b342f-3738-4d65-a29f-152836d513e0`),
  already created, with `customers` and `rooms` tables.
- **This Worker** (`src/index.js`) — a small REST API in front of it:
  - `GET /api/customers` — the roster (id, address, primary name, updated,
    room count) — this is what a customer-list screen anywhere would call.
  - `GET /api/customers/:id` — one customer, full record + rooms.
  - `PUT /api/customers/:id` — create or update (id must be the
    normalized address — same scheme as the local pocket's `addressKey`).
  - `DELETE /api/customers/:id`
  - `POST`/`GET /api/customers/:id/photo` — **stubs**, return 501. Photo
    bytes need an R2 bucket, which is blocked pending approval (see
    `../docs/PUNCHLIST.md`).

## What's NOT done

1. **Not deployed.** This code exists in the repo; nobody has run
   `wrangler deploy` against it yet. I don't have a way to deploy a
   Worker from this session (no `wrangler` CLI, no API token) — that
   needs to happen from wherever Tim can run one command, or by
   granting deploy access some other way.
2. **No auth.** Once deployed, this Worker's URL is a public API with
   full read/write access to every customer record. That's acceptable
   for now only because nothing points at it yet. It needs at least a
   shared access key (a header this Worker checks) before any real
   device calls it.
3. **No photo storage.** R2 bucket creation was blocked by a "modify
   shared resources" permission gate — it touches the same Cloudflare
   account as Tim's other live sites, so it needs his explicit
   approval, not mine to grant myself.
4. **Nothing reads from this yet.** Toolbox V2's `js/db.js` still only
   writes to local IndexedDB. Wiring it (and eventually the drawer
   copies) to read/write through this API instead — while keeping
   IndexedDB as the offline fallback — is the next real chunk of work.
   See `../docs/PUNCHLIST.md` for the plan.

## Deploying (once ready)

```
cd worker
npx wrangler deploy
```

Needs a Cloudflare API token with Workers + D1 permissions available to
whoever runs it (via `wrangler login` or `CLOUDFLARE_API_TOKEN`).
