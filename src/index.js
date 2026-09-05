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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/x-auth-callback') {
      const params = new URLSearchParams(url.search);
      return callState(env, `/x-auth-callback?${params.toString()}`, {
        headers: {
          'x-x-client-id': env.X_CLIENT_ID || '',
          'x-x-client-secret': env.X_CLIENT_SECRET || '',
          'x-x-redirect-uri': env.X_REDIRECT_URI || ''
        }
      });
    }

    if (url.pathname.startsWith('/api/')) {
      if (!isAdmin(request, env)) return json({ error: 'UNAUTHORIZED' }, 401);
      const path = url.pathname.replace('/api/', '/');
      const headers = new Headers(request.headers);
      headers.set('x-x-client-id', env.X_CLIENT_ID || '');
      headers.set('x-x-client-secret', env.X_CLIENT_SECRET || '');
      headers.set('x-x-redirect-uri', env.X_REDIRECT_URI || '');
      const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
      return callState(env, path + url.search, { method: request.method, headers, body });
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(callState(env, '/run-scheduler', {
      method: 'POST',
      headers: {
        'x-x-client-id': env.X_CLIENT_ID || '',
        'x-x-client-secret': env.X_CLIENT_SECRET || '',
        'x-x-redirect-uri': env.X_REDIRECT_URI || ''
      }
    }));
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
      post.status = 'APPROVED'; post.approvedAt = new Date().toISOString(); post.error = null;
      await this.audit('POST_APPROVED', { postId: post.id });
    } else if (body.action === 'cancel') {
      if (post.status === 'POSTED') return json({ error: 'ALREADY_POSTED' }, 409);
      post.status = 'CANCELLED';
      await this.audit('POST_CANCELLED', { postId: post.id });
    } else return json({ error: 'UNKNOWN_ACTION' }, 400);
    await this.putPost(post);
    return json({ post });
  }

  async xAuthStart(request) {
    const clientId = request.headers.get('x-x-client-id');
    const redirectUri = request.headers.get('x-x-redirect-uri');
    if (!clientId || !redirectUri) return json({ error: 'X_OAUTH_ENV_MISSING' }, 500);
    const state = randomToken(24);
    const verifier = randomToken(48);
    const challenge = base64url(await sha256(verifier));
    await this.ctx.storage.put(`oauth/${state}`, { verifier, createdAt: Date.now() });
    const params = new URLSearchParams({
      response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
      scope: 'tweet.read tweet.write users.read offline.access', state,
      code_challenge: challenge, code_challenge_method: 'S256'
    });
    return json({ url: `https://x.com/i/oauth2/authorize?${params.toString()}` });
  }

  async xAuthCallback(url, request) {
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (error) return new Response(`X authorization failed: ${error}`, { status: 400 });
    if (!state || !code) return new Response('Missing state/code', { status: 400 });
    const pending = await this.ctx.storage.get(`oauth/${state}`);
    if (!pending?.verifier || Date.now() - pending.createdAt > 10*60*1000) return new Response('Invalid or expired OAuth state', { status: 400 });
    const clientId = request.headers.get('x-x-client-id') || '';
    const clientSecret = request.headers.get('x-x-client-secret') || '';
    const redirectUri = request.headers.get('x-x-redirect-uri') || '';
    const body = new URLSearchParams({ code, grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectUri, code_verifier: pending.verifier });
    const headers = { 'content-type': 'application/x-www-form-urlencoded' };
    if (clientSecret) headers.authorization = basicAuth(clientId, clientSecret);
    const res = await fetch('https://api.x.com/2/oauth2/token', { method: 'POST', headers, body });
    const data = await res.json();
    if (!res.ok) return new Response(`Token exchange failed: ${res.status} ${JSON.stringify(data)}`, { status: 500 });
    await this.saveToken(data);
    await this.ctx.storage.delete(`oauth/${state}`);
    await this.audit('X_CONNECTED', {});
    return new Response(`<!doctype html><meta charset="utf-8"><title>X Connected</title><style>body{font-family:system-ui;padding:40px;background:#0b0d10;color:#fff}a{color:#7cc7ff}</style><h1>✓ X接続完了</h1><p>このタブを閉じて管理画面へ戻ってください。</p><a href="/">管理画面へ戻る</a>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  async saveToken(token) {
    const now = Date.now();
    const expiresIn = Number(token.expires_in || 0);
    const rec = { ...token, obtained_at: now, expires_at: expiresIn ? now + expiresIn*1000 : null };
    await this.ctx.storage.put('x-token', rec);
    return rec;
  }

  async refreshToken(record, request) {
    if (!record?.refresh_token) throw new Error('No refresh token available. Reconnect X.');
    const clientId = request.headers.get('x-x-client-id') || '';
    const clientSecret = request.headers.get('x-x-client-secret') || '';
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: record.refresh_token, client_id: clientId });
    const headers = { 'content-type':'application/x-www-form-urlencoded' };
    if (clientSecret) headers.authorization = basicAuth(clientId, clientSecret);
    const res = await fetch('https://api.x.com/2/oauth2/token', { method:'POST', headers, body });
    const data = await res.json();
    if (!res.ok) throw new Error(`X refresh failed: ${res.status} ${JSON.stringify(data)}`);
    if (!data.refresh_token) data.refresh_token = record.refresh_token;
    return this.saveToken(data);
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
      method:'POST', headers:{ authorization:`Bearer ${token}`, 'content-type':'application/json' }, body:JSON.stringify({ text })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`X create post failed: ${res.status} ${JSON.stringify(data)}`);
    return data;
  }

  async runScheduler(request) {
    const settings = await this.getSettings();
    if (!settings.postingEnabled) return json({ ok:true, postingEnabled:false, sent:0 });
    const posts = await this.listPosts();
    const due = posts.filter(p => p.status === 'APPROVED' && new Date(p.scheduledFor).getTime() <= Date.now());
    let sent = 0;
    for (const post of due) {
      try {
        const result = await this.createXPost(post.text, request);
        post.status='POSTED'; post.postedAt=new Date().toISOString(); post.xPostId=result?.data?.id||null; post.error=null;
        await this.putPost(post);
        await this.audit('POST_SENT_TO_X',{postId:post.id,xPostId:post.xPostId});
        sent++;
      } catch (err) {
        post.status='ERROR'; post.error=String(err?.message||err); await this.putPost(post);
        await this.audit('POST_ERROR',{postId:post.id,error:post.error});
      }
    }
    return json({ ok:true, postingEnabled:true, sent });
  }

  async seedWeek(request) {
    if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    const existing = await this.listPosts();
    if (existing.find(p=>p.seedBatch==='v1-week-01' && p.status!=='CANCELLED')) return json({ error:'WEEK_ALREADY_SEEDED' },409);
    const promptPosts = [
`ChatGPT、普通に質問するだけだともったいない。\n\nこれを最初に入れてみて👇\n「結論だけで終わらず、私の目的を推測して2手先まで考えて。足りない情報は仮定を明記して、まず使える案を出して」\n\n回答が“相談相手”から“秘書”っぽく変わる。`,
`ChatGPTに案を出してもらう時、これを最後に追加してみて👇\n\n「メリット・デメリットだけで終わらず、今の状況ならどれを選ぶべきか1つ決めて。理由と、判断が変わる条件も書いて」\n\n“選択肢を並べるだけ”がかなり減る。`,
`ChatGPTの文章がAIっぽい時はこれ👇\n\n「内容は変えず、AIっぽい言い回し・大げさな表現・不自然な箇条書きを減らして、実際に人が話すような自然な日本語に直して」\n\n投稿文やnoteの仕上げにかなり使える。`,
`仕事を丸投げする時の一言👇\n\n「追加質問だけで止まらず、安全に仮定できる部分は仮定して先に試作品を作って。最後に重要な確認点だけ聞いて」\n\nこれ入れると“質問ラッシュ”が減って前に進みやすい。`,
`ChatGPTに調査させるならこれを追加👇\n\n「最新情報が必要なものは公式・一次情報を優先して確認。確認できない内容は推測せず[要確認]と書いて」\n\n料金・API・規約みたいな変わりやすい情報で特に便利。`,
`アイデアを考えてもらう時はこれ👇\n\n「普通の案10個ではなく、実現性×収益性×差別化で評価して、上位3案だけ深掘りして」\n\n案の数より“使える案”が欲しい時におすすめ。`,
`ChatGPTを“厳しめの戦略担当”にするプロンプト👇\n\n「私に迎合しないで。今やらない方がいいことは明確に止めて、その理由と代わりに優先すべきことを教えて」\n\n褒めて終わるAIから結構変わる。`,
`何から手を付けるか迷った時👇\n\n「やることを、最優先／今日／今週／後回し／やらない、に分けて。目標への影響度が高い順に並べて」\n\n頭の中が散らかってる時にかなり楽。`,
`ChatGPTに“見落とし”を探させるプロンプト👇\n\n「この案が失敗するとしたら何が原因？ 今見えていないリスクを3つ、2手先まで考えて」\n\n新しい副業や企画を始める前に使える。`,
`SNS投稿を作る時はこれを追加👇\n\n「内容を説明するだけじゃなく、最初の1〜2行で続きを見たくなるフックを5案作ってから、一番強い案で完成させて」\n\n同じ内容でも入口がかなり変わる。`,
`長い文章を短くしたい時👇\n\n「情報を削るのではなく、重複・前置き・AIっぽい説明を削って、意味を保ったまま半分の長さにして」\n\nX、メール、説明文に便利。`,
`ChatGPTで勉強するならこれ👇\n\n「初心者向けに説明→具体例→実際に使う場面→最後に理解確認3問、の順で教えて」\n\n“読んで終わり”になりにくい。`,
`比較を頼む時のおすすめ👇\n\n「AとBを価格だけでなく、時間・難易度・リスク・将来性・撤退しやすさで比較して。最後に私ならどちらを選ぶべきか決めて」\n\n買い物でもサービス選びでも使える。`,
`ChatGPTに改善案を出させる時👇\n\n「全部変えず、結果に一番影響しそうな要素を1つだけ選んで次回テスト案を作って」\n\nSNSや広告の改善で“何が効いたか分からない”を減らせる。`,
`文章を自分らしくするなら👇\n\n「この文章の主張は維持して、完璧な専門家っぽくせず、実際に試している人の口調に直して。失敗や迷いも消しすぎないで」\n\n発信が急に人間っぽくなる。`,
`ChatGPTに会議させるプロンプト👇\n\n「戦略担当・顧客目線・批判役の3視点でこの案を評価して、最後に統合した結論を1つ出して」\n\n自分1人だと偏る企画に使える。`,
`副業アイデアを評価する時👇\n\n「初期費用／初売上までの速さ／利益率／継続性／競合／自分との相性を10点満点で評価して、合計より“致命的な弱点”を重視して」\n\n“面白そう”だけで始めるのを防げる。`,
`ChatGPTに作業手順を聞くなら👇\n\n「説明ではなく、今から実行する順番で番号を付けて。各工程で“終わった状態”も書いて」\n\nWeb設定とか初めての作業でかなり分かりやすい。`,
`投稿前の最終チェック👇\n\n「この投稿を、誤解／炎上／誇大表現／著作権／個人情報の5項目でチェック。問題があれば意味を変えず安全な表現に直して」\n\n公開前の確認用に保存推奨。`,
`ChatGPTの回答が浅い時👇\n\n「一般論ではなく、私の条件に当てはめて具体化して。判断に必要な条件が足りない時も質問だけで止まらず仮案を出して」\n\nこれだけでも回答の密度がかなり変わる。`,
`“次に何する？”までAIに決めてもらう👇\n\n「回答の最後に、今すぐやること1つと、その次の一手1つを必ず付けて」\n\nChatGPTを検索代わりじゃなく実行支援に変える一言。`
];
    const videoPosts = [
`AI動画って「何を書けばいいか分からない」で止まりがち。\nAI COACHで依頼内容を整理して、そのままAI COACH VIDEOで動画にする流れを作ってます。\n\nまずは“作りたい動画”を普通の言葉で入れるだけ。\nhttps://ai-coach-app.com/video/`,
`AI COACH VIDEOの使い方はシンプル。\n\n① 作りたい動画の内容を決める\n② AIで依頼文を整える\n③ 動画生成\n④ できた動画をSNSや広告に使う\n\nプロンプトを一から考えるのが苦手な人向けに作ってます。\nhttps://ai-coach-app.com/video/`,
`こんな使い方もできます👇\n\n・商品紹介\n・SNS広告\n・お店のPR\n・サービス説明\n・イメージ動画\n\n「動画編集できないから無理」を少しでも減らしたくてAI COACH VIDEOを作ってます。\nhttps://ai-coach-app.com/video/`,
`AIで動画を作る時、いきなり動画生成AIに文章を入れるより“何を見せたいか”を先に整理した方が作りやすい。\n\nAI COACH → 依頼文整理 → AI COACH VIDEO\nこの流れで使えるようにしてます。\nhttps://ai-coach-app.com/video/`,
`SNS用の短い動画を作りたい時は、まずこれだけ決めると楽。\n\n・誰向け？\n・何を見せる？\n・最後に何をしてほしい？\n\nAI COACH VIDEOは、この辺をAIに相談しながら動画にできるようにしてます。\nhttps://ai-coach-app.com/video/`,
`「AI動画って実際何に使うの？」\n\n例えば自分の商品を1つ見せるだけでも、\n通常の商品画像→短いPR動画\nにできる。\n\nEC、eBay、SNS投稿、お店の宣伝とか、使い道は結構ある。\nhttps://ai-coach-app.com/video/`,
`AI COACH VIDEOは、動画制作の知識がない人でも“こういう動画にしたい”から始められるように作ってます。\n\n完成されたサービスというより、私も実際に使いながら改良中。\n気になる人は触ってみてください👇\nhttps://ai-coach-app.com/video/`,
`動画広告を作るなら、最初から長い動画より「1メッセージだけ」の短い動画から試すのがおすすめ。\n\n商品1個\n↓\n魅力1個\n↓\nCTA1個\n\nAI COACH VIDEOでも、この形から試すと作りやすい。\nhttps://ai-coach-app.com/video/`,
`AI動画の使い方例。\n\n写真しかない商品でも、\n「高級感のある背景で商品を見せる短いPR動画」\nみたいに依頼して、SNS用素材を作る。\n\n“素材がない”時の選択肢としてAI動画はかなり面白い。\nhttps://ai-coach-app.com/video/`,
`AI COACH VIDEOを作った理由の1つ。\n\n動画生成AIって便利だけど、最初の「どう頼む？」が結構むずかしい。\nだからAIに相談して依頼内容を作って、そのまま動画にする流れにしました。\nhttps://ai-coach-app.com/video/`,
`TikTokやリールで毎回撮影するのが大変なら、AI動画を“全部置き換える”んじゃなく、間に差し込む素材として使う方法もある。\n\n実写＋AI動画＋テロップ。\nこの使い方はかなり現実的。\nhttps://ai-coach-app.com/video/`,
`AI動画を作る時のコツ。\n\n「かっこいい動画」だけじゃ弱い。\n\n場所／被写体／動き／カメラ／雰囲気\nまで決めるとかなり伝わりやすくなる。\n\nそこをAIと一緒に整理してから動画生成できます👇\nhttps://ai-coach-app.com/video/`,
`商品ページに動画が欲しいけど撮影環境がない。\nそんな時にAI動画を試す価値はあると思う。\n\nもちろん商品そのものを誤認させる表現はNG。\nでもイメージPR素材としてはかなり使い道がある。\nhttps://ai-coach-app.com/video/`,
`AI動画は“1本作って終わり”より、同じ商品で3パターン作って比較する方が面白い。\n\n・高級感\n・スピード感\n・シンプル\n\nどれが反応されるかSNSで試せる。\nhttps://ai-coach-app.com/video/`,
`動画を作りたいけど、編集ソフトの使い方から覚えるのは大変。\n\nAI COACH VIDEOは「何を作りたいか」を相談するところから、できるだけ簡単にしたくて作ってます。\nhttps://ai-coach-app.com/video/`,
`AI COACH VIDEOの使い道を増やしていきたい。\n\n今考えてるのは、\n商品PR／車・バイク／店舗／SNS広告／サービス説明。\n\n「こういう動画作れたら使う」ってアイデアがあれば普通に知りたい。\nhttps://ai-coach-app.com/video/`,
`AIで動画を作るなら、最初に“誰に見せるか”を決める。\n\n同じ商品でも、初心者向けとマニア向けでは見せ方が全然違う。\n\nAI COACHでそこを整理してからAI COACH VIDEOへ。\nhttps://ai-coach-app.com/video/`,
`サービス紹介って文字だけだと伝わりにくい。\nだからAI動画で「何ができるか」を数秒で見せる。\n\n自分のサービスでも実際にこの使い方を試してます。\nhttps://ai-coach-app.com/video/`,
`AI動画、最初から完璧な90秒を狙うより、短い素材を何本か作って組み合わせる方が試しやすい。\n\nまず短く作る→反応を見る→良ければ伸ばす。\nこの方が無駄が少ない。\nhttps://ai-coach-app.com/video/`,
`AI COACH VIDEOは「AI動画がすごい」で終わらせず、実際の仕事やSNSでどう使えるかを試していく予定。\n\n作った例もこれからどんどん出します。\nhttps://ai-coach-app.com/video/`,
`AI動画を作ってみたい人へ。\n難しいプロンプトを覚える前に、普通に「こういう動画が欲しい」とAIに相談するところからで大丈夫。\n\nその入口を簡単にしたのがAI COACH VIDEOです。\nhttps://ai-coach-app.com/video/`
];
    const slots=[{time:'08:00',type:'PROMPT'},{time:'11:00',type:'VIDEO'},{time:'14:00',type:'PROMPT'},{time:'17:00',type:'VIDEO'},{time:'20:00',type:'PROMPT'},{time:'22:30',type:'VIDEO'}];
    const dateInJst=(daysAhead)=>{const now=new Date();const jst=new Date(now.getTime()+9*60*60*1000);jst.setUTCDate(jst.getUTCDate()+daysAhead);return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth()+1).padStart(2,'0')}-${String(jst.getUTCDate()).padStart(2,'0')}`};
    const jstIso=(date,time)=>new Date(`${date}T${time}:00+09:00`).toISOString();
    let pi=0,vi=0; const created=[];
    for(let day=1;day<=7;day++){
      const date=dateInJst(day);
      for(const slot of slots){
        const category=slot.type; const text=category==='PROMPT'?promptPosts[pi++]:videoPosts[vi++];
        const post={id:`post_${Date.now()}_${crypto.randomUUID()}`,text,scheduledFor:jstIso(date,slot.time),madeWithAi:false,category,campaign:category==='PROMPT'?'ChatGPTコピペプロンプト':'AI COACH VIDEO',seedBatch:'v1-week-01',status:'DRAFT',approvedAt:null,postedAt:null,xPostId:null,error:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
        await this.putPost(post); created.push(post);
      }
    }
    await this.audit('WEEK_SEEDED',{batch:'v1-week-01',count:created.length});
    return json({created:created.length,posts:created},201);
  }
}
