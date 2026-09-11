import { cleanText, env, json, requireAdmin, roomHistoryMap } from './_side-lib.mjs';

function jstParts() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function automaticKeywords() {
  const { month, day } = jstParts();
  const generic = ['日用品', 'キッチン用品', '収納', '美容', '家電', '食品', 'スイーツ', 'ふるさと納税'];
  const seasonal = {
    1: ['福袋', '防寒', 'バレンタイン'],
    2: ['バレンタイン', '花粉対策', '新生活'],
    3: ['新生活', '卒業祝い', '花粉対策'],
    4: ['新生活', '母の日', 'UV対策'],
    5: ['母の日', '父の日', 'UV対策'],
    6: ['父の日', '梅雨対策', '夏準備'],
    7: ['暑さ対策', '夏休み', 'お中元'],
    8: ['暑さ対策', '防災', '秋準備'],
    9: ['敬老の日', '防災', '新米', '秋'],
    10: ['ハロウィン', '秋冬', '乾燥対策'],
    11: ['ブラックフライデー', '冬支度', 'クリスマス'],
    12: ['クリスマス', 'お歳暮', '年末年始']
  };
  const pool = [...(seasonal[month] || []), ...generic];
  const start = day % pool.length;
  const picked = [];
  for (let i = 0; i < pool.length && picked.length < 4; i += 1) {
    const value = pool[(start + i) % pool.length];
    if (!picked.includes(value)) picked.push(value);
  }
  return picked;
}

function scoreItem(item) {
  const reviews = Number(item.reviewCount || 0);
  const average = Number(item.reviewAverage || 0);
  const affiliateRate = Number(item.affiliateRate || 0);
  const pointRate = Number(item.pointRate || 1);
  const price = Number(item.itemPrice || 0);
  let score = 0;
  score += Math.min(38, Math.log10(reviews + 1) * 12);
  score += Math.min(38, average * 8);
  score += Math.min(12, affiliateRate * 2);
  score += Math.min(8, Math.max(0, pointRate - 1) * 2);
  if (price >= 1000 && price <= 15000) score += 7;
  else if (price > 15000 && price <= 30000) score += 4;
  if (Number(item.postageFlag) === 0) score += 3;
  if (Number(item.shopOfTheYearFlag) === 1) score += 3;
  return Math.round(score);
}

function makeComment(item, keyword) {
  const title = cleanText(item.itemName, 72);
  const catchcopy = cleanText(item.catchcopy, 70);
  const price = Number(item.itemPrice || 0);
  const reviews = Number(item.reviewCount || 0);
  const average = Number(item.reviewAverage || 0);
  const pointRate = Number(item.pointRate || 1);
  const parts = [];

  parts.push(`気になった「${title}」✨`);
  if (catchcopy && !title.includes(catchcopy)) parts.push(catchcopy);
  if (price > 0) parts.push(`価格は${price.toLocaleString('ja-JP')}円。`);
  if (reviews > 0 && average > 0) parts.push(`レビュー★${average.toFixed(1)}（${reviews.toLocaleString('ja-JP')}件）も参考になりそう。`);
  if (pointRate > 1) parts.push(`ポイント${pointRate}倍対象。`);
  parts.push('気になる人は楽天で詳細をチェックしてみてください。');

  const safeTag = String(keyword || 'おすすめ').replace(/[\s#＃]/g, '').slice(0, 20) || 'おすすめ';
  parts.push(`#楽天ROOM #楽天市場 #${safeTag} #お買い物メモ`);
  return parts.join('\n').slice(0, 480);
}

async function fetchKeyword(keyword, appId, accessKey, affiliateId) {
  const params = new URLSearchParams({
    applicationId: appId,
    keyword,
    format: 'json',
    formatVersion: '2',
    hits: '10',
    page: '1',
    sort: '-reviewCount',
    availability: '1',
    imageFlag: '1',
    hasReviewFlag: '1',
    minPrice: '800',
    elements: 'itemName,catchcopy,itemCode,itemPrice,itemUrl,affiliateUrl,mediumImageUrls,reviewCount,reviewAverage,affiliateRate,pointRate,postageFlag,shopOfTheYearFlag'
  });
  if (affiliateId) params.set('affiliateId', affiliateId);

  const res = await fetch(`https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701?${params.toString()}`, {
    headers: { accessKey }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`RAKUTEN_API_${res.status}:${data.error_description || data.error || 'UNKNOWN'}`);
  }
  return Array.isArray(data.items) ? data.items : [];
}

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const appId = env('RAKUTEN_APP_ID');
  const accessKey = env('RAKUTEN_ACCESS_KEY');
  const affiliateId = env('RAKUTEN_AFFILIATE_ID');
  if (!appId || !accessKey) {
    return json({
      error: 'RAKUTEN_API_NOT_CONFIGURED',
      required: ['RAKUTEN_APP_ID', 'RAKUTEN_ACCESS_KEY']
    }, 503);
  }

  const body = await req.json().catch(() => ({}));
  const custom = String(body.keyword || '').trim();
  const limit = Math.max(1, Math.min(10, Number(body.limit || 5)));
  const keywords = custom ? [custom] : automaticKeywords();
  const history = await roomHistoryMap();
  const deduped = new Map();
  const errors = [];

  for (const keyword of keywords) {
    try {
      const items = await fetchKeyword(keyword, appId, accessKey, affiliateId);
      for (const item of items) {
        if (!item?.itemCode || history.has(item.itemCode) || deduped.has(item.itemCode)) continue;
        deduped.set(item.itemCode, { ...item, keyword });
      }
    } catch (err) {
      errors.push({ keyword, error: String(err?.message || err) });
    }
  }

  const items = [...deduped.values()]
    .map((item) => ({
      itemCode: item.itemCode,
      itemName: cleanText(item.itemName, 180),
      catchcopy: cleanText(item.catchcopy, 140),
      itemPrice: Number(item.itemPrice || 0),
      itemUrl: item.affiliateUrl || item.itemUrl,
      rawItemUrl: item.itemUrl,
      imageUrl: Array.isArray(item.mediumImageUrls) ? (item.mediumImageUrls[0] || '') : '',
      reviewCount: Number(item.reviewCount || 0),
      reviewAverage: Number(item.reviewAverage || 0),
      affiliateRate: Number(item.affiliateRate || 0),
      pointRate: Number(item.pointRate || 1),
      keyword: item.keyword,
      score: scoreItem(item),
      comment: makeComment(item, item.keyword)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return json({
    ok: true,
    mode: custom ? 'keyword' : 'auto',
    keywords,
    affiliateConfigured: Boolean(affiliateId),
    items,
    errors
  });
};
