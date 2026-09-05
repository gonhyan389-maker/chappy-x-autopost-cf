import { json, requireAdmin, getSettings, putSettings, appendAudit } from './_lib.mjs';
export default async (req) => {
  const denied = requireAdmin(req); if (denied) return denied;
  if (req.method === 'GET') return json({ settings: await getSettings() });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const body = await req.json();
  const settings = await getSettings();
  if (typeof body.postingEnabled === 'boolean') settings.postingEnabled = body.postingEnabled;
  await putSettings(settings);
  await appendAudit('SETTINGS_CHANGED', { postingEnabled: settings.postingEnabled });
  return json({ settings });
};
