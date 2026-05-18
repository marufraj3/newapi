// api/analytics.js
// GET /api/analytics          → cached data return করে
// GET /api/analytics?refresh=1 → force refresh (admin only)
//
// Vercel KV তে সব orders cache করে রাখে 12 ঘণ্টার জন্য।
// সব user এর জন্য একই cache — একবার load হলে সবাই fast পাবে।

const BASE_URL  = "https://mothersmm.com/adminapi/v2";
const API_KEY   = process.env.BULKPROVIDER_API_KEY;
const KV_URL    = process.env.KV_REST_API_URL;
const KV_TOKEN  = process.env.KV_REST_API_TOKEN;
const CACHE_KEY = 'analytics_v1';
const CACHE_TTL = 12 * 60 * 60; // 12 hours (seconds)

// ── Vercel KV helpers ─────────────────────────────────────────────────────────
async function kvGet(key) {
  try {
    const res = await fetch(`${KV_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    if (!res.ok) return null;
    const { result } = await res.json();
    return result ? JSON.parse(result) : null;
  } catch { return null; }
}

async function kvSet(key, value, ttl) {
  try {
    await fetch(`${KV_URL}/set/${key}?ex=${ttl}`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(JSON.stringify(value)),
    });
  } catch (e) { console.error('KV set error:', e.message); }
}

// ── Fetch all orders from BulkProvider ───────────────────────────────────────
async function fetchAllOrders() {
  const now            = Math.floor(Date.now() / 1000);
  const ninetyDaysAgo = now - 90 * 24 * 60 * 60;
  const limit          = 1000;

  // Page 1 → total জানো
  const firstRes = await fetch(`${BASE_URL}/orders?` + new URLSearchParams({
    created_from: ninetyDaysAgo, created_to: now, limit, offset: 0, sort: 'date-desc',
  }), { headers: { 'X-Api-Key': API_KEY } });

  if (!firstRes.ok) throw new Error(`BulkProvider error: ${firstRes.status}`);
  const firstData  = await firstRes.json();
  const total      = firstData?.pagination?.total ?? 0;
  const totalPages = Math.ceil(total / limit);
  let   allOrders  = firstData?.data?.list || [];

  // Remaining pages — 5 at a time (rate limit safe)
  const BATCH = 5;
  for (let p = 1; p < totalPages; p += BATCH) {
    const batch = Array.from({ length: Math.min(BATCH, totalPages - p) }, (_, i) => p + i);
    const results = await Promise.allSettled(
      batch.map(page =>
        fetch(`${BASE_URL}/orders?` + new URLSearchParams({
          created_from: ninetyDaysAgo, created_to: now,
          limit, offset: page * limit, sort: 'date-desc',
        }), { headers: { 'X-Api-Key': API_KEY } })
        .then(r => r.json())
        .then(d => d?.data?.list || [])
      )
    );
    for (const r of results) {
      if (r.status === 'fulfilled') allOrders = allOrders.concat(r.value);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  return { orders: allOrders, total_orders: total, total_pages: totalPages };
}

// ── Build service stats ───────────────────────────────────────────────────────
function buildStats(orders) {
  // Status breakdown
  const statusMap = {};
  for (const o of orders) {
    const s = (o.status || 'unknown').toLowerCase();
    statusMap[s] = (statusMap[s] || 0) + 1;
  }

  // Service map
  const svcMap = {};
  for (const o of orders) {
    const sid  = String(o.service_id || 'unknown');
    const name = o.service_name || 'Unknown';
    const s    = (o.status || '').toLowerCase();
    const qty  = parseInt(o.quantity) || 0;

    if (!svcMap[sid]) svcMap[sid] = {
      sid, name, total: 0, total_qty: 0,
      completed: 0, in_progress: 0, processing: 0, canceled: 0,
      recent_statuses: [],
    };

    svcMap[sid].total++;
    svcMap[sid].total_qty += qty;

    if (s === 'completed')                                              svcMap[sid].completed++;
    else if (s === 'in_progress' || s === 'pending')                   svcMap[sid].in_progress++;
    else if (s === 'processing')                                        svcMap[sid].processing++;
    else if (['partial','canceled','error','fail','refunded'].includes(s)) svcMap[sid].canceled++;

    // Keep last 10 statuses for recent check
    if (svcMap[sid].recent_statuses.length < 10) {
      svcMap[sid].recent_statuses.push({ status: s, ts: o.created_timestamp || 0 });
    }
  }

  const maxC = Math.max(...Object.values(svcMap).map(s => s.completed), 1);
  const maxQ = Math.max(...Object.values(svcMap).map(s => s.total_qty), 1);

  const services = Object.values(svcMap).map(s => {
    const t = s.total;
    const completion_rate  = t > 0 ? +(s.completed    / t * 100).toFixed(1) : 0;
    const in_progress_rate = t > 0 ? +(s.in_progress  / t * 100).toFixed(1) : 0;
    const processing_rate  = t > 0 ? +(s.processing   / t * 100).toFixed(1) : 0;
    const canceled_rate    = t > 0 ? +(s.canceled      / t * 100).toFixed(1) : 0;

    const recentProcessing = s.recent_statuses.some(r => r.status === 'processing');
    const score = Math.round(
      (completion_rate / 100) * 70 +
      (s.completed / maxC)    * 20 +
      (s.total_qty / maxQ)    * 10
    );
    const verified = completion_rate >= 80 && processing_rate <= 15 && !recentProcessing;

    return {
      sid: s.sid, name: s.name,
      total: s.total, total_qty: s.total_qty,
      completed: s.completed, in_progress: s.in_progress,
      processing: s.processing, canceled: s.canceled,
      completion_rate, in_progress_rate, processing_rate, canceled_rate,
      score, verified,
    };
  }).sort((a, b) => b.score - a.score);

  return { statusMap, services };
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const forceRefresh = req.query.refresh === '1';

  // 1. Cache check
  if (!forceRefresh) {
    const cached = await kvGet(CACHE_KEY);
    if (cached) {
      return res.status(200).json({
        source:      'cache',
        cached_at:   cached.cached_at,
        expires_at:  cached.expires_at,
        total_orders: cached.total_orders,
        total_pages:  cached.total_pages,
        status_map:   cached.status_map,
        services:     cached.services,
      });
    }
  }

  // 2. Fresh fetch — এই endpoint টা background এ call করতে হবে
  // Vercel Hobby: 10s timeout, Pro: 60s
  // 100k orders এর জন্য Pro plan দরকার
  try {
    const { orders, total_orders, total_pages } = await fetchAllOrders();
    const { statusMap, services } = buildStats(orders);

    const now       = Date.now();
    const payload   = {
      cached_at:    new Date(now).toISOString(),
      expires_at:   new Date(now + CACHE_TTL * 1000).toISOString(),
      total_orders,
      total_pages,
      status_map:   statusMap,
      services,
    };

    await kvSet(CACHE_KEY, payload, CACHE_TTL);

    return res.status(200).json({ source: 'fresh', ...payload });

  } catch (err) {
    console.error('analytics error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
