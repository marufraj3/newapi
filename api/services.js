// api/services.js
// GET /api/services?page=1
// GET /api/services?page=2&category=instagram
// GET /api/services?page=1&verified=true
// GET /api/services?id=14316
//
// Per page: 1000 orders fetched, service stats built from that page
// Frontend loads page by page and merges results

const BASE_URL = "https://mothersmm.com/adminapi/v2";
const API_KEY  = process.env.BULKPROVIDER_API_KEY;

async function fetchOrdersPage(offset, limit) {
  const now            = Math.floor(Date.now() / 1000);
  const ninetyDaysAgo = now - 90 * 24 * 60 * 60;

  const params = new URLSearchParams({
    created_from: ninetyDaysAgo,
    created_to:   now,
    limit,
    offset,
    sort: 'date-desc',
  });

  const res = await fetch(`${BASE_URL}/orders?${params}`, {
    headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
  });

  if (!res.ok) throw new Error(`Upstream error ${res.status}`);
  return res.json();
}

function buildServiceStats(orders) {
  const map = {};

  for (const order of orders) {
    const sid  = String(order.service_id || '');
    const name = order.service_name || 'Unknown';
    if (!sid) continue;

    if (!map[sid]) {
      map[sid] = {
        id: sid, name,
        completed: 0, canceled: 0, partial: 0,
        fail: 0, error: 0, total: 0, total_qty: 0,
      };
    }

    const s      = map[sid];
    s.total     += 1;
    s.total_qty += Number(order.quantity) || 0;

    const status = (order.status || '').toLowerCase();
    if      (status === 'completed') s.completed += 1;
    else if (status === 'canceled')  s.canceled  += 1;
    else if (status === 'partial')   s.partial   += 1;
    else if (status === 'fail')      s.fail      += 1;
    else if (status === 'error')     s.error     += 1;
  }

  return Object.values(map).map(s => {
    const completion_rate = s.total > 0
      ? parseFloat(((s.completed / s.total) * 100).toFixed(1)) : 0;
    const cancel_rate = s.total > 0
      ? parseFloat(((s.canceled / s.total) * 100).toFixed(1)) : 0;
    const fail_rate = s.total > 0
      ? parseFloat((((s.fail + s.error) / s.total) * 100).toFixed(1)) : 0;

    const score = Math.max(0, Math.min(100,
      Math.round(completion_rate - cancel_rate * 1.5 - fail_rate * 2)
    ));

    const verified = completion_rate >= 80 && s.total >= 5 && cancel_rate < 10;

    return {
      id: s.id, name: s.name,
      completion_rate, cancel_rate, fail_rate,
      score, verified,
      completed: s.completed, canceled: s.canceled,
      partial: s.partial, total: s.total, total_qty: s.total_qty,
    };
  }).sort((a, b) => b.score - a.score);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });

  try {
    const {
      page     = 1,
      category = '',
      verified = '',
      id       = '',
    } = req.query;

    const pageNum   = Math.max(1, parseInt(page));
    const limit     = 1000;
    const offset    = (pageNum - 1) * limit;

    // Fetch this page of orders from BulkProvider
    const data        = await fetchOrdersPage(offset, limit);
    const orders      = data?.data?.list || [];
    const totalOrders = data?.pagination?.total ?? 0;
    const totalPages  = Math.ceil(totalOrders / limit);

    // Build service stats from this page's orders
    let services = buildServiceStats(orders);

    // Apply filters
    if (id) {
      services = services.filter(s => String(s.id) === String(id));
    }

    if (category) {
      const words = category.toLowerCase().split(/[\s+,]+/).filter(Boolean);
      services = services.filter(s =>
        words.every(w => s.name.toLowerCase().includes(w))
      );
    }

    if (verified === 'true') {
      services = services.filter(s => s.verified);
    }

    const verified_count = services.filter(s => s.verified).length;

    return res.status(200).json({
      success:         true,
      period:          'last_90_days',
      generated_at:    new Date().toISOString(),
      orders_analyzed: orders.length,
      pagination: {
        current_page:  pageNum,
        per_page:      limit,
        total_orders:  totalOrders,
        total_pages:   totalPages,
        has_next:      pageNum < totalPages,
        has_prev:      pageNum > 1,
        next_page:     pageNum < totalPages ? pageNum + 1 : null,
        prev_page:     pageNum > 1 ? pageNum - 1 : null,
      },
      total:          services.length,
      verified_count,
      services,
    });

  } catch (err) {
    console.error('services error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
