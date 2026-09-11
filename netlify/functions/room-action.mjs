import { json, normalizeItemKey, requireAdmin, roomStore } from './_side-lib.mjs';

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const body = await req.json().catch(() => ({}));
  const itemCode = String(body.itemCode || '').trim();
  const action = String(body.action || '').toUpperCase();
  if (!itemCode) return json({ error: 'ITEM_CODE_REQUIRED' }, 400);
  if (!['POSTED', 'SKIPPED', 'RESET'].includes(action)) {
    return json({ error: 'INVALID_ACTION' }, 400);
  }

  const store = roomStore();
  const key = `history/${normalizeItemKey(itemCode)}`;

  if (action === 'RESET') {
    await store.delete(key);
    return json({ ok: true, itemCode, status: null });
  }

  const record = {
    itemCode,
    status: action,
    itemName: String(body.itemName || '').slice(0, 240),
    itemUrl: String(body.itemUrl || '').slice(0, 1500),
    keyword: String(body.keyword || '').slice(0, 80),
    at: new Date().toISOString()
  };
  await store.setJSON(key, record);
  return json({ ok: true, record });
};
