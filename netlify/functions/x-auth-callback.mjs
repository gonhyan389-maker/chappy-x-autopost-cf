import { metaStore, saveXTokenRecord, appendAudit } from './_lib.mjs';
export default async (req) => {
  const url = new URL(req.url);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  if (error) return new Response(`X authorization failed: ${error}`, { status: 400 });
  if (!state || !code) return new Response('Missing state/code', { status: 400 });
  const store = metaStore();
  const pending = await store.get(`oauth/${state}`, { type: 'json', consistency: 'strong' });
  if (!pending?.verifier || Date.now() - pending.createdAt > 10 * 60 * 1000) return new Response('Invalid or expired OAuth state', { status: 400 });

  const body = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: process.env.X_CLIENT_ID || '',
    redirect_uri: process.env.X_REDIRECT_URI || '',
    code_verifier: pending.verifier
  });
  const headers = { 'content-type': 'application/x-www-form-urlencoded' };
  if (process.env.X_CLIENT_SECRET) {
    headers.authorization = `Basic ${Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString('base64')}`;
  }
  const res = await fetch('https://api.x.com/2/oauth2/token', { method: 'POST', headers, body });
  const data = await res.json();
  if (!res.ok) return new Response(`Token exchange failed: ${res.status} ${JSON.stringify(data)}`, { status: 500 });
  await saveXTokenRecord(data);
  await store.delete(`oauth/${state}`);
  await appendAudit('X_CONNECTED', {});
  return new Response(`<!doctype html><meta charset="utf-8"><title>X Connected</title><style>body{font-family:system-ui;padding:40px;background:#0b0d10;color:#fff}a{color:#7cc7ff}</style><h1>✓ X接続完了</h1><p>このタブを閉じて管理画面へ戻ってください。</p><a href="/">管理画面へ戻る</a>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
};
