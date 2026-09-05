import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

export const POSTS_STORE = 'chappy-x-posts';
export const META_STORE = 'chappy-x-meta';

export function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

export function isAdmin(req) {
  const expected = process.env.ADMIN_SECRET;
  if (!expected) return false;
  const auth = req.headers.get('authorization') || '';
  return auth === `Bearer ${expected}`;
}

export function requireAdmin(req) {
  if (!isAdmin(req)) return json({ error: 'UNAUTHORIZED' }, 401);
  return null;
}

export function id(prefix = 'p') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
}

export function base64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest();
}

export function randomToken(bytes = 32) {
  return base64url(crypto.randomBytes(bytes));
}

export function postStore() {
  return getStore(POSTS_STORE);
}

export function metaStore() {
  return getStore(META_STORE);
}

export async function getSettings() {
  const store = metaStore();
  return (await store.get('settings', { type: 'json', consistency: 'strong' })) || {
    postingEnabled: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export async function putSettings(settings) {
  const store = metaStore();
  settings.updatedAt = new Date().toISOString();
  await store.setJSON('settings', settings);
  return settings;
}

export async function listPosts() {
  const store = postStore();
  const result = await store.list({ prefix: 'post/' });
  const rows = [];
  for (const item of result.blobs) {
    const post = await store.get(item.key, { type: 'json', consistency: 'strong' });
    if (post) rows.push(post);
  }
  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return rows;
}

export async function getPost(postId) {
  return postStore().get(`post/${postId}`, { type: 'json', consistency: 'strong' });
}

export async function putPost(post) {
  post.updatedAt = new Date().toISOString();
  await postStore().setJSON(`post/${post.id}`, post);
  return post;
}

export async function appendAudit(event, detail = {}) {
  const store = metaStore();
  const auditId = id('audit');
  await store.setJSON(`audit/${auditId}`, {
    id: auditId,
    event,
    detail,
    at: new Date().toISOString()
  });
}

export async function getXTokenRecord() {
  return metaStore().get('x-token', { type: 'json', consistency: 'strong' });
}

export async function saveXTokenRecord(token) {
  const now = Date.now();
  const expiresIn = Number(token.expires_in || 0);
  const record = {
    ...token,
    obtained_at: now,
    expires_at: expiresIn ? now + expiresIn * 1000 : null
  };
  await metaStore().setJSON('x-token', record);
  return record;
}

export async function refreshXAccessToken(record) {
  if (!record?.refresh_token) throw new Error('No refresh token available. Reconnect X.');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: record.refresh_token,
    client_id: process.env.X_CLIENT_ID || ''
  });
  const headers = { 'content-type': 'application/x-www-form-urlencoded' };
  if (process.env.X_CLIENT_SECRET) {
    headers.authorization = `Basic ${Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString('base64')}`;
  }
  const res = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST', headers, body
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`X refresh failed: ${res.status} ${JSON.stringify(data)}`);
  if (!data.refresh_token && record.refresh_token) data.refresh_token = record.refresh_token;
  return saveXTokenRecord(data);
}

export async function getValidXAccessToken() {
  let record = await getXTokenRecord();
  if (!record?.access_token) throw new Error('X is not connected.');
  if (record.expires_at && Date.now() > record.expires_at - 120000) {
    record = await refreshXAccessToken(record);
  }
  return record.access_token;
}

export async function createXPost(text, options = {}) {
  const accessToken = await getValidXAccessToken();
  const payload = { text };
  const res = await fetch('https://api.x.com/2/tweets', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`X create post failed: ${res.status} ${JSON.stringify(data)}`);
  return data;
}
