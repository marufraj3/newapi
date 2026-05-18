// api/analytics.js
const BASE_URL  = "https://mothersmm.com/adminapi/v2";
const API_KEY   = process.env.BULKPROVIDER_API_KEY;
const KV_URL    = process.env.KV_REST_API_URL;
const KV_TOKEN  = process.env.KV_REST_API_TOKEN;
const CACHE_KEY = 'analytics_v3'; // নতুন ক্যাশ কী (পুরনো ভুল ডাটা বাদ দেওয়ার জন্য)
const CACHE_TTL = 24 * 60 * 60;  // 24 hours (কোডে লজিক দিয়ে 12 ঘণ্টা কন্ট্রোল করব)

// KV Helpers
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

// ── Fetch all orders with Correct Pagination ───────────────────────────────
async function fetchAllOrders() {
  const now            = Math.floor(Date.now() / 1000);
  const ninetyDaysAgo = now - 90 * 24 * 60 * 60;
  const limit          = 1000; // নিরাপদ লিমিট (১০০০-এর বেশি দিলে ৪০০ এরর আসতে পারে)

  // Page 0 → প্রথম ১০,০০০ ডাটা এবং মোট পেজ জানা
  const firstRes = await fetch(`${BASE_URL}/orders?` + new URLSearchParams({
    created_from: ninetyDaysAgo, created_to: now, limit, offset: 0, sort: 'date-desc',
  }), { headers: { 'X-Api-Key': API_KEY } });

  if (!firstRes.ok) {
    const errText = await firstRes.text(); 
    throw new Error(`API Error: ${firstRes.status} - ${errText}`);
  }
  
  const firstData  = await firstRes.json();
  const total      = firstData?.pagination?.total ?? 0;
  const totalPages = Math.ceil(total / limit);
  let   allOrders  = firstData?.data?.list || [];

  // Remaining pages — 3 at a time (Rate limit safe)
  const BATCH = 3;
  for (let page = 1; page < totalPages; page += BATCH) {
    const batch = Array.from({ length: Math.min(BATCH, totalPages - page) }, (_, i) => page + i);
    
    const results = await Promise.allSettled(
      batch.map(p =>
        fetch(`${BASE_URL}/orders?` + new URLSearchParams({
          created_from: ninetyDaysAgo, created_to: now,
          limit, offset: p * limit, sort: 'date-desc',
        }), { headers: { 'X-Api-Key': API_KEY } })
        .then(r => r.json())
        .then(d => d?.data?.list || [])
      )
    );
    
    for (const r of results) {
      if (r.status === 'fulfilled') allOrders = allOrders.concat(r.value);
    }
    await new Promise(r => setTimeout(r, 500)); // 500ms delay to prevent rate limit
  }

  return { orders: allOrders, total_orders: total };
}

// ── Build Stats ───────────────────────────────────────────────────────────────
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

    if (!svcMap[sid]) svcMap[sid] = {
      sid, name, orders: [], total: 0, total_qty: 0,
      completed: 0, in_progress: 0, processing: 0, canceled: 0
    };
    
    svcMap[sid].orders.push(o);
    svcMap[sid].total++;
    svcMap[sid].total_qty += qty;
    if (svcMap[sid][group] !== undefined) svcMap[sid][group]++;
  }

  const maxC = Math.max(...Object.values(svcMap).map(s => s.completed), 1);
  const maxQ = Math.max(...Object.values(svcMap).map(s => s.total_qty), 1);

  const services = Object.values(svcMap).map(s => {
    const t = s.total;
    s.completion_rate  = t > 0 ? +(s.completed   / t * 100).toFixed(1) : 0;
    s.in_progress_rate = t > 0 ? +(s.in_progress  / t * 100).toFixed(1) : 0;
    s.processing_rate  = t > 0 ? +(s.processing   / t * 100).toFixed(1) : 0;
    s.canceled_rate    = t > 0 ? +(s.canceled      / t * 100).toFixed(1) : 0;

    const recent = s.orders.sort((a, b) => (b.created_timestamp || 0) - (a.created_timestamp || 0)).slice(0, 10);
    const recentHasProcessing = recent.some(o => (o.status || '').toLowerCase().trim() === 'processing');

    s.score = Math.round(
      (s.completion_rate / 100) * 70 +
      (s.completed / maxC) * 20 +
      (s.total_qty / maxQ) * 10
    );

    s.verified = s.completion_rate >= 80 && s.processing_rate <= 15 && !recentHasProcessing;
    
    delete s.orders; // Save space in KV
    return s;
  }).sort((a, b) => b.score - a.score);

  return { statusMap, services };
}

// ── Handler with 12-hour Smart Logic ─────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const forceRefresh = req.query.refresh === '1';

  if (!forceRefresh) {
    const cached = await kvGet(CACHE_KEY);
    
    if (cached) {
      const cachedTime = new Date(cached.cached_at).getTime();
      const twelveHoursInMs = 12 * 60 * 60 * 1000;
      const isExpired = (Date.now() - cachedTime) > twelveHoursInMs;

      // ডাটা ১২ ঘণ্টার কম পুরনো হলে সরাসরি ক্যাশ থেকে দিয়ে দিবে (খুব ফাস্ট)
      if (!isExpired) {
        return res.status(200).json({ source: 'cache', ...cached });
      }
    }
  }

  // ১২ ঘণ্টা পার হয়ে গেলে বা ?refresh=1 হলে নতুন ডাটা ফেচ করবে
  try {
    const { orders, total_orders } = await fetchAllOrders();
    const { statusMap, services } = buildStats(orders);

    const payload = {
      cached_at: new Date().toISOString(),
      total_orders,
      status_map: statusMap,
      services
    };

    await kvSet(CACHE_KEY, payload, CACHE_TTL);
    return res.status(200).json({ source: 'fresh', ...payload });

  } catch (err) {
    console.error('Analytics error:', err.message);
    
    // নতুন ডাটা ফেচ করতে এরর আসলে, পুরনো ক্যাশ ডাটা যদি থাকে তাহলে সেটাই দেখাবে
    const cached = await kvGet(CACHE_KEY);
    if (cached) return res.status(200).json({ source: 'cache-fallback', ...cached });
    
    return res.status(500).json({ error: err.message });
  }
}
