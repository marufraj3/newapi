// api/orders.js
// GET /api/orders?page=1&limit=1000&status=completed&sort=date-desc

const BASE_URL = "https://mothersmm.com/adminapi/v2";
const API_KEY  = process.env.BULKPROVIDER_API_KEY;

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "N/A";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(" ");
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });

  try {
    const {
      page         = 1,
      limit        = 1000,
      status       = '',
      sort         = 'date-desc',
      service_ids  = '',
      user         = '',
    } = req.query;

    const pageNum    = Math.max(1, parseInt(page));
    const limitNum   = Math.min(1000, Math.max(1, parseInt(limit)));
    const offset     = (pageNum - 1) * limitNum;

    const now            = Math.floor(Date.now() / 1000);
    const ninetyDaysAgo = now - 90 * 24 * 60 * 60;

    const params = new URLSearchParams({
      created_from: ninetyDaysAgo,
      created_to:   now,
      limit:        limitNum,
      offset,
      sort,
    });

    if (status)      params.set('order_status', status);
    if (service_ids) params.set('service_ids', service_ids);
    if (user)        params.set('user', user);

    const upstreamRes = await fetch(
      `${BASE_URL}/orders?${params.toString()}`,
      { headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' } }
    );

    if (!upstreamRes.ok) {
      const txt = await upstreamRes.text();
      return res.status(upstreamRes.status).json({ error: txt });
    }

    const json       = await upstreamRes.json();
    const list       = json?.data?.list || [];
    const totalCount = json?.pagination?.total ?? json?.data?.count ?? 0;
    const totalPages = Math.ceil(totalCount / limitNum);

    const orders = list.map(o => ({
      id:                    o.id,
      status:                o.status,
      user:                  o.user,
      service_id:            o.service_id,
      service_name:          o.service_name,
      quantity:              o.quantity,
      remains:               o.remains,
      link:                  o.link,
      created:               o.created,
      created_timestamp:     o.created_timestamp,
      last_update:           o.last_update,
      last_update_timestamp: o.last_update_timestamp,
      processing_time_seconds:
        o.last_update_timestamp && o.created_timestamp
          ? o.last_update_timestamp - o.created_timestamp
          : null,
      processing_time_human:
        o.last_update_timestamp && o.created_timestamp
          ? formatDuration(o.last_update_timestamp - o.created_timestamp)
          : "N/A",
      charge:        o.charge,
      mode:          o.mode,
      creation_type: o.creation_type,
      provider:      o.provider,
    }));

    return res.status(200).json({
      success: true,
      pagination: {
        current_page: pageNum,
        per_page:     limitNum,
        total_orders: totalCount,
        total_pages:  totalPages,
        has_next:     pageNum < totalPages,
        has_prev:     pageNum > 1,
        next_page:    pageNum < totalPages ? pageNum + 1 : null,
        prev_page:    pageNum > 1 ? pageNum - 1 : null,
      },
      filters: {
        status:      status || 'all',
        sort,
        service_ids: service_ids || null,
        user:        user || null,
        period:      'last_90_days',
      },
      orders,
    });

  } catch (err) {
    console.error('orders error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
