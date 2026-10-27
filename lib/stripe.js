// Stripe Checkout without the Stripe package: one REST call to create a payment page,
// and a signature check for the webhook.
import crypto from 'node:crypto';
import { HttpError } from './util.js';

export const PRODUCTS = {
  hunt:     { name: 'Glow Family Hunt Pass (2026 season)', cents: () => int(process.env.PRICE_HUNT_CENTS, 499) },
  spot:     { name: 'Glow Spotlight boost (2026 season)', cents: () => int(process.env.PRICE_SPOTLIGHT_CENTS, 500) },
  featured: { name: 'Glow Featured business listing (2026 season)', cents: () => int(process.env.PRICE_FEATURED_CENTS, 4900) }
};
function int(v, d) { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; }

export function stripeReady() { return !!process.env.STRIPE_SECRET_KEY; }

export async function createCheckout({ kind, id, email, successUrl, cancelUrl }) {
  const p = PRODUCTS[kind];
  if (!p) throw new HttpError(400, 'Unknown product');
  if (!stripeReady()) throw new HttpError(503, 'Payments are not set up yet.');
  const f = new URLSearchParams();
  f.set('mode', 'payment');
  f.set('line_items[0][quantity]', '1');
  f.set('line_items[0][price_data][currency]', 'usd');
  f.set('line_items[0][price_data][unit_amount]', String(p.cents()));
  f.set('line_items[0][price_data][product_data][name]', p.name);
  f.set('success_url', successUrl);
  f.set('cancel_url', cancelUrl);
  f.set('metadata[kind]', kind);
  f.set('metadata[id]', String(id));
  f.set('allow_promotion_codes', 'true');
  if (email) f.set('customer_email', email);
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: f.toString()
  });
  const data = await r.json();
  if (!r.ok) { console.error('Stripe error', data); throw new HttpError(502, 'Could not start checkout. Please try again.'); }
  return { url: data.url, session: data.id };
}

// Look up a checkout session (used when Stripe sends a "thin" event with only the id,
// and to double-check a Hunt Pass if the webhook ever misses).
export async function getCheckoutSession(id) {
  if (!stripeReady() || !/^cs_[A-Za-z0-9_]+$/.test(id || '')) return null;
  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}`, {
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }
  });
  const data = await r.json();
  if (!r.ok) { console.error('Stripe session lookup failed', data); return null; }
  return data;
}

// Mark whatever was bought as paid. Returns a short note (shown in Stripe's delivery log).
export async function markPaid(session, db) {
  if (session.payment_status !== 'paid') return `not paid yet (${session.payment_status})`;
  const { kind, id } = session.metadata || {};
  if (kind === 'hunt' && /^[0-9a-f-]{36}$/i.test(id || '')) {
    await db(`teams?id=eq.${id}`, { method: 'PATCH', body: { paid: true } });
    return `hunt team ${id} marked paid`;
  }
  if ((kind === 'spot' || kind === 'featured') && /^\d+$/.test(id || '')) {
    const patch = kind === 'spot' ? { paid: true, spotlight: true } : { paid: true, featured: true, plan: 'featured' };
    await db(`displays?id=eq.${id}`, { method: 'PATCH', body: patch });
    return `display ${id} marked ${kind}`;
  }
  return `nothing to update (kind=${kind || 'none'}, id=${id || 'none'})`;
}

// Verify the Stripe-Signature header against the raw request body.
export function verifyStripe(raw, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }));
  const sigs = header.split(',').filter((kv) => kv.startsWith('v1=')).map((kv) => kv.slice(3));
  const t = parts.t;
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 600) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw}`, 'utf8').digest('hex');
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}
