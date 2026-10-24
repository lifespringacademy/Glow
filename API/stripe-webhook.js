// POST /api/stripe-webhook  (Stripe calls this after a payment)
// Marks Hunt Passes, Spotlight boosts and Featured listings as paid.
import { db } from '../lib/util.js';
import { verifyStripe } from '../lib/stripe.js';

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
  try {
    if (event.type === 'checkout.session.completed' && event.data?.object?.payment_status === 'paid') {
      const { kind, id } = event.data.object.metadata || {};
      if (kind === 'hunt' && /^[0-9a-f-]{36}$/i.test(id || '')) {
        await db(`teams?id=eq.${id}`, { method: 'PATCH', body: { paid: true } });
      } else if ((kind === 'spot' || kind === 'featured') && /^\d+$/.test(id || '')) {
        const patch = kind === 'spot' ? { paid: true, spotlight: true } : { paid: true, featured: true };
        await db(`displays?id=eq.${id}`, { method: 'PATCH', body: patch });
      }
    }
  } catch (e) {
    console.error('Webhook update failed', e, e.detail || '');
    return res.status(500).send('Update failed');
  }
  res.status(200).send('ok');
}

// Tell Vercel not to parse the body so the signature check sees the exact bytes Stripe sent.
export const config = { api: { bodyParser: false } };
