// POST /api/activity  { action: 'rate', display_id, stars }
//                     { action: 'wait', display_id, minutes }
import { db, handler, body, deviceId, int, HttpError } from '../lib/util.js';

export default handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  const device = deviceId(req);
  const b = body(req);
  const id = int(b.display_id);
  if (!id) throw new HttpError(400, 'Missing display.');
  const found = await db(`displays?id=eq.${id}&status=eq.approved&select=id`);
  if (!found.length) throw new HttpError(404, 'That display is no longer listed.');

  if (b.action === 'rate') {
    const stars = int(b.stars);
    if (!(stars >= 1 && stars <= 5)) throw new HttpError(400, 'Pick 1 to 5 stars.');
    await db('ratings?on_conflict=display_id,device', {
      method: 'POST', prefer: 'resolution=merge-duplicates',
      body: { display_id: id, device, stars, created_at: new Date().toISOString() }
    });
    return { ok: true };
  }

  if (b.action === 'wait') {
    const minutes = int(b.minutes);
    if (![0, 15, 30, 45, 60].includes(minutes)) throw new HttpError(400, 'Pick a wait time.');
    const since = new Date(Date.now() - 10 * 60000).toISOString();
    const recent = await db(`waits?display_id=eq.${id}&device=eq.${encodeURIComponent(device)}&created_at=gt.${since}&select=id`);
    if (recent.length) throw new HttpError(429, 'Thanks! You already reported a wait here in the last 10 minutes.');
    await db('waits', { method: 'POST', body: { display_id: id, device, minutes } });
    return { ok: true };
  }

  throw new HttpError(400, 'Unknown action');
});
