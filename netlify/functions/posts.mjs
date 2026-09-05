import { json, requireAdmin, listPosts, id, putPost, appendAudit } from './_lib.mjs';
export default async (req) => {
  const denied = requireAdmin(req); if (denied) return denied;
  if (req.method === 'GET') return json({ posts: await listPosts() });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const body = await req.json();
  const text = String(body.text || '').trim();
  const scheduledFor = body.scheduledFor ? new Date(body.scheduledFor).toISOString() : null;
  if (!text) return json({ error: 'TEXT_REQUIRED' }, 400);
  if (!scheduledFor) return json({ error: 'SCHEDULE_REQUIRED' }, 400);
  if (new Date(scheduledFor).getTime() <= Date.now()) return json({ error: 'SCHEDULE_MUST_BE_FUTURE' }, 400);
  const post = {
    id: id('post'), text, scheduledFor,
    madeWithAi: Boolean(body.madeWithAi),
    status: 'DRAFT',
    approvedAt: null,
    postedAt: null,
    xPostId: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await putPost(post);
  await appendAudit('POST_DRAFT_CREATED', { postId: post.id, scheduledFor });
  return json({ post }, 201);
};
