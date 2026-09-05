import { json, requireAdmin, getSettings, getXTokenRecord, listPosts } from './_lib.mjs';
export default async (req) => {
  const denied = requireAdmin(req); if (denied) return denied;
  const [settings, token, posts] = await Promise.all([getSettings(), getXTokenRecord(), listPosts()]);
  return json({
    ok: true,
    xConnected: Boolean(token?.access_token),
    tokenExpiresAt: token?.expires_at || null,
    settings,
    counts: {
      total: posts.length,
      draft: posts.filter(p => p.status === 'DRAFT').length,
      approved: posts.filter(p => p.status === 'APPROVED').length,
      posted: posts.filter(p => p.status === 'POSTED').length,
      error: posts.filter(p => p.status === 'ERROR').length
    }
  });
};
