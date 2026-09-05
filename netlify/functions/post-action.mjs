import { json, requireAdmin, getPost, putPost, appendAudit } from './_lib.mjs';
export default async (req) => {
  const denied = requireAdmin(req); if (denied) return denied;
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const body = await req.json();
  const post = await getPost(body.id);
  if (!post) return json({ error: 'NOT_FOUND' }, 404);
  const action = body.action;
  if (action === 'approve') {
    if (post.status !== 'DRAFT' && post.status !== 'ERROR') return json({ error: 'INVALID_STATE', status: post.status }, 409);
    post.status = 'APPROVED'; post.approvedAt = new Date().toISOString(); post.error = null;
    await appendAudit('POST_APPROVED', { postId: post.id });
  } else if (action === 'cancel') {
    if (post.status === 'POSTED') return json({ error: 'ALREADY_POSTED' }, 409);
    post.status = 'CANCELLED';
    await appendAudit('POST_CANCELLED', { postId: post.id });
  } else {
    return json({ error: 'UNKNOWN_ACTION' }, 400);
  }
  await putPost(post);
  return json({ post });
};
