// POST /api/photo { team_id, find_id, image: "data:image/jpeg;base64,..." }
// AI reviews the Family Hunt photo and awards points automatically. Photos are not stored.
import { db, handler, body, etDate, HttpError } from '../lib/util.js';
import { FINDS } from '../lib/finds.js';

const MAX_TRIES_PER_DAY = Number(process.env.PHOTO_TRIES_PER_DAY) || 30;

export default handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  const b = body(req);
  if (!/^[0-9a-f-]{36}$/i.test(b.team_id || '')) throw new HttpError(400, 'Join or start a team first.');
  const [team] = await db(`teams?id=eq.${b.team_id}&select=id,paid`);
  if (!team) throw new HttpError(404, "We couldn't find your team.");
  if (!team.paid) throw new HttpError(402, 'Get the Hunt Pass to start earning points.');
  const item = FINDS.find((f) => f.id === b.find_id);
  if (!item) throw new HttpError(400, 'Unknown find.');
  const done = await db(`finds?team_id=eq.${team.id}&find_id=eq.${item.id}&select=find_id`);
  if (done.length) return { approved: true, already: true, reason: 'Your team already has this one!', points: 0 };

  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(b.image || '');
  if (!m) throw new HttpError(400, "That photo couldn't be read. Try a JPG or PNG.");
  if (m[2].length > 4_000_000) throw new HttpError(413, 'That photo is too large. Try again.');

  // Daily cap keeps AI costs predictable
  const dayStart = new Date(`${etDate()}T00:00:00-05:00`).toISOString();
  const tries = await db(`photo_attempts?team_id=eq.${team.id}&created_at=gte.${dayStart}&select=id`);
  if (tries.length >= MAX_TRIES_PER_DAY) throw new HttpError(429, "That's a lot of photos for one day! Try again tomorrow.");

  if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(503, 'Photo checking is not set up yet.');

  const prompt = `You are the photo judge for a family Christmas lights scavenger hunt in North Carolina.
The family is claiming this find: "${item.name}" (${item.hint}).
Look at the photo and decide:
- matches_find: does the photo plainly show this find?
- real_photo: is it a real camera photo of real decorations, not a screenshot, a photo of a screen, or a stock/AI image?
- face_visible: is any person's face clearly visible?
Approve only if matches_find is true, real_photo is true and face_visible is false.
Reply with only JSON like {"approved":true,"matches_find":true,"real_photo":true,"face_visible":false,"reason":"one short, friendly sentence to the family"}.
If you reject, the reason should say what to fix, for example "We can see lights but not a train. Try getting the whole train in the shot."`;

  let verdict;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
        max_tokens: 300,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
          { type: 'text', text: prompt }
        ] }]
      })
    });
    const data = await r.json();
    if (!r.ok) { console.error('Anthropic error', data); throw new Error('ai'); }
    const text = (data.content || []).map((c) => c.text || '').join('');
    const j = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    verdict = JSON.parse(j);
  } catch {
    throw new HttpError(502, "The photo check didn't finish. Try again.");
  }

  const approved = verdict.approved === true && verdict.matches_find !== false && verdict.real_photo !== false && verdict.face_visible !== true;
  let reason = String(verdict.reason || (approved ? 'Great find!' : "We couldn't confirm this find. Try another photo.")).slice(0, 220);
  if (verdict.face_visible === true && !/face/i.test(reason)) reason += ' Please retake it without faces in the photo.';

  await db('photo_attempts', { method: 'POST', body: { team_id: team.id, find_id: item.id, approved, reason } });
  if (approved) {
    try { await db('finds', { method: 'POST', body: { team_id: team.id, find_id: item.id, points: item.pts, reason } }); }
    catch (e) { if (e.status !== 409) throw e; }
  }
  return { approved, reason, points: approved ? item.pts : 0 };
});
