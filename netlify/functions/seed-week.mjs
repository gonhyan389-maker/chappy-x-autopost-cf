import { json, requireAdmin, id, putPost, appendAudit, listPosts } from './_lib.mjs';

const VIDEO_URL = 'https://ai-coach-app.com/video/';

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
`AI動画って「何を書けばいいか分からない」で止まりがち。\nAI COACHで依頼内容を整理して、そのままAI COACH VIDEOで動画にする流れを作ってます。\n\nまずは“作りたい動画”を普通の言葉で入れるだけ。\n${VIDEO_URL}`,
`AI COACH VIDEOの使い方はシンプル。\n\n① 作りたい動画の内容を決める\n② AIで依頼文を整える\n③ 動画生成\n④ できた動画をSNSや広告に使う\n\nプロンプトを一から考えるのが苦手な人向けに作ってます。\n${VIDEO_URL}`,
`こんな使い方もできます👇\n\n・商品紹介\n・SNS広告\n・お店のPR\n・サービス説明\n・イメージ動画\n\n「動画編集できないから無理」を少しでも減らしたくてAI COACH VIDEOを作ってます。\n${VIDEO_URL}`,
`AIで動画を作る時、いきなり動画生成AIに文章を入れるより“何を見せたいか”を先に整理した方が作りやすい。\n\nAI COACH → 依頼文整理 → AI COACH VIDEO\nこの流れで使えるようにしてます。\n${VIDEO_URL}`,
`SNS用の短い動画を作りたい時は、まずこれだけ決めると楽。\n\n・誰向け？\n・何を見せる？\n・最後に何をしてほしい？\n\nAI COACH VIDEOは、この辺をAIに相談しながら動画にできるようにしてます。\n${VIDEO_URL}`,
`「AI動画って実際何に使うの？」\n\n例えば自分の商品を1つ見せるだけでも、\n通常の商品画像→短いPR動画\nにできる。\n\nEC、eBay、SNS投稿、お店の宣伝とか、使い道は結構ある。\n${VIDEO_URL}`,
`AI COACH VIDEOは、動画制作の知識がない人でも“こういう動画にしたい”から始められるように作ってます。\n\n完成されたサービスというより、私も実際に使いながら改良中。\n気になる人は触ってみてください👇\n${VIDEO_URL}`,
`動画広告を作るなら、最初から長い動画より「1メッセージだけ」の短い動画から試すのがおすすめ。\n\n商品1個\n↓\n魅力1個\n↓\nCTA1個\n\nAI COACH VIDEOでも、この形から試すと作りやすい。\n${VIDEO_URL}`,
`AI動画の使い方例。\n\n写真しかない商品でも、\n「高級感のある背景で商品を見せる短いPR動画」\nみたいに依頼して、SNS用素材を作る。\n\n“素材がない”時の選択肢としてAI動画はかなり面白い。\n${VIDEO_URL}`,
`AI COACH VIDEOを作った理由の1つ。\n\n動画生成AIって便利だけど、最初の「どう頼む？」が結構むずかしい。\nだからAIに相談して依頼内容を作って、そのまま動画にする流れにしました。\n${VIDEO_URL}`,
`TikTokやリールで毎回撮影するのが大変なら、AI動画を“全部置き換える”んじゃなく、間に差し込む素材として使う方法もある。\n\n実写＋AI動画＋テロップ。\nこの使い方はかなり現実的。\n${VIDEO_URL}`,
`AI動画を作る時のコツ。\n\n「かっこいい動画」だけじゃ弱い。\n\n場所／被写体／動き／カメラ／雰囲気\nまで決めるとかなり伝わりやすくなる。\n\nそこをAIと一緒に整理してから動画生成できます👇\n${VIDEO_URL}`,
`商品ページに動画が欲しいけど撮影環境がない。\nそんな時にAI動画を試す価値はあると思う。\n\nもちろん商品そのものを誤認させる表現はNG。\nでもイメージPR素材としてはかなり使い道がある。\n${VIDEO_URL}`,
`AI動画は“1本作って終わり”より、同じ商品で3パターン作って比較する方が面白い。\n\n・高級感\n・スピード感\n・シンプル\n\nどれが反応されるかSNSで試せる。\n${VIDEO_URL}`,
`動画を作りたいけど、編集ソフトの使い方から覚えるのは大変。\n\nAI COACH VIDEOは「何を作りたいか」を相談するところから、できるだけ簡単にしたくて作ってます。\n${VIDEO_URL}`,
`AI COACH VIDEOの使い道を増やしていきたい。\n\n今考えてるのは、\n商品PR／車・バイク／店舗／SNS広告／サービス説明。\n\n「こういう動画作れたら使う」ってアイデアがあれば普通に知りたい。\n${VIDEO_URL}`,
`AIで動画を作るなら、最初に“誰に見せるか”を決める。\n\n同じ商品でも、初心者向けとマニア向けでは見せ方が全然違う。\n\nAI COACHでそこを整理してからAI COACH VIDEOへ。\n${VIDEO_URL}`,
`サービス紹介って文字だけだと伝わりにくい。\nだからAI動画で「何ができるか」を数秒で見せる。\n\n自分のサービスでも実際にこの使い方を試してます。\n${VIDEO_URL}`,
`AI動画、最初から完璧な90秒を狙うより、短い素材を何本か作って組み合わせる方が試しやすい。\n\nまず短く作る→反応を見る→良ければ伸ばす。\nこの方が無駄が少ない。\n${VIDEO_URL}`,
`AI COACH VIDEOは「AI動画がすごい」で終わらせず、実際の仕事やSNSでどう使えるかを試していく予定。\n\n作った例もこれからどんどん出します。\n${VIDEO_URL}`,
`AI動画を作ってみたい人へ。\n難しいプロンプトを覚える前に、普通に「こういう動画が欲しい」とAIに相談するところからで大丈夫。\n\nその入口を簡単にしたのがAI COACH VIDEOです。\n${VIDEO_URL}`
];

const slots = [
  { time: '08:00', type: 'PROMPT' },
  { time: '11:00', type: 'VIDEO' },
  { time: '14:00', type: 'PROMPT' },
  { time: '17:00', type: 'VIDEO' },
  { time: '20:00', type: 'PROMPT' },
  { time: '22:30', type: 'VIDEO' }
];

function jstIso(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00+09:00`).toISOString();
}

function dateInJst(daysAhead) {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  jst.setUTCDate(jst.getUTCDate() + daysAhead);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth()+1).padStart(2,'0')}-${String(jst.getUTCDate()).padStart(2,'0')}`;
}

export default async (req) => {
  const denied = requireAdmin(req); if (denied) return denied;
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const existing = await listPosts();
  const existingSeed = existing.find(p => p.seedBatch === 'v1-week-01' && p.status !== 'CANCELLED');
  if (existingSeed) return json({ error: 'WEEK_ALREADY_SEEDED' }, 409);

  let promptIndex = 0;
  let videoIndex = 0;
  const created = [];
  for (let day = 1; day <= 7; day++) {
    const date = dateInJst(day);
    for (const slot of slots) {
      const category = slot.type;
      const text = category === 'PROMPT' ? promptPosts[promptIndex++] : videoPosts[videoIndex++];
      const post = {
        id: id('post'),
        text,
        scheduledFor: jstIso(date, slot.time),
        madeWithAi: false,
        category,
        campaign: category === 'PROMPT' ? 'ChatGPTコピペプロンプト' : 'AI COACH VIDEO',
        seedBatch: 'v1-week-01',
        status: 'DRAFT',
        approvedAt: null,
        postedAt: null,
        xPostId: null,
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await putPost(post);
      created.push(post);
    }
  }
  await appendAudit('WEEK_SEEDED', { batch: 'v1-week-01', count: created.length });
  return json({ created: created.length, posts: created }, 201);
};
