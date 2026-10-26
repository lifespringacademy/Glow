// GET  /api/displays        -> every approved display, with ratings and the latest wait time
// POST /api/displays        -> someone submits a display for review (and pays, for Spotlight/Featured)
// POST /api/displays { action: 'claim', id, name, email } -> a business claims its listing and pays to be Featured
import { db, handler, body, clean, int, miles, geocodeNC, siteUrl, HttpError, TYPES, AMENITIES } from '../lib/util.js';
import { askAboutPhoto } from '../lib/ai.js';
import { createCheckout, stripeReady } from '../lib/stripe.js';

export default handler(async (req, res) => {
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');
    const rows = await db('display_public?select=*&order=id');
    return { displays: rows, paymentsReady: stripeReady() };
  }
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');

  const b = body(req);

  if (b.action === 'claim') {
    const id = int(b.id);
    const who = clean(b.name, 80);
    const email = clean(b.email, 120);
    if (!who) throw new HttpError(400, 'Add your name.');
    if (!/^\S+@\S+\.\S+$/.test(email || '')) throw new HttpError(400, 'Enter your email so we can reach you about the listing.');
    if (!b.authorized) throw new HttpError(400, 'Please confirm you manage this business or event.');
    const [d] = await db(`displays?id=eq.${id}&status=eq.approved&select=id,type,featured,paid,plan`);
    if (!d) throw new HttpError(404, 'That listing is no longer on the map.');
    if (d.featured && (d.paid || d.plan !== 'featured')) throw new HttpError(409, 'This listing is already Featured.');
    if (!stripeReady()) throw new HttpError(503, 'Payments are not set up yet. Email us and we will feature you.');
    await db(`displays?id=eq.${id}`, { method: 'PATCH', body: { claim_name: who, claim_email: email, claimed_at: new Date().toISOString() } });
    const base = siteUrl(req);
    const c = await createCheckout({ kind: 'featured', id, email, successUrl: `${base}/?paid=claimed#find`, cancelUrl: `${base}/?paid=cancelled#find` });
    await db(`displays?id=eq.${id}`, { method: 'PATCH', body: { stripe_session: c.session } });
    return { checkoutUrl: c.url };
  }

  const name = clean(b.name, 80);
  const type = TYPES.includes(b.type) ? b.type : null;
  const street = clean(b.street, 120);
  const city = clean(b.city, 60);
  const zip = clean(b.zip, 5);
  const cost = b.cost === 'paid' ? 'paid' : 'free';
  const plan = ['home', 'spot', 'basic', 'featured'].includes(b.plan) ? b.plan : 'home';
  const email = clean(b.email, 120);
  const errs = [];
  if (!name) errs.push('Add a display name.');
  if (!type) errs.push('Pick a display type.');
  if (!street || !city) errs.push('Add the street address and city.');
  if (!/^(27|28)\d{3}$/.test(zip || '')) errs.push('Enter a North Carolina ZIP code (starts with 27 or 28).');
  if (cost === 'paid' && !clean(b.price)) errs.push('Add the price for a paid display.');
  if (!/^\S+@\S+\.\S+$/.test(email || '')) errs.push("Enter an email so we can tell you when it's approved.");
  const isHome = type === 'home' || type === 'hood' || ((plan === 'home' || plan === 'spot') && !['drive', 'walk', 'town', 'ride'].includes(type));
  if (isHome && !b.owner_confirmed) errs.push("Please confirm this is your home or you have the homeowner's permission.");
  if (errs.length) throw new HttpError(400, errs.join(' '));

  const geo = await geocodeNC(street, city, zip);

  // Was the person standing at the address when they submitted? (home listings)
  let verified = false, verifyMiles = null;
  const vLat = b.verify_lat === null || b.verify_lat === undefined || b.verify_lat === '' ? NaN : Number(b.verify_lat);
  const vLon = b.verify_lon === null || b.verify_lon === undefined || b.verify_lon === '' ? NaN : Number(b.verify_lon);
  if (Number.isFinite(vLat) && Number.isFinite(vLon)) {
    verifyMiles = Math.round(miles([vLat, vLon], [geo.lat, geo.lon]) * 100) / 100;
    verified = verifyMiles <= (Number(process.env.VERIFY_MILES) || 0.2);
  }
  // Optional photo of the display: AI checks it looks like a real lit-up home (the photo isn't stored)
  let photoCheck = null;
  if (isHome && b.photo) {
    const v = await askAboutPhoto(b.photo, 'This photo was submitted with a request to list a home Christmas light display on a public map. Is it a real camera photo (not a screenshot, stock or AI image) of a house, yard or street decorated with holiday lights or decorations? Reply with only JSON like {"looks_real":true,"reason":"one short sentence"}.');
    photoCheck = v ? `${v.looks_real ? 'Looks real' : 'Doubtful'}: ${String(v.reason || '').slice(0, 160)}` : 'Photo could not be checked';
  }
  const dateOk = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : null);
  const row = {
    name, type, street, city: geo.city || city, zip: geo.zip || zip, lat: geo.lat, lon: geo.lon,
    cost, price: cost === 'paid' ? clean(b.price, 80) : 'Free', hours: clean(b.hours, 80),
    start_date: dateOk(b.start_date), end_date: dateOk(b.end_date),
    fm: clean(b.fm, 10), url: /^https?:\/\//i.test(b.url || '') ? clean(b.url, 300) : null,
    description: clean(b.description, 400),
    tags: Array.isArray(b.tags) ? b.tags.filter((t) => AMENITIES.includes(t)) : [],
    plan, submitter_email: email, status: 'pending',
    verified, verify_miles: verifyMiles, owner_confirmed: !!b.owner_confirmed, photo_check: photoCheck
  };
  const [created] = await db('displays', { method: 'POST', body: row, prefer: 'return=representation' });

  let checkoutUrl = null;
  if ((plan === 'spot' || plan === 'featured') && stripeReady()) {
    const base = siteUrl(req);
    const c = await createCheckout({
      kind: plan, id: created.id, email,
      successUrl: `${base}/?paid=${plan}#add`, cancelUrl: `${base}/?paid=cancelled#add`
    });
    checkoutUrl = c.url;
    await db(`displays?id=eq.${created.id}`, { method: 'PATCH', body: { stripe_session: c.session } });
  }
  return { ok: true, id: created.id, checkoutUrl, verified, verifyMiles };
});
