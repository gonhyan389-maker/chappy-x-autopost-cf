function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function isAdmin(req, env) {
  const expected = env.ADMIN_SECRET;
  const auth = req.headers.get('authorization') || '';
  return Boolean(expected) && auth === `Bearer ${expected}`;
}

function randomToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return base64url(arr);
}

function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

function basicAuth(id, secret) {
  return `Basic ${btoa(`${id}:${secret}`)}`;
}

async function callState(env, path, init = {}) {
  const id = env.APP_STATE.idFromName('global');
  const stub = env.APP_STATE.get(id);
  return stub.fetch(`https://state.internal${path}`, init);
}

function envHeaders(env) {
  return {
    'x-x-client-id': env.X_CLIENT_ID || '',
    'x-x-client-secret': env.X_CLIENT_SECRET || '',
    'x-x-redirect-uri': env.X_REDIRECT_URI || ''
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/env-health') {
      return json({
        ok: true,
        worker: 'chappy-x-autopost-cf',
        xClientIdConfigured: Boolean(env.X_CLIENT_ID),
        xClientSecretConfigured: Boolean(env.X_CLIENT_SECRET),
        xRedirectUriConfigured: Boolean(env.X_REDIRECT_URI),
        adminSecretConfigured: Boolean(env.ADMIN_SECRET),
        appStateConfigured: Boolean(env.APP_STATE),
        redirectUri: env.X_REDIRECT_URI || null
      });
    }

    if (url.pathname === '/api/x-auth-callback') {
      const params = new URLSearchParams(url.search);
      return callState(env, `/x-auth-callback?${params.toString()}`, { headers: envHeaders(env) });
    }

    if (url.pathname.startsWith('/api/')) {
      if (!isAdmin(request, env)) return json({ error: 'UNAUTHORIZED' }, 401);
      const path = url.pathname.replace('/api/', '/');
      const headers = new Headers(request.headers);
      for (const [k,v] of Object.entries(envHeaders(env))) headers.set(k, v);
      const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
      return callState(env, path + url.search, { method: request.method, headers, body });
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(callState(env, '/run-scheduler', { method: 'POST', headers: envHeaders(env) }));
  }
};

export class AppState {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    try {
      switch (url.pathname) {
        case '/status': return this.status();
        case '/settings': return this.settings(request);
        case '/posts': return this.posts(request);
        case '/post-action': return this.postAction(request);
        case '/seed-week': return this.seedWeek(request);
        case '/x-auth-start': return this.xAuthStart(request);
        case '/x-auth-callback': return this.xAuthCallback(url, request);
        case '/run-scheduler': return this.runScheduler(request);
        default: return json({ error: 'NOT_FOUND' }, 404);
      }
    } catch (err) {
      return json({ error: String(err?.message || err) }, 500);
    }
  }

  async getSettings() {
    return (await this.ctx.storage.get('settings')) || {
      postingEnabled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  async putSettings(settings) {
    settings.updatedAt = new Date().toISOString();
    await this.ctx.storage.put('settings', settings);
    return settings;
  }

  async listPosts() {
    const map = await this.ctx.storage.list({ prefix: 'post/' });
    const rows = [...map.values()];
    rows.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    return rows;
  }

  async getPost(id) { return this.ctx.storage.get(`post/${id}`); }
  async putPost(post) {
    post.updatedAt = new Date().toISOString();
    await this.ctx.storage.put(`post/${post.id}`, post);
    return post;
  }

  async audit(event, detail = {}) {
    const id = `audit_${Date.now()}_${crypto.randomUUID()}`;
    await this.ctx.storage.put(`audit/${id}`, { id, event, detail, at: new Date().toISOString() });
  }

  async status() {
    const [settings, token, posts] = await Promise.all([
      this.getSettings(), this.ctx.storage.get('x-token'), this.listPosts()
    ]);
    return json({
      ok: true,
      xConnected: Boolean(token?.access_token),
      tokenExpiresAt: token?.expires_at || null,
      settings,
      counts: {
        total: posts.length,
        draft: posts.filter(p=>p.status==='DRAFT').length,
        approved: posts.filter(p=>p.status==='APPROVED').length,
        posted: posts.filter(p=>p.status==='POSTED').length,
        error: posts.filter(p=>p.status==='ERROR').length
      }
    });
  }

  async settings(request) {
    if (request.method === 'GET') return json({ settings: await this.getSettings() });
    if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    const body = await request.json();
    const settings = await this.getSettings();
    if (typeof body.postingEnabled === 'boolean') settings.postingEnabled = body.postingEnabled;
    await this.putSettings(settings);
    await this.audit('POSTING_SWITCH_CHANGED', { postingEnabled: settings.postingEnabled });
    return json({ settings });
  }

  async posts(request) {
    if (request.method === 'GET') return json({ posts: await this.listPosts() });
    if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    const body = await request.json();
    const text = String(body.text || '').trim();
    const scheduledFor = body.scheduledFor ? new Date(body.scheduledFor).toISOString() : null;
    if (!text) return json({ error: 'TEXT_REQUIRED' }, 400);
    if (!scheduledFor) return json({ error: 'SCHEDULE_REQUIRED' }, 400);
    if (new Date(scheduledFor).getTime() <= Date.now()) return json({ error: 'SCHEDULE_MUST_BE_FUTURE' }, 400);
    const post = {
      id: `post_${Date.now()}_${crypto.randomUUID()}`,
      text,
      scheduledFor,
      madeWithAi: Boolean(body.madeWithAi),
      status: 'DRAFT', approvedAt: null, postedAt: null, xPostId: null, error: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    await this.putPost(post);
    await this.audit('POST_DRAFT_CREATED', { postId: post.id, scheduledFor });
    return json({ post }, 201);
  }

  async postAction(request) {
    if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    const body = await request.json();
    const post = await this.getPost(body.id);
    if (!post) return json({ error: 'NOT_FOUND' }, 404);
    if (body.action === 'approve') {
      if (!['DRAFT','ERROR'].includes(post.status)) return json({ error: 'INVALID_STATE', status: post.status }, 409);
      post.status = 'APPROVED';
      post.approvedAt = new Date().toISOString();
      post.error = null;
      await this.audit('POST_APPROVED', { postId: post.id });
    } else if (body.action === 'cancel') {
      if (post.status === 'POSTED') return json({ error: 'ALREADY_POSTED' }, 409);
      post.status = 'CANCELLED';
      await this.audit('POST_CANCELLED', { postId: post.id });
    } else {
      return json({ error: 'UNKNOWN_ACTION' }, 400);
    }
    await this.putPost(post);
    return json({ post });
  }

  async xAuthStart(request) {
    const clientId = request.headers.get('x-x-client-id') || '';
    const redirectUri = request.headers.get('x-x-redirect-uri') || '';
    if (!clientId || !redirectUri) {
      return json({ error: 'X_OAUTH_ENV_MISSING', clientIdConfigured: Boolean(clientId), redirectUriConfigured: Boolean(redirectUri) }, 500);
    }
    const state = randomToken(24);
    const verifier = randomToken(48);
    const challenge = base64url(await sha256(verifier));
    await this.ctx.storage.put(`oauth/${state}`, { verifier, createdAt: Date.now() });
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
  }

  async exchangeToken({ code, verifier, clientId, clientSecret, redirectUri }) {
    const body = new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier
    });

    const attempt = async (useBasic) => {
      const headers = { 'content-type': 'application/x-www-form-urlencoded' };
      if (useBasic) headers.authorization = basicAuth(clientId, clientSecret);
      const res = await fetch('https://api.x.com/2/oauth2/token', { method: 'POST', headers, body });
      let data;
      try { data = await res.json(); } catch { data = { raw: await res.text() }; }
      return { res, data, mode: useBasic ? 'confidential-basic' : 'pkce-public' };
    };

    if (clientSecret) {
      const first = await attempt(true);
      if (first.res.ok) return first;
      if (first.res.status !== 401) return first;
      const fallback = await attempt(false);
      if (fallback.res.ok) return fallback;
      return { res: fallback.res, data: { primary: first.data, fallback: fallback.data }, mode: 'both-failed' };
    }

    return attempt(false);
  }

  async xAuthCallback(url, request) {
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (error) return new Response(`X authorization failed: ${error}`, { status: 400 });
    if (!state || !code) return new Response('Missing state/code', { status: 400 });

    const pending = await this.ctx.storage.get(`oauth/${state}`);
    if (!pending?.verifier || Date.now() - pending.createdAt > 10 * 60 * 1000) {
      return new Response('Invalid or expired OAuth state', { status: 400 });
    }

    const clientId = request.headers.get('x-x-client-id') || '';
    const clientSecret = request.headers.get('x-x-client-secret') || '';
    const redirectUri = request.headers.get('x-x-redirect-uri') || '';

    if (!clientId || !redirectUri) {
      return new Response(`X OAuth configuration missing. clientId=${Boolean(clientId)} redirectUri=${Boolean(redirectUri)}`, { status: 500 });
    }

    const result = await this.exchangeToken({ code, verifier: pending.verifier, clientId, clientSecret, redirectUri });
    if (!result.res.ok) {
      return new Response(
        `Token exchange failed: ${result.res.status} mode=${result.mode} secretConfigured=${Boolean(clientSecret)} ${JSON.stringify(result.data)}`,
        { status: 500 }
      );
    }

    await this.saveToken(result.data);
    await this.ctx.storage.delete(`oauth/${state}`);
    await this.audit('X_CONNECTED', { mode: result.mode });

    return new Response(`<!doctype html><meta charset="utf-8"><title>X Connected</title><style>body{font-family:system-ui;padding:40px;background:#0b0d10;color:#fff}a{color:#7cc7ff}</style><h1>✓ X接続完了</h1><p>このタブを閉じて管理画面へ戻ってください。</p><a href="/">管理画面へ戻る</a>`, {
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  }

  async saveToken(token) {
    const now = Date.now();
    const expiresIn = Number(token.expires_in || 0);
    const rec = { ...token, obtained_at: now, expires_at: expiresIn ? now + expiresIn * 1000 : null };
    await this.ctx.storage.put('x-token', rec);
    return rec;
  }

  async refreshToken(record, request) {
    if (!record?.refresh_token) throw new Error('No refresh token available. Reconnect X.');
    const clientId = request.headers.get('x-x-client-id') || '';
    const clientSecret = request.headers.get('x-x-client-secret') || '';
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: record.refresh_token, client_id: clientId });

    const tryRefresh = async (useBasic) => {
      const headers = { 'content-type': 'application/x-www-form-urlencoded' };
      if (useBasic) headers.authorization = basicAuth(clientId, clientSecret);
      const res = await fetch('https://api.x.com/2/oauth2/token', { method: 'POST', headers, body });
      const data = await res.json();
      return { res, data };
    };

    let result = clientSecret ? await tryRefresh(true) : await tryRefresh(false);
    if (!result.res.ok && clientSecret && result.res.status === 401) result = await tryRefresh(false);
    if (!result.res.ok) throw new Error(`X refresh failed: ${result.res.status} ${JSON.stringify(result.data)}`);
    if (!result.data.refresh_token) result.data.refresh_token = record.refresh_token;
    return this.saveToken(result.data);
  }

  async validAccessToken(request) {
    let record = await this.ctx.storage.get('x-token');
    if (!record?.access_token) throw new Error('X is not connected.');
    if (record.expires_at && Date.now() > record.expires_at - 120000) record = await this.refreshToken(record, request);
    return record.access_token;
  }

  async createXPost(text, request) {
    const token = await this.validAccessToken(request);
    const res = await fetch('https://api.x.com/2/tweets', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`X create post failed: ${res.status} ${JSON.stringify(data)}`);
    return data;
  }

  async runScheduler(request) {
    const settings = await this.getSettings();
    if (!settings.postingEnabled) return json({ ok: true, postingEnabled: false, sent: 0 });
    const posts = await this.listPosts();
    const due = posts.filter(p => p.status === 'APPROVED' && new Date(p.scheduledFor).getTime() <= Date.now());
    let sent = 0;
    for (const post of due) {
      try {
        const result = await this.createXPost(post.text, request);
        post.status = 'POSTED';
        post.postedAt = new Date().toISOString();
        post.xPostId = result?.data?.id || null;
        post.error = null;
        await this.putPost(post);
        await this.audit('POST_SENT_TO_X', { postId: post.id, xPostId: post.xPostId });
        sent++;
      } catch (err) {
        post.status = 'ERROR';
        post.error = String(err?.message || err);
        await this.putPost(post);
        await this.audit('POST_ERROR', { postId: post.id, error: post.error });
      }
    }
    return json({ ok: true, postingEnabled: true, sent });
  }

  async seedWeek(request) {
    if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    const existing = await this.listPosts();
    if (existing.find(p => p.seedBatch === 'v2-week-01' && p.status !== 'CANCELLED')) return json({ error: 'WEEK_ALREADY_SEEDED' }, 409);

    const promptPosts = [
      `ChatGPT、普通に質問するだけだともったいない。\n\n最後にこれを足してみて👇\n「答えを出すだけじゃなく、見落としてる点・次にやること・2手先で起きそうな問題まで考えて」\n\n“回答AI”から“秘書AI”っぽくなる。`,
      `ChatGPTに案を出してもらう時はこれ👇\n\n「メリット・デメリットだけで終わらず、今の状況ならどれを選ぶべきか1つ決めて。理由と、判断が変わる条件も書いて」`,
      `文章がAIっぽい時はこれ👇\n\n「意味は変えずに、AIっぽい言い回しを減らして自然な日本語に。短く、口語寄りで。」`
    ];

    const videoPosts = [
      `AI動画って「作ってみたいけど、何をどう入力すればいいか分からない」で止まる人が多い。\n\nAI COACH VIDEOなら、作りたい内容を入れる→構成を考える→そのまま動画生成まで進められます。\n\nhttps://ai-coach-app.com/video/`,
      `SNS用の短い動画、撮影しなくても作れる時代。\n\n商品紹介・サービス説明・イメージ動画まで、作りたい内容からAIで動画化。\n\nAI COACH VIDEO👇\nhttps://ai-coach-app.com/video/`,
      `AI動画を作る時は「場所・被写体・動き・カメラ・雰囲気」を入れるだけでもかなり変わる。\n\nその整理から動画生成までまとめて試せます👇\nhttps://ai-coach-app.com/video/`
    ];

    const slots = [8, 11, 14, 17, 20, 22];
    const now = new Date();
    const jstOffset = 9 * 60 * 60 * 1000;
    const nowJst = new Date(now.getTime() + jstOffset);
    const startJst = new Date(Date.UTC(nowJst.getUTCFullYear(), nowJst.getUTCMonth(), nowJst.getUTCDate(), 0, 0, 0));
    let created = 0;

    for (let day = 0; day < 7; day++) {
      for (let i = 0; i < slots.length; i++) {
        const hour = slots[i];
        const minute = i === 5 ? 30 : 0;
        const scheduledUtc = new Date(startJst.getTime() + day * 86400000 + hour * 3600000 + minute * 60000 - jstOffset);
        if (scheduledUtc.getTime() <= Date.now()) continue;
        const source = i % 2 === 0 ? promptPosts : videoPosts;
        const text = source[(day * 3 + Math.floor(i / 2)) % source.length];
        const post = {
          id: `post_${Date.now()}_${crypto.randomUUID()}`,
          text,
          scheduledFor: scheduledUtc.toISOString(),
          madeWithAi: true,
          status: 'DRAFT',
          approvedAt: null,
          postedAt: null,
          xPostId: null,
          error: null,
          seedBatch: 'v2-week-01',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        await this.putPost(post);
        created++;
      }
    }

    await this.audit('WEEK_SEEDED', { batch: 'v2-week-01', created });
    return json({ ok: true, created }, 201);
  }
}
