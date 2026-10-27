// Family Hunt
// GET  /api/hunt?team=<id>&county=<county>  -> finds list, your team, leaderboards
// POST /api/hunt { action: 'create', name, county }       -> new team + Hunt Pass checkout
//                { action: 'join', code }                  -> another family phone joins a team
//                { action: 'update', team_id, name, county }
//                { action: 'checkin', team_id, display_id, lat, lon }
//                { action: 'pay', team_id }                -> new checkout link if they backed out
import crypto from 'node:crypto';
import { db, handler, body, clean, int, etDate, miles, siteUrl, HttpError, COUNTIES } from '../lib/util.js';
import { FINDS, CHECKIN_POINTS } from '../lib/finds.js';
import { createCheckout, stripeReady, getCheckoutSession, markPaid } from '../lib/stripe.js';

const UUID = /^[0-9a-f-]{36}$/i;

async function getTeam(id) {
  if (!UUID.test(id || '')) throw new HttpError(400, 'Missing team. Join or start a team first.');
  const [t] = await db(`teams?id=eq.${id}&select=id,name,county,code,paid,stripe_session`);
  if (!t) throw new HttpError(404, "We couldn't find that team. Start a new one or join with a code.");
  return t;
}

// Safety net: if the team paid but Stripe's webhook hasn't arrived, ask Stripe directly.
async function healPaid(t) {
  if (t.paid || !t.stripe_session || !stripeReady()) return t;
  try {
    const s = await getCheckoutSession(t.stripe_session);
    if (s && s.payment_status === 'paid' && s.metadata?.id === t.id) { await markPaid(s, db); t.paid = true; }
  } catch (e) { console.error('healPaid failed', e); }
  return t;
}

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(6), (b) => A[b % A.length]).join('');
}

async function checkout(req, team) {
  const base = siteUrl(req);
  const c = await createCheckout({
    kind: 'hunt', id: team.id,
    successUrl: `${base}/?paid=hunt#hunt`, cancelUrl: `${base}/?paid=cancelled#hunt`
  });
  await db(`teams?id=eq.${team.id}`, { method: 'PATCH', body: { stripe_session: c.session } });
  return c.url;
}

export default handler(async (req, res) => {
  if (req.method === 'GET') {
    const county = COUNTIES.includes(req.query.county) ? req.query.county : null;
    const out = { finds: FINDS.map(({ id, name, pts }) => ({ id, name, pts })), counties: COUNTIES, paymentsReady: stripeReady() };
    const board = await db('team_scores?paid=eq.true&select=id,name,county,points&order=points.desc,name.asc&limit=500');
    const pub = (t) => ({ name: t.name, county: t.county, points: t.points, me: false });
    out.state = board.slice(0, 25).map(pub);
    if (req.query.team && UUID.test(req.query.team)) {
      const t = await healPaid(await getTeam(req.query.team));
      const myCounty = county || t.county;
      const [score] = await db(`team_scores?id=eq.${t.id}&select=points`);
      const checks = await db(`checkins?team_id=eq.${t.id}&select=display_id,day,points,displays(name,city,type,spotlight)&order=created_at.desc`);
      const finds = await db(`finds?team_id=eq.${t.id}&select=find_id,reason,points`);
      const countyRows = board.filter((x) => x.county === myCounty);
      out.team = {
        id: t.id, name: t.name, county: t.county, code: t.code, paid: t.paid, points: score?.points || 0,
        rankCounty: t.paid ? countyRows.findIndex((x) => x.id === t.id) + 1 : null, countyTotal: countyRows.length,
        rankState: t.paid ? board.findIndex((x) => x.id === t.id) + 1 : null, stateTotal: board.length,
        today: etDate()
      };
      out.checkins = checks.map((c) => ({ display_id: c.display_id, day: c.day, points: c.points, name: c.displays?.name, city: c.displays?.city, type: c.displays?.type, spotlight: c.displays?.spotlight }));
      out.found = Object.fromEntries(finds.map((f) => [f.find_id, { reason: f.reason, points: f.points }]));
      out.county = countyRows.slice(0, 25).map((x) => ({ ...pub(x), me: x.id === t.id }));
      out.state = board.slice(0, 25).map((x) => ({ ...pub(x), me: x.id === t.id }));
      out.countyName = myCounty;
    } else if (county) {
      out.county = board.filter((x) => x.county === county).slice(0, 25).map(pub);
      out.countyName = county;
    }
    return out;
  }

  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  const b = body(req);

  if (b.action === 'create') {
    const name = clean(b.name, 30);
    const county = COUNTIES.includes(b.county) ? b.county : null;
    if (!name) throw new HttpError(400, 'Give your team a name.');
    if (!county) throw new HttpError(400, 'Pick your home county.');
    const free = !stripeReady() && process.env.HUNT_FREE_MODE === 'true';
    let team;
    for (let i = 0; i < 4 && !team; i++) {
      try {
        [team] = await db('teams', { method: 'POST', prefer: 'return=representation', body: { name, county, code: newCode(), paid: free } });
      } catch (e) { if (e.status !== 409) throw e; }
    }
    if (!team) throw new HttpError(500, 'Could not create the team. Try again.');
    const checkoutUrl = team.paid ? null : await checkout(req, team);
    return { team_id: team.id, code: team.code, paid: team.paid, checkoutUrl };
  }

  if (b.action === 'pay') {
    const team = await healPaid(await getTeam(b.team_id));
    if (team.paid) return { paid: true };
    return { checkoutUrl: await checkout(req, team) };
  }

  if (b.action === 'join') {
    const code = String(b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6) throw new HttpError(400, 'Team codes are 6 letters and numbers.');
    const [t] = await db(`teams?code=eq.${code}&select=id`);
    if (!t) throw new HttpError(404, "That code doesn't match a team. Check it with your family.");
    return { team_id: t.id };
  }

  if (b.action === 'update') {
    const team = await getTeam(b.team_id);
    const patch = {};
    const name = clean(b.name, 30);
    if (name) patch.name = name;
    if (COUNTIES.includes(b.county)) patch.county = b.county;
    if (Object.keys(patch).length) await db(`teams?id=eq.${team.id}`, { method: 'PATCH', body: patch });
    return { ok: true };
  }

  if (b.action === 'checkin') {
    const team = await getTeam(b.team_id);
    if (!team.paid) throw new HttpError(402, 'Get the Hunt Pass to start earning points.');
    const id = int(b.display_id);
    const [d] = await db(`display_public?id=eq.${id}&select=id,name,lat,lon,featured,spotlight`);
    if (!d) throw new HttpError(404, 'That display is no longer listed.');
    const lat = Number(b.lat), lon = Number(b.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new HttpError(400, 'We need your location to check in. Allow location for this site and try again.');
    const limit = Number(process.env.CHECKIN_MILES) || 0.3;
    const away = miles([lat, lon], [d.lat, d.lon]);
    if (away > limit) throw new HttpError(400, `You need to be at the display to check in. You're about ${away < 10 ? away.toFixed(1) : Math.round(away)} miles away.`);
    const points = CHECKIN_POINTS(d);
    try {
      await db('checkins', { method: 'POST', body: { team_id: team.id, display_id: d.id, day: etDate(), points } });
    } catch (e) {
      if (e.status === 409) throw new HttpError(409, 'Your team already checked in here today. Come back tomorrow!');
      throw e;
    }
    return { ok: true, points };
  }

  throw new HttpError(400, 'Unknown action');
});
