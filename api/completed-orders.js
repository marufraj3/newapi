// api/completed-orders.js
// GET /api/completed-orders?limit=1000&offset=0&sort=date-desc&service_id=123
// Returns completed orders with pagination support

const BASE_URL = "https://mothersmm.com/adminapi/v2";
const API_KEY  = process.env.BULKPROVIDER_API_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });

  try {
    const {
      limit      = 1000,
      offset     = 0,
      sort       = 'date-desc',
      service_id = null,
    } = req.query;

    const now          = Math.floor(Date.now() / 1000);
    const ninetyDaysAgo = now - 90 * 24 * 60 * 60;

    const params = new URLSearchParams({
      order_status: 'completed',
      created_from: ninetyDaysAgo,
      created_to:   now,
      limit:        Math.min(Number(limit), 1000),
      offset:       Number(offset),
      sort,
    });

    if (service_id) {
      params.set('service_ids', service_id);
    }

    const upstreamRes = await fetch(
      `${BASE_URL}/orders?${params.toString()}`,
      {
        headers: {
          'X-Api-Key':     API_KEY,
          'Content-Type':  'application/json',
        },
      }
    );

    if (!upstreamRes.ok) {
      const txt = await upstreamRes.text();
      return res.status(upstreamRes.status).json({ error: txt });
    }

    const json = await upstreamRes.json();

    // Shape response same as old Netlify function so frontend works unchanged
    return res.status(200).json({
      success:     true,
      data:        json.data,
      pagination:  json.pagination,
      error_code:  json.error_code,
      error_message: json.error_message,
    });

  } catch (err) {
    console.error('completed-orders error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
