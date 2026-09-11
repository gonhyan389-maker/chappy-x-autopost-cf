import { env, json, requireAdmin, roomHistoryMap } from './_side-lib.mjs';

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (req.method !== 'GET') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const history = await roomHistoryMap();
  let posted = 0;
  let skipped = 0;
  for (const row of history.values()) {
    if (row.status === 'POSTED') posted += 1;
    if (row.status === 'SKIPPED') skipped += 1;
  }

  const noteCookie = env('NOTE_SESSION_COOKIE');
  const noteEmail = env('NOTE_EMAIL');
  const notePassword = env('NOTE_PASSWORD');

  return json({
    room: {
      configured: Boolean(env('RAKUTEN_APP_ID') && env('RAKUTEN_ACCESS_KEY')),
      affiliateConfigured: Boolean(env('RAKUTEN_AFFILIATE_ID')),
      posted,
      skipped
    },
    note: {
      enabled: env('NOTE_AUTOPUBLISH_ENABLED').toLowerCase() === 'true',
      urlname: env('NOTE_URLNAME') || null,
      authConfigured: Boolean(noteCookie || (noteEmail && notePassword))
    },
    ai: {
      configured: Boolean(env('OPENAI_API_KEY')),
      model: env('OPENAI_MODEL') || null
    }
  });
};
