import { getStore } from '@netlify/blobs';

export function env(name) {
  return Netlify.env.get(name) || '';
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

export function requireAdmin(req) {
  const expected = env('ADMIN_SECRET');
  const auth = req.headers.get('authorization') || '';
  if (!expected || auth !== `Bearer ${expected}`) {
    return json({ error: 'UNAUTHORIZED' }, 401);
  }
  return null;
}

export function roomStore() {
  return getStore('side-loop-room', { consistency: 'strong' });
}

export function normalizeItemKey(itemCode) {
  return encodeURIComponent(String(itemCode || '').trim());
}

export async function roomHistoryMap() {
  const store = roomStore();
  const { blobs } = await store.list({ prefix: 'history/' });
  const rows = new Map();
  for (const blob of blobs) {
    const row = await store.get(blob.key, { type: 'json' });
    if (row?.itemCode) rows.set(row.itemCode, row);
  }
  return rows;
}

export function cleanText(value, max = 120) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
