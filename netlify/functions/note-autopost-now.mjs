import { json, requireAdmin } from './_lib.mjs';
import { runNoteAutopost } from './_note-lib.mjs';

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    const result = await runNoteAutopost({ force: true });
    return json(result);
  } catch (err) {
    return json({ error: String(err?.message || err) }, 500);
  }
};
