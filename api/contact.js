// POST /api/contact { name, email, topic, message, website }
// Saves the message (admin > Messages) and emails it to CONTACT_TO through Resend.
// Your email address lives only in Vercel's CONTACT_TO setting, so visitors never see it.
import { db, handler, body, clean, deviceId, HttpError } from '../lib/util.js';

const TOPICS = ['General question', 'Report a listing', 'Fix a listing', 'Remove my display', 'Family Hunt help', 'Featured listing or business question', 'Payment question'];

export default handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  const device = deviceId(req);
  const b = body(req);

  // Spam trap: real people never fill in the hidden "website" field
  if (clean(b.website)) return { ok: true };

  const name = clean(b.name, 80);
  const email = clean(b.email, 120);
  const topic = TOPICS.includes(b.topic) ? b.topic : 'General question';
  const message = clean(String(b.message || '').replace(/\r/g, ''), 3000);
  const errs = [];
  if (!name) errs.push('Add your name.');
  if (!/^\S+@\S+\.\S+$/.test(email || '')) errs.push('Enter your email so we can write back.');
  if (!message || message.length < 5) errs.push('Write a short message.');
  if (errs.length) throw new HttpError(400, errs.join(' '));

  const since = new Date(Date.now() - 60 * 60000).toISOString();
  const recent = await db(`contact_messages?device=eq.${encodeURIComponent(device)}&created_at=gt.${since}&select=id`);
  if (recent.length >= 3) throw new HttpError(429, "Thanks! We've received your messages. Please wait a bit before sending another.");

  let displayId = Number.isInteger(Number(b.display_id)) && Number(b.display_id) > 0 ? Number(b.display_id) : null;
  let displayName = '';
  if (displayId) {
    const [d] = await db(`displays?id=eq.${displayId}&select=name,city`);
    if (d) displayName = `${d.name} (${d.city})`; else displayId = null;
  }
  const [saved] = await db('contact_messages', { method: 'POST', prefer: 'return=representation', body: { name, email, topic, message, device, display_id: displayId } });

  let emailed = false;
  if (process.env.RESEND_API_KEY && process.env.CONTACT_TO) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.CONTACT_FROM || 'Glow <onboarding@resend.dev>',
          to: [process.env.CONTACT_TO],
          reply_to: email,
          subject: `Glow: ${topic}${displayName ? ` · ${displayName}` : ''} from ${name}`,
          text: `${message}\n\n— ${name} (${email})\nTopic: ${topic}\n${displayName ? `Listing: ${displayName}\n` : ''}Sent from the contact form at letsglowwww.com. Reply to this email to answer them.`
        })
      });
      emailed = r.ok;
      if (!r.ok) console.error('Resend error', await r.text());
    } catch (e) { console.error('Resend failed', e); }
    if (emailed) await db(`contact_messages?id=eq.${saved.id}`, { method: 'PATCH', body: { emailed: true } });
  }
  return { ok: true };
});
