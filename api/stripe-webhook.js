// POST /api/stripe-webhook  (Stripe calls this after a payment)
// Marks Hunt Passes, Spotlight boosts and Featured listings as paid.
// Works with both Stripe payload styles: "Snapshot" (the full session is included)
// and "Thin" (only the session id is included, so we ask Stripe for the details).
import { db } from '../lib/util.js';
import { verifyStripe, getCheckoutSession, markPaid } from '../lib/stripe.js';

// Read the request stream directly. Don't touch req.body first: on Vercel that
// parses (and uses up) the body, and the signature check needs the exact bytes.
async function rawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString('utf8');
}

export default async function stripeWebhook(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  const raw = await rawBody(req);
  if (!verifyStripe(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)) {
    return res.status(400).send('Bad signature');
  }
  const event = JSON.parse(raw);
  const type = String(event.type || '').replace(/^v1\./, '');
  if (type !== 'checkout.session.completed') return res.status(200).send('ignored');
  try {
    let session = event.data?.object;
    if (!session || session.object !== 'checkout.session') {
      const sid = event.related_object?.id || event.data?.object?.id;
      session = sid ? await getCheckoutSession(sid) : null;
    }
    if (!session) {
      console.error('Webhook: no checkout session in event', JSON.stringify(event).slice(0, 500));
      return res.status(500).send('No session found in event');
    }
    const result = await markPaid(session, db);
    return res.status(200).send(result);
  } catch (e) {
    console.error('Webhook update failed', e, e.detail || '');
    return res.status(500).send('Update failed');
  }
}

// Tell Vercel not to parse the body so the signature check sees the exact bytes Stripe sent.
export const config = { api: { bodyParser: false } };
