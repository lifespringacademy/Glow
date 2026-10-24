// Admin API — every call needs the header  x-admin-key: <ADMIN_KEY env var>
// GET  /api/admin?view=pending|all|teams
// POST /api/admin { action: 'approve'|'reject'|'delete', id }
//                 { action: 'update', id, fields: {...} }
//                 { action: 'create', fields: {...} }   (added by you, approved right away)
import crypto from 'node:crypto';
import { db, handler, body, clean, int, geocodeNC, HttpError, TYPES, AMENITIES } from '../lib/util.js';

function checkKey(req) {
  const want = process.env.ADMIN_KEY || '';
  const got = String(req.headers['x-admin-key'] || '');
  if (want.length < 8) throw new HttpError(503, 'Set an ADMIN_KEY (8+ characters) in Vercel first.');
  const a = crypto.createHash('sha256').update(want).digest();
  const b = crypto.createHash('sha256').update(got).digest();
  if (!crypto.timingSafeEqual(a, b)) throw new HttpError(401, 'Wrong admin password.');
}

const dateOk = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : null);

function pick(f = {}) {
  const out = {};
  if ('name' in f) out.name = clean(f.name, 80);
  if ('type' in f && TYPES.includes(f.type)) out.type = f.type;
  if ('street' in f) out.street = clean(f.street, 120);
  if ('city' in f) out.city = clean(f.city, 60);
  if ('zip' in f) out.zip = clean(f.zip, 5);
  if ('cost' in f) out.cost = f.cost === 'paid' ? 'paid' : 'free';
  if ('price' in f) out.price = clean(f.price, 80);
  if ('hours' in f) out.hours = clean(f.hours, 80);
  if ('start_date' in f) out.start_date = dateOk(f.start_date);
  if ('end_date' in f) out.end_date = dateOk(f.end_date);
  if ('fm' in f) out.fm = clean(f.fm, 10);
  if ('url' in f) out.url = /^https?:\/\//i.test(f.url || '') ? clean(f.url, 300) : null;
  if ('description' in f) out.description = clean(f.description, 400);
  if ('tags' in f && Array.isArray(f.tags)) out.tags = f.tags.filter((t) => AMENITIES.includes(t));
  if ('days' in f) out.days = Array.isArray(f.days) && f.days.length ? f.days.map(int).filter((d) => d >= 0 && d <= 6) : null;
  for (const k of ['featured', 'spotlight', 'lights_out', 'paid']) if (k in f) out[k] = !!f[k];
  if ('lat' in f && Number.isFinite(Number(f.lat))) out.lat = Number(f.lat);
  if ('lon' in f && Number.isFinite(Number(f.lon))) out.lon = Number(f.lon);
  if ('plan' in f && ['home', 'spot', 'basic', 'featured'].includes(f.plan)) out.plan = f.plan;
  return out;
}

export default handler(async (req) => {
  checkKey(req);
  if (req.method === 'GET') {
    const view = req.query.view;
    if (view === 'teams') {
      return { teams: await db('team_scores?select=id,name,county,paid,points&order=points.desc&limit=1000') };
    }
    const filter = view === 'pending' ? 'status=eq.pending&' : view === 'all' ? 'status=neq.rejected&' : '';
    const rows = await db(`displays?${filter}select=*&order=created_at.desc&limit=2000`);
    return { displays: rows };
  }
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  const b = body(req);
  const id = int(b.id);

  if (b.action === 'approve' || b.action === 'reject') {
    await db(`displays?id=eq.${id}`, { method: 'PATCH', body: { status: b.action === 'approve' ? 'approved' : 'rejected' } });
    return { ok: true };
  }
  if (b.action === 'delete') {
    await db(`displays?id=eq.${id}`, { method: 'DELETE' });
    return { ok: true };
  }
  if (b.action === 'update') {
    const patch = pick(b.fields);
    if (b.fields?.regeocode) {
      const geo = await geocodeNC(patch.street ?? b.fields.street, patch.city ?? b.fields.city, patch.zip ?? b.fields.zip);
      patch.lat = geo.lat; patch.lon = geo.lon;
    }
    if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to change.');
    await db(`displays?id=eq.${id}`, { method: 'PATCH', body: patch });
    return { ok: true };
  }
  if (b.action === 'create') {
    const row = pick(b.fields);
    if (!row.name || !row.type || !row.city) throw new HttpError(400, 'Name, type and city are required.');
    if (!(Number.isFinite(row.lat) && Number.isFinite(row.lon))) {
      if (!row.street) throw new HttpError(400, 'Add a street address, or latitude and longitude.');
      const geo = await geocodeNC(row.street, row.city, row.zip);
      Object.assign(row, { lat: geo.lat, lon: geo.lon, zip: row.zip || geo.zip });
    }
    row.status = 'approved';
    row.price = row.price || (row.cost === 'paid' ? '' : 'Free');
    const [created] = await db('displays', { method: 'POST', body: row, prefer: 'return=representation' });
    return { ok: true, id: created.id };
  }
  throw new HttpError(400, 'Unknown action');
});
