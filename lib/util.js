// Shared helpers for the Glow server functions. No outside packages needed.

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Call Supabase's REST API with the server-only service role key.
export async function db(path, { method = 'GET', body, prefer } = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new HttpError(500, 'The database is not configured yet (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) {
    const err = new HttpError(r.status === 409 ? 409 : 500, r.status === 409 ? 'duplicate' : 'Database error');
    err.detail = text;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

// Wrap a handler so every error becomes a clean JSON reply.
export function handler(fn) {
  return async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const out = await fn(req, res);
      if (!res.writableEnded) res.status(200).send(JSON.stringify(out ?? { ok: true }));
    } catch (e) {
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
      if (status >= 500) console.error(e, e.detail || '');
      res.status(status).send(JSON.stringify({ error: status >= 500 && !(e instanceof HttpError) ? 'Something went wrong. Please try again.' : e.message }));
    }
  };
}

export function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) { try { return JSON.parse(req.body); } catch { /* fall through */ } }
  return {};
}

export function deviceId(req) {
  const d = String(req.headers['x-device'] || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(d)) throw new HttpError(400, 'Missing device id. Reload the page and try again.');
  return d;
}

export function clean(v, max = 200) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

export function int(v) { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null; }

// Today's date in Eastern time, as YYYY-MM-DD
export function etDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function miles(a, b) {
  const R = 3958.8, r = (x) => (x * Math.PI) / 180;
  const dLat = r(b[0] - a[0]), dLon = r(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'letsglowwww.com';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

export const TYPES = ['home', 'hood', 'drive', 'walk', 'music', 'town', 'ride'];
export const AMENITIES = ['Santa visits', 'Hot cocoa', 'Wheelchair friendly', 'Stroller friendly', 'Pets welcome', 'Restrooms', 'Synced to FM'];
export const COUNTIES = ['Alamance','Alexander','Alleghany','Anson','Ashe','Avery','Beaufort','Bertie','Bladen','Brunswick','Buncombe','Burke','Cabarrus','Caldwell','Camden','Carteret','Caswell','Catawba','Chatham','Cherokee','Chowan','Clay','Cleveland','Columbus','Craven','Cumberland','Currituck','Dare','Davidson','Davie','Duplin','Durham','Edgecombe','Forsyth','Franklin','Gaston','Gates','Graham','Granville','Greene','Guilford','Halifax','Harnett','Haywood','Henderson','Hertford','Hoke','Hyde','Iredell','Jackson','Johnston','Jones','Lee','Lenoir','Lincoln','McDowell','Macon','Madison','Martin','Mecklenburg','Mitchell','Montgomery','Moore','Nash','New Hanover','Northampton','Onslow','Orange','Pamlico','Pasquotank','Pender','Perquimans','Person','Pitt','Polk','Randolph','Richmond','Robeson','Rockingham','Rowan','Rutherford','Sampson','Scotland','Stanly','Stokes','Surry','Swain','Transylvania','Tyrrell','Union','Vance','Wake','Warren','Washington','Watauga','Wayne','Wilkes','Wilson','Yadkin','Yancey'];

// Turn a street address into map coordinates with the free US Census geocoder.
// Returns { lat, lon, city, zip } or throws a friendly error. NC addresses only.
export async function geocodeNC(street, city, zip) {
  const one = `${street}, ${city}, NC ${zip || ''}`.trim();
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(one)}&benchmark=Public_AR_Current&format=json`;
  let data;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Glow (letsglowwww.com)' } });
    data = await r.json();
  } catch {
    throw new HttpError(502, 'The address lookup service is busy. Please try again in a minute.');
  }
  const m = data?.result?.addressMatches?.[0];
  if (!m) throw new HttpError(400, "We couldn't find that address. Check the street, city and ZIP.");
  const st = m.addressComponents?.state;
  if (st && st !== 'NC') throw new HttpError(400, 'Glow lists North Carolina displays only.');
  return { lat: m.coordinates.y, lon: m.coordinates.x, city: m.addressComponents?.city ? titleCase(m.addressComponents.city) : city, zip: m.addressComponents?.zip || zip };
}

function titleCase(s) { return String(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()); }
