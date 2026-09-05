import { requireAdmin, json, randomToken, sha256, base64url, metaStore } from './_lib.mjs';
export default async (req) => {
  const denied = requireAdmin(req); if (denied) return denied;
  const clientId = process.env.X_CLIENT_ID;
  const redirectUri = process.env.X_REDIRECT_URI;
  if (!clientId || !redirectUri) return json({ error: 'X_OAUTH_ENV_MISSING' }, 500);
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = base64url(sha256(verifier));
  await metaStore().setJSON(`oauth/${state}`, { verifier, createdAt: Date.now() });
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'tweet.read tweet.write users.read offline.access',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  });
  return json({ url: `https://x.com/i/oauth2/authorize?${params.toString()}` });
};
