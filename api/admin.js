// Admin API — every call needs the header  x-admin-key: <ADMIN_KEY env var>
// GET  /api/admin?view=pending|all|teams|messages|stats (stats: &range=7|30|season)
// POST /api/admin { action: 'approve'|'reject'|'delete', id }
//                 { action: 'update', id, fields: {...} }
//                 { action: 'create', fields: {...} }   (added by you, approved right away)
//                 { action: 'import', rows: [{...}, ...] } (up to 15 rows per call, approved right away)
//                 { action: 'team_rename', team_id, name } | { action: 'team_hide', team_id, value }
//                 { action: 'team_paid', team_id, value }  | { action: 'team_delete', team_id }
import crypto from 'node:crypto';
import { db, handler, body, clean, int, etDate, geocodeNC, HttpError, TYPES, AMENITIES } from '../lib/util.js';

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

const EVENTS = ['view', 'pin', 'directions', 'website', 'tour'];
function addDays(iso, n) { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// Listing stats for the admin Stats tab
async function stats(range) {
  const today = etDate();
  let from;
  if (range === 'season') {
    const [y, m] = today.split('-').map(Number);
    from = `${m >= 7 ? y : y - 1}-10-01`; // the season runs from Oct 1
  } else from = addDays(today, -((range === '7' ? 7 : 30) - 1));
  const rows = await db(`display_stats?day=gte.${from}&select=display_id,day,event,n&limit=100000`);
  const ids = [...new Set(rows.map((r) => r.display_id))];
  const names = ids.length ? await db(`displays?id=in.(${ids.join(',')})&select=id,name,city,type,featured,spotlight,paid,plan,status,url,claim_email,submitter_email`) : [];
  const byId = Object.fromEntries(names.map((d) => [d.id, { ...d, view: 0, pin: 0, directions: 0, website: 0, tour: 0 }]));
  const days = {};
  for (let d = from; d <= today; d = addDays(d, 1)) days[d] = Object.fromEntries(EVENTS.map((e) => [e, 0]));
  const totals = Object.fromEntries(EVENTS.map((e) => [e, 0]));
  for (const r of rows) {
    if (byId[r.display_id]) byId[r.display_id][r.event] += r.n;
    if (days[r.day]) days[r.day][r.event] += r.n;
    totals[r.event] += r.n;
  }
  const listings = Object.values(byId).sort((a, b) => b.view - a.view || b.directions - a.directions);
  return { from, to: today, totals, daily: Object.entries(days).map(([day, v]) => ({ day, ...v })), listings };
}

export default handler(async (req) => {
  checkKey(req);
  if (req.method === 'GET') {
    const view = req.query.view;
    if (view === 'messages') {
      return { messages: await db('contact_messages?select=id,name,email,topic,message,emailed,handled,created_at,display_id,displays(name,city)&order=created_at.desc&limit=500') };
    }
    if (view === 'stats') return stats(req.query.range);
    if (view === 'teams') {
      return { teams: await db('team_scores?select=id,name,county,paid,points,hidden&order=points.desc&limit=1000') };
    }
    const filter = view === 'pending' ? 'status=eq.pending&' : view === 'all' ? 'status=neq.rejected&' : '';
    const rows = await db(`displays?${filter}select=*&order=created_at.desc&limit=2000`);
    return { displays: rows };
  }
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  const b = body(req);
  const id = int(b.id);

  if (String(b.action || '').startsWith('team_')) {
    const tid = String(b.team_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(tid)) throw new HttpError(400, 'Missing team.');
    const where = `teams?id=eq.${tid}`;
    if (b.action === 'team_rename') {
      const name = clean(b.name, 30);
      if (!name) throw new HttpError(400, 'Enter a team name.');
      await db(where, { method: 'PATCH', body: { name } });
    } else if (b.action === 'team_hide') {
      await db(where, { method: 'PATCH', body: { hidden: !!b.value } });
    } else if (b.action === 'team_paid') {
      await db(where, { method: 'PATCH', body: { paid: !!b.value } });
    } else if (b.action === 'team_delete') {
      await db(where, { method: 'DELETE' });
    } else throw new HttpError(400, 'Unknown action');
    return { ok: true };
  }

  if (b.action === 'approve' || b.action === 'reject') {
    await db(`displays?id=eq.${id}`, { method: 'PATCH', body: { status: b.action === 'approve' ? 'approved' : 'rejected' } });
    return { ok: true };
  }
  if (b.action === 'handled') {
    await db(`contact_messages?id=eq.${id}`, { method: 'PATCH', body: { handled: !!b.value } });
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
  if (b.action === 'import') {
    const rows = Array.isArray(b.rows) ? b.rows.slice(0, 15) : [];
    const results = [];
    for (const raw of rows) {
      const label = clean(raw?.name, 80) || '(no name)';
      try {
        const row = pick({ ...raw, tags: typeof raw.tags === 'string' ? raw.tags.split(/[;|]/).map((t) => t.trim()).filter(Boolean) : raw.tags,
          lat: raw.lat === '' ? undefined : raw.lat, lon: raw.lon === '' ? undefined : raw.lon });
        if (!row.name || !row.type || !row.city) throw new Error('Name, type and city are required.');
        const sameCity = await db(`displays?city=ilike.${encodeURIComponent(row.city.replace(/[*%]/g, ''))}&status=neq.rejected&select=name`);
        if (sameCity.some((x) => x.name.trim().toLowerCase() === row.name.trim().toLowerCase())) { results.push({ name: label, ok: false, skipped: true, error: 'Already on the map' }); continue; }
        if (!(Number.isFinite(row.lat) && Number.isFinite(row.lon))) {
          if (!row.street) throw new Error('Needs a street address or latitude/longitude.');
          const geo = await geocodeNC(row.street, row.city, row.zip);
          Object.assign(row, { lat: geo.lat, lon: geo.lon, zip: row.zip || geo.zip });
        }
        row.status = 'approved';
        row.price = row.price || (row.cost === 'paid' ? 'See website' : 'Free');
        const [created] = await db('displays', { method: 'POST', body: row, prefer: 'return=representation' });
        results.push({ name: label, ok: true, id: created.id });
      } catch (e) {
        results.push({ name: label, ok: false, error: e.message || 'Failed' });
      }
    }
    return { results };
  }
  throw new HttpError(400, 'Unknown action');
});
