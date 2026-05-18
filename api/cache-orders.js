// api/cache-orders.js
// GET /api/cache-orders        → cached orders return করে (12hr cache)
// GET /api/cache-orders?refresh=1 → force refresh করে
//
// Vercel KV (Redis) তে সব orders cache করে রাখে।
// Setup: vercel env add KV_REST_API_URL এবং KV_REST_API_TOKEN

const BASE_URL    = "https://mothersmm.com/adminapi/v2";
const API_KEY     = process.env.BULKPROVIDER_API_KEY;
const KV_URL      = process.env.KV_REST_API_URL;
const KV_TOKEN    = process.env.KV_REST_API_TOKEN;
const CACHE_KEY   = 'all_orders_cache';
const CACHE_TTL   = 12 * 60 * 60; // 12 hours in seconds

// ── KV helpers ───────────────────────────────────────────────────────────────
async function kvGet(key) {
  try {
    const res = await fetch(`${KV_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : null;
  } catch { return null; }
}

async function kvSet(key, value, ttl) {
  try {
    const res = await fetch(`${KV_URL}/set/${key}`, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${KV_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        value: JSON.stringify(value),
        ex:    ttl,
      }),
    });
    return res.ok;
  } catch { return false; }
}

async function kvTtl(key) {
  try {
    const res = await fetch(`${KV_URL}/ttl/${key}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    if (!res.ok) return -1;
    const data = await res.json();
    return data.result ?? -1;
  } catch { return -1; }
}

// ── Fetch all orders from BulkProvider ───────────────────────────────────────
async function fetchAllOrdersFromAPI() {
  const now            = Math.floor(Date.now() / 1000);
  const ninetyDaysAgo = now - 90 * 24 * 60 * 60;
  const limit          = 1000;

  // Step 1: Get first page to know total
  const firstParams = new URLSearchParams({
    created_from: ninetyDaysAgo,
    created_to:   now,
    limit,
    offset:       0,
    sort:         'date-desc',
  });

  const firstRes  = await fetch(`${BASE_URL}/orders?${firstParams}`, {
    headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
  });
  if (!firstRes.ok) throw new Error(`API error ${firstRes.status}`);

  const firstData  = await firstRes.json();
  const firstList  = firstData?.data?.list || [];
  const total      = firstData?.pagination?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  let allOrders = [...firstList];

  // Step 2: Fetch remaining pages — 5 at a time to respect rate limit
  const BATCH = 5;
  for (let p = 1; p < totalPages; p += BATCH) {
    const batch = [];
    for (let i = p; i < Math.min(p + BATCH, totalPages); i++) {
      batch.push(i);
    }

    const results = await Promise.allSettled(
      batch.map(async (pageNum) => {
        const params = new URLSearchParams({
          created_from: ninetyDaysAgo,
          created_to:   now,
          limit,
          offset:       pageNum * limit,
          sort:         'date-desc',
        });
        const res  = await fetch(`${BASE_URL}/orders?${params}`, {
          headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
        });
        if (!res.ok) return [];
        const data = await res.json();
        return data?.data?.list || [];
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') allOrders = allOrders.concat(r.value);
    }

    // Small delay between batches
    if (p + BATCH < totalPages) await new Promise(r => setTimeout(r, 300));
  }

  return { orders: allOrders, total_orders: total, total_pages: totalPages };
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });

  const forceRefresh = req.query.refresh === '1';

  try {
    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = await kvGet(CACHE_KEY);
      if (cached) {
        const ttl = await kvTtl(CACHE_KEY);
        const cachedAt  = cached.cached_at;
        const expiresAt = cachedAt + CACHE_TTL * 1000;

        return res.status(200).json({
          success:      true,
          source:       'cache',
          cached_at:    new Date(cachedAt).toISOString(),
          expires_at:   new Date(expiresAt).toISOString(),
          ttl_seconds:  ttl,
          total_orders: cached.total_orders,
          total_pages:  cached.total_pages,
          orders:       cached.orders,
        });
      }
    }

    // Cache miss or force refresh — fetch from API
    // Note: Vercel Pro 60s timeout needed for 100k+ orders
    // For Hobby plan, this may timeout — use /api/cache-orders?refresh=1 sparingly
    const { orders, total_orders, total_pages } = await fetchAllOrdersFromAPI();

    const cachePayload = {
      orders,
      total_orders,
      total_pages,
      cached_at: Date.now(),
    };

    // Store in KV cache for 12 hours
    await kvSet(CACHE_KEY, cachePayload, CACHE_TTL);

    return res.status(200).json({
      success:      true,
      source:       'fresh',
      cached_at:    new Date(cachePayload.cached_at).toISOString(),
      expires_at:   new Date(cachePayload.cached_at + CACHE_TTL * 1000).toISOString(),
      ttl_seconds:  CACHE_TTL,
      total_orders,
      total_pages,
      orders,
    });

  } catch (err) {
    console.error('cache-orders error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
