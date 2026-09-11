// Toolbox V2 API — the shared customer roster behind the cabinet.
//
// This is what makes a customer entered in Toolbox visible from Distress
// Survey, Floor Survey, or any other drawer, on any device: they all read
// and write through this Worker instead of each keeping their own local
// copy of "who are our customers." The on-device IndexedDB pocket
// (js/db.js) becomes each app's *offline cache* of this — write here when
// online, fall back to the local cache when there's no signal.
//
// Same address-key scheme as the local pocket (see normalizeAddress in
// js/db.js) so a job created offline and synced later lands on the same
// id as one created straight against this API.
//
// NOT YET DONE: no auth. This binds to nothing but the D1 database right
// now, and its URL will be publicly reachable once deployed — that's fine
// while nobody has deployed it, but it needs at least a shared access key
// before this is pointed at from a real device. Don't wire a drawer to
// this without adding that first.
//
// Photos: this Worker only stores metadata (a `plan_photo_key` string) —
// actual photo bytes belong in an R2 bucket, which hasn't been created
// yet (blocked pending approval — see docs/PUNCHLIST.md). The photo
// endpoints below are stubs until that exists.

function normalizeAddress(address) {
  return String(address || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CORS_HEADERS = {
  // TODO: narrow this to the real Toolbox V2 origin once it's hosted.
  // Wide open is only acceptable while nothing points at this API yet.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function notFound() {
  return json({ error: 'Not found' }, 404);
}

async function listCustomers(db) {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.address, c.primary_name, c.updated_at,
              (SELECT COUNT(*) FROM rooms r WHERE r.customer_id = c.id) AS room_count
       FROM customers c ORDER BY c.updated_at DESC`
    )
    .all();
  return json({ customers: results });
}

async function getCustomer(db, id) {
  const customer = await db.prepare(`SELECT * FROM customers WHERE id = ?`).bind(id).first();
  if (!customer) return notFound();
  const { results: rooms } = await db
    .prepare(`SELECT id, name, x, y FROM rooms WHERE customer_id = ?`)
    .bind(id)
    .all();
  return json({ ...customer, rooms });
}

async function putCustomer(db, id, body) {
  const address = String(body.address || '').trim();
  if (!address) return json({ error: 'address is required' }, 400);
  const addressKey = normalizeAddress(address);
  if (addressKey !== id) {
    return json({ error: 'id must be the normalized address of `address`' }, 400);
  }

  const now = Date.now();
  const p = body.people || {};
  const fd = body.frontDoor || {};

  await db
    .prepare(
      `INSERT INTO customers (
         id, address, address_key, primary_name, second_name, cell_phone, email,
         billing_same_as_site, billing_address, second_address,
         inspector, visit_date, notes, building_type,
         front_door_facing, front_door_marker_x, front_door_marker_y,
         plan_photo_key, plan_photo_type, created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         address=excluded.address, address_key=excluded.address_key,
         primary_name=excluded.primary_name, second_name=excluded.second_name,
         cell_phone=excluded.cell_phone, email=excluded.email,
         billing_same_as_site=excluded.billing_same_as_site,
         billing_address=excluded.billing_address, second_address=excluded.second_address,
         inspector=excluded.inspector, visit_date=excluded.visit_date, notes=excluded.notes,
         building_type=excluded.building_type,
         front_door_facing=excluded.front_door_facing,
         front_door_marker_x=excluded.front_door_marker_x,
         front_door_marker_y=excluded.front_door_marker_y,
         plan_photo_key=excluded.plan_photo_key, plan_photo_type=excluded.plan_photo_type,
         updated_at=excluded.updated_at`
    )
    .bind(
      id,
      address,
      addressKey,
      p.primaryName || null,
      p.secondName || null,
      p.cellPhone || null,
      p.email || null,
      p.billingSameAsSite === false ? 0 : 1,
      p.billingAddress || null,
      p.secondAddress || null,
      body.inspector || null,
      body.date || null,
      body.notes || null,
      body.buildingType || 'residential',
      fd.facing || null,
      fd.marker ? fd.marker.x : null,
      fd.marker ? fd.marker.y : null,
      body.planPhotoKey || null,
      body.planImageType || null,
      now,
      now
    )
    .run();

  // Rooms: replace wholesale on each save — simplest correct behavior for
  // a record this small, and it mirrors how the local pocket already
  // treats rooms (the whole array is written together).
  await db.prepare(`DELETE FROM rooms WHERE customer_id = ?`).bind(id).run();
  const rooms = Array.isArray(body.rooms) ? body.rooms : [];
  for (const r of rooms) {
    if (!r.name) continue;
    await db
      .prepare(`INSERT INTO rooms (id, customer_id, name, x, y) VALUES (?,?,?,?,?)`)
      .bind(r.id || crypto.randomUUID(), id, r.name, typeof r.x === 'number' ? r.x : null, typeof r.y === 'number' ? r.y : null)
      .run();
  }

  return getCustomer(db, id);
}

async function deleteCustomer(db, id) {
  await db.prepare(`DELETE FROM customers WHERE id = ?`).bind(id).run();
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // ['api', 'customers', ':id', ...]

    if (parts[0] !== 'api' || parts[1] !== 'customers') return notFound();

    const db = env.DB;

    // /api/customers
    if (parts.length === 2) {
      if (request.method === 'GET') return listCustomers(db);
      return json({ error: 'Method not allowed' }, 405);
    }

    const id = decodeURIComponent(parts[2]);

    // /api/customers/:id/photo
    if (parts.length === 4 && parts[3] === 'photo') {
      return json(
        { error: 'Photo storage is not configured yet (R2 bucket pending approval — see docs/PUNCHLIST.md).' },
        501
      );
    }

    // /api/customers/:id
    if (parts.length === 3) {
      if (request.method === 'GET') return getCustomer(db, id);
      if (request.method === 'PUT') {
        const body = await request.json().catch(() => null);
        if (!body) return json({ error: 'Invalid JSON body' }, 400);
        return putCustomer(db, id, body);
      }
      if (request.method === 'DELETE') return deleteCustomer(db, id);
      return json({ error: 'Method not allowed' }, 405);
    }

    return notFound();
  },
};
