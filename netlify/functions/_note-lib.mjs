import { getStore } from '@netlify/blobs';
import { appendAudit, createXPost } from './_lib.mjs';

const NOTE_API_BASE = 'https://note.com/api';
const NOTE_EDITOR_ORIGIN = 'https://editor.note.com';
const NOTE_EDITOR_REFERER = 'https://editor.note.com/';
const NOTE_STORE = 'chappy-note-posts';
const DEFAULT_MODEL = 'gpt-5.6-luna';
const DEFAULT_URLNAME = 'libertas_reiya';

function noteStore() {
  return getStore(NOTE_STORE);
}

function stripHtml(html = '') {
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try { return JSON.parse(fenced[1]); } catch {}
    }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch {}
    }
    throw new Error('AI response was not valid JSON.');
  }
}

function responseText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  const parts = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

function normalizeArticle(raw) {
  const title = String(raw?.title || '').trim();
  const bodyHtml = String(raw?.body_html || raw?.bodyHtml || '').trim();
  const tags = Array.isArray(raw?.tags)
    ? raw.tags.map(v => String(v || '').trim().replace(/^#/, '')).filter(Boolean).slice(0, 5)
    : [];
  const xAnnouncement = String(raw?.x_announcement || raw?.xAnnouncement || '').trim();

  if (title.length < 8) throw new Error('Generated note title is too short.');
  if (stripHtml(bodyHtml).length < 500) throw new Error('Generated note body is too short.');

  return {
    title: title.slice(0, 80),
    bodyHtml,
    tags: tags.length ? tags : ['ChatGPT', 'AI活用', 'AI初心者'],
    xAnnouncement: xAnnouncement.slice(0, 220)
  };
}

export async function listNoteHistory(limit = 30) {
  const store = noteStore();
  const listed = await store.list({ prefix: 'note/' });
  const rows = [];
  for (const item of listed.blobs) {
    const rec = await store.get(item.key, { type: 'json', consistency: 'strong' });
    if (rec) rows.push(rec);
  }
  rows.sort((a, b) => new Date(b.publishedAt || b.createdAt) - new Date(a.publishedAt || a.createdAt));
  return rows.slice(0, limit);
}

async function saveNoteHistory(record) {
  const store = noteStore();
  await store.setJSON(`note/${record.id}`, record);
  return record;
}

export async function generateNoteArticle() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is missing.');

  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const history = await listNoteHistory(30);
  const recentTitles = history.map(x => x.title).filter(Boolean);
  const todayJst = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
  }).format(new Date());

  const prompt = `あなたは日本語noteの編集者です。以下の条件で、毎日公開できる無料note記事を1本作成してください。

【発信者の軸】
- プログラミング未経験からAIを実際に使い、試行錯誤している人
- 読者はAI初心者、副業や仕事効率化に興味がある人
- 車・整備・ロードサービスなど自動車分野の話題は使わない
- 成功者を装わない。売上・人数・実績・体験を捏造しない
- 「絶対稼げる」「誰でも儲かる」など誇大表現は禁止
- 今回は無料記事。読者がその場で1つ試せる実用品を必ず入れる

【記事の方向性】
次のどれか1つを選ぶ：
1. ChatGPTですぐ使えるコピペプロンプト
2. AIを使うときの失敗回避
3. AI初心者が無駄な課金を避ける考え方
4. AIで情報・デジタル商品を作るときの考え方
5. AIを秘書・相談相手として使う具体的方法
6. AIツールを作る前に需要確認する方法

【今日】${todayJst}
【直近タイトル。重複禁止】
${recentTitles.length ? recentTitles.map((t, i) => `${i + 1}. ${t}`).join('\n') : 'なし'}

【構成】
- タイトル：28〜45文字を目安。煽りすぎず、続きを読みたくなるもの
- 冒頭：2〜4文で悩みを提示
- h2見出しを2〜4個
- 具体例を入れる
- コピペして使えるプロンプトを1個入れる
- 最後は短いまとめ＋フォロー導線
- 本文は日本語900〜1800文字程度
- HTMLはnoteで扱いやすい <p><h2><h3><ul><ol><li><strong><blockquote><hr> 程度だけを使う
- 外部リンクや存在確認できない固有サービス情報は書かない

次のJSONだけを返してください。コードフェンス不要。
{
  "title": "...",
  "body_html": "...",
  "tags": ["ChatGPT", "AI活用", "AI初心者"],
  "x_announcement": "note公開告知用の短い文章。URLは含めない"
}`;

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input: prompt,
      reasoning: { effort: 'low' },
      max_output_tokens: 2600
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI generation failed: ${res.status} ${JSON.stringify(data).slice(0, 800)}`);
  const text = responseText(data);
  if (!text) throw new Error('OpenAI returned no text output.');
  return normalizeArticle(safeJson(text));
}

function extractCookieFromLogin(res, data) {
  const cookieParts = [];
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie') || ''];

  for (const raw of setCookies) {
    for (const name of ['_note_session_v5', 'XSRF-TOKEN']) {
      const match = String(raw).match(new RegExp(`(?:^|[,;]\\s*)(${name}=[^;,\\s]+)`));
      if (match?.[1] && !cookieParts.some(x => x.startsWith(`${name}=`))) cookieParts.push(match[1]);
    }
  }

  if (!cookieParts.some(x => x.startsWith('_note_session_v5='))) {
    const token = data?.data?.token;
    if (token) cookieParts.unshift(`_note_session_v5=${token}`);
  }

  return cookieParts.join('; ');
}

export async function noteLogin() {
  if (process.env.NOTE_SESSION_COOKIE) return process.env.NOTE_SESSION_COOKIE.trim();

  const email = process.env.NOTE_EMAIL;
  const password = process.env.NOTE_PASSWORD;
  if (!email || !password) throw new Error('NOTE_EMAIL / NOTE_PASSWORD (or NOTE_SESSION_COOKIE) is missing.');

  const res = await fetch(`${NOTE_API_BASE}/v1/sessions/sign_in`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
    },
    body: JSON.stringify({ login: email, password })
  });

  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`note login failed: ${res.status} ${text.slice(0, 500)}`);

  const cookie = extractCookieFromLogin(res, data);
  if (!cookie.includes('_note_session_v5=')) throw new Error('note login succeeded but session cookie was not returned.');
  return cookie;
}

async function noteRequest(cookie, path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('accept', 'application/json');
  headers.set('cookie', cookie);
  headers.set('user-agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36');
  headers.set('x-requested-with', 'XMLHttpRequest');
  if (typeof init.body === 'string' && !headers.has('content-type')) headers.set('content-type', 'application/json');

  const method = String(init.method || 'GET').toUpperCase();
  if (method === 'POST' || method === 'PUT') {
    headers.set('origin', NOTE_EDITOR_ORIGIN);
    headers.set('referer', NOTE_EDITOR_REFERER);
  }

  const res = await fetch(`${NOTE_API_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!res.ok) throw new Error(`note API ${method} ${path} failed: ${res.status} ${String(text).slice(0, 800)}`);
  return data;
}

function publishPayload(note, tags = []) {
  const body = String(note?.body || note?.free_body || '');
  return {
    author_ids: [],
    body_length: stripHtml(body).length,
    disable_comment: Boolean(note?.disableComment ?? note?.disable_comment ?? false),
    exclude_from_creator_top: Boolean(note?.excludeFromCreatorTop ?? note?.exclude_from_creator_top ?? false),
    exclude_ai_learning_reward: Boolean(note?.excludeAiLearningReward ?? note?.exclude_ai_learning_reward ?? false),
    translation_setting: note?.translationSetting ?? note?.translation_setting ?? null,
    free_body: body,
    hashtags: tags.map(t => t.startsWith('#') ? t : `#${t}`).slice(0, 10),
    image_keys: [],
    index: false,
    is_refund: false,
    limited: false,
    magazine_ids: [],
    magazine_keys: [],
    name: String(note?.name || ''),
    pay_body: '',
    price: 0,
    send_notifications_flag: Boolean(note?.sendNotificationsFlag ?? note?.send_notifications_flag ?? false),
    separator: note?.separator ?? null,
    slug: note?.slug ?? null,
    status: 'published',
    stock_photo_image_id: note?.stockPhotoImageId ?? note?.stock_photo_image_id ?? null,
    owner_urlname: null,
    circle_permissions: null,
    discount_campaigns: [],
    lead_form: null,
    line_add_friend: null,
    line_add_friend_access_token: null,
    pro_coupon_keys: []
  };
}

export async function publishArticleToNote(article) {
  const cookie = await noteLogin();

  const shell = await noteRequest(cookie, '/v1/text_notes', {
    method: 'POST',
    body: JSON.stringify({
      body: '',
      body_length: 0,
      name: article.title,
      index: false,
      is_lead_form: false
    })
  });

  const draft = shell?.data || {};
  const draftId = draft?.id;
  const noteKey = draft?.key || draft?.noteKey;
  if (!draftId || !noteKey) throw new Error(`note draft creation did not return id/key: ${JSON.stringify(shell).slice(0, 800)}`);

  await noteRequest(cookie, `/v1/text_notes/draft_save?id=${encodeURIComponent(String(draftId))}&is_temp_saved=true`, {
    method: 'POST',
    body: JSON.stringify({
      body: article.bodyHtml,
      body_length: stripHtml(article.bodyHtml).length,
      name: article.title,
      index: false,
      is_lead_form: false
    })
  });

  const detail = await noteRequest(
    cookie,
    `/v3/notes/${encodeURIComponent(noteKey)}?draft=true&draft_reedit=false&ts=${Date.now()}`
  );
  const note = detail?.data || {};
  if (!note?.id) throw new Error(`note draft detail missing id: ${JSON.stringify(detail).slice(0, 800)}`);

  const published = await noteRequest(cookie, `/v1/text_notes/${encodeURIComponent(String(note.id))}`, {
    method: 'PUT',
    body: JSON.stringify(publishPayload(note, article.tags))
  });

  const publishedData = published?.data || published || {};
  const finalKey = publishedData?.key || publishedData?.noteKey || noteKey;
  const urlname = process.env.NOTE_URLNAME || DEFAULT_URLNAME;
  return {
    noteKey: finalKey,
    url: `https://note.com/${urlname}/n/${finalKey}`,
    raw: publishedData
  };
}

function isEnabled(name, defaultValue = false) {
  const value = process.env[name];
  if (value == null || value === '') return defaultValue;
  return String(value).toLowerCase() === 'true';
}

export async function runNoteAutopost({ force = false } = {}) {
  if (!force && !isEnabled('NOTE_AUTOPUBLISH_ENABLED', false)) {
    return { ok: true, skipped: true, reason: 'NOTE_AUTOPUBLISH_ENABLED is off' };
  }

  const required = ['OPENAI_API_KEY'];
  if (!process.env.NOTE_SESSION_COOKIE) required.push('NOTE_EMAIL', 'NOTE_PASSWORD');
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    return { ok: true, skipped: true, reason: `Missing env: ${missing.join(', ')}` };
  }

  const article = await generateNoteArticle();
  const result = await publishArticleToNote(article);
  const record = {
    id: `note_${Date.now()}`,
    title: article.title,
    tags: article.tags,
    noteKey: result.noteKey,
    url: result.url,
    createdAt: new Date().toISOString(),
    publishedAt: new Date().toISOString(),
    model: process.env.OPENAI_MODEL || DEFAULT_MODEL
  };
  await saveNoteHistory(record);
  await appendAudit('NOTE_AUTO_PUBLISHED', { title: article.title, url: result.url, noteKey: result.noteKey });

  let x = null;
  if (isEnabled('NOTE_X_ANNOUNCE_ENABLED', false) && article.xAnnouncement) {
    try {
      const text = `${article.xAnnouncement}\n${result.url}`.slice(0, 275);
      x = await createXPost(text, { madeWithAi: true });
      await appendAudit('NOTE_X_ANNOUNCED', { noteKey: result.noteKey, xPostId: x?.data?.id || null });
    } catch (err) {
      await appendAudit('NOTE_X_ANNOUNCE_ERROR', { noteKey: result.noteKey, error: String(err?.message || err) });
      x = { error: String(err?.message || err) };
    }
  }

  return { ok: true, article: { title: article.title, tags: article.tags }, note: result, x };
}
