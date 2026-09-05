import { getSettings, listPosts, putPost, createXPost, appendAudit } from './_lib.mjs';
export default async () => {
  const settings = await getSettings();
  if (!settings.postingEnabled) {
    console.log('Global posting switch is OFF.');
    return;
  }
  const now = Date.now();
  const posts = await listPosts();
  const due = posts.filter(p => p.status === 'APPROVED' && new Date(p.scheduledFor).getTime() <= now);
  for (const post of due) {
    try {
      const result = await createXPost(post.text, { madeWithAi: post.madeWithAi });
      post.status = 'POSTED';
      post.postedAt = new Date().toISOString();
      post.xPostId = result?.data?.id || null;
      post.error = null;
      await putPost(post);
      await appendAudit('POST_SENT_TO_X', { postId: post.id, xPostId: post.xPostId });
    } catch (err) {
      post.status = 'ERROR';
      post.error = String(err?.message || err);
      await putPost(post);
      await appendAudit('POST_ERROR', { postId: post.id, error: post.error });
      console.error(post.error);
    }
  }
};
