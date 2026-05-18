// api/analytics.js
const BASE_URL  = "https://mothersmm.com/adminapi/v2";
const API_KEY   = process.env.BULKPROVIDER_API_KEY;
const KV_URL    = process.env.KV_REST_API_URL;
const KV_TOKEN  = process.env.KV_REST_API_TOKEN;
const CACHE_KEY = 'analytics_v4'; 
const CACHE_TTL = 12 * 60 * 60;

async function kvGet(key) {
  try {
    const res = await fetch(`${KV_URL}/get/${key}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
    if (!res.ok) return null;
    const { result } = await res.json();
    return result ? JSON.parse(result) : null;
  } catch { return null; }
}

async function kvSet(key, value, ttl) {
  try {
    await fetch(`${KV_URL}/set/${key}?ex=${ttl}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.stringify(value)),
    });
  } catch (e) { console.error('KV set error:', e.message); }
}

async function fetchAllOrders() {
  const now = Math.floor(Date.now() / 1000);
  const ninetyDaysAgo = now - 90 * 24 * 60 * 60;
  const limit = 1000;
  let allOrders = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    try {
      const res = await fetch(`${BASE_URL}/orders?` + new URLSearchParams({
        created_from: ninetyDaysAgo, created_to: now, limit, offset, sort: 'date-desc',
      }), { headers: { 'X-Api-Key': API_KEY } });

      if (!res.ok) break;
      const data = await res.json();
      const orders = data?.data?.list || [];
      
      if (orders.length > 0) {
        allOrders = allOrders.concat(orders);
        offset += orders.length;
        await new Promise(r => setTimeout(r, 400));
      } else {
        hasMore = false;
      }
    } catch (err) {
      break;
    }
  }
  return allOrders;
}

function buildStats(orders) {
  const statusMap = { completed: 0, in_progress: 0, processing: 0, canceled: 0 };
  const svcMap = {};

  for (const o of orders) {
    const rawStatus = (o.status || '').toLowerCase().trim();
    let group = 'other';
    if (rawStatus === 'completed') group = 'completed';
    else if (rawStatus === 'in_progress' || rawStatus === 'pending') group = 'in_progress';
    else if (rawStatus === 'processing') group = 'processing';
    else if (['partial','canceled','error','fail','refunded'].includes(rawStatus)) group = 'canceled';

    if (statusMap[group] !== undefined) statusMap[group]++;

    const sid = String(o.service_id ?? 'unknown');
    const name = o.service_name ?? 'Unknown';
    const qty = parseInt(o.quantity) || 0;

    if (!svcMap[sid]) svcMap[sid] = { sid, name, total: 0, total_qty: 0, completed: 0, in_progress: 0, processing: 0, canceled: 0 };
    svcMap[sid].total++;
    svcMap[sid].total_qty += qty;
    if (svcMap[sid][group] !== undefined) svcMap[sid][group]++;
  }

  const maxC = Math.max(...Object.values(svcMap).map(s => s.completed), 1);
  const maxQ = Math.max(...Object.values(svcMap).map(s => s.total_qty), 1);

  const services = Object.values(svcMap).map(s => {
    const t = s.total;
    s.completion_rate = t > 0 ? +(s.completed / t * 100).toFixed(1) : 0;
    s.in_progress_rate = t > 0 ? +(s.in_progress / t * 100).toFixed(1) : 0;
    s.processing_rate = t > 0 ? +(s.processing / t * 100).toFixed(1) : 0;
    s.canceled_rate = t > 0 ? +(s.canceled / t * 100).toFixed(1) : 0;
    s.score = Math.round((s.completion_rate / 100) * 70 + (s.completed / maxC) * 20 + (s.total_qty / maxQ) * 10);
    s.verified = s.completion_rate >= 80 && s.processing_rate <= 15;
    return s;
  }).sort((a, b) => b.score - a.score);

  return { statusMap, services };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ১. ক্যাশ চেক করা (যদি থাকে সাথে সাথে দিয়ে দেবে)
  const cached = await kvGet(CACHE_KEY);
  if (cached) {
    const cachedTime = new Date(cached.cached_at).getTime();
    const isExpired = (Date.now() - cachedTime) > 12 * 60 * 60 * 1000;
    if (!isExpired || req.query.refresh !== '1') {
      return res.status(200).json({ source: 'cache', ...cached });
    }
  }

  // ২. ক্যাশ না থাকলে Streaming শুরু (Vercel টাইমআউট এড়ানোর ট্রিক)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    sendEvent({ status: 'fetching', message: 'ডাটা লোড হচ্ছে, অপেক্ষা করুন...' });
    
    const orders = await fetchAllOrders();
    sendEvent({ status: 'processing', message: `${orders.length} অর্ডার প্রসেস হচ্ছে...` });

    const { statusMap, services } = buildStats(orders);
    const payload = {
      cached_at: new Date().toISOString(),
      total_orders: orders.length,
      status_map: statusMap,
      services
    };

    await kvSet(CACHE_KEY, payload, CACHE_TTL);

    // ফাইনাল ডাটা পাঠিয়ে স্ট্রিম ক্লোজ করা
    sendEvent({ status: 'done', data: { source: 'fresh', ...payload } });
    res.end();

  } catch (err) {
    sendEvent({ status: 'error', message: err.message });
    res.end();
  }
}
