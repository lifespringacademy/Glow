// POST /api/stats { events: [{ id: 12, e: 'view' }, ...] }
// Counts listing activity per day: view, pin, directions, website, tour.
// Only counts are stored (no device or personal info). The app sends each action
// at most once per listing per phone per day.
import { db, handler, body, etDate, HttpError } from '../lib/util.js';

const EVENTS = ['view', 'pin', 'directions', 'website', 'tour'];

export default handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  let b = body(req);
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  const list = Array.isArray(b.events) ? b.events.slice(0, 40) : [];
  const seen = new Set();
  const rows = [];
  for (const x of list) {
    const id = Number(x && x.id);
    if (!Number.isInteger(id) || id <= 0 || !EVENTS.includes(x.e)) continue;
    const k = `${id}:${x.e}`;
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push({ display_id: id, event: x.e });
  }
  if (rows.length) await db('rpc/bump_stats', { method: 'POST', body: { p_day: etDate(), p_rows: rows } });
  return { ok: true, counted: rows.length };
});
