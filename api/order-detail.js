// api/order-detail.js
// GET /api/order-detail?id=12345
// Returns single order detail — used for processing time calculation

const BASE_URL = "https://mothersmm.com/adminapi/v2";
const API_KEY  = process.env.BULKPROVIDER_API_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Order ID required.' });

  try {
    const upstreamRes = await fetch(
      `${BASE_URL}/orders/${id}`,
      {
        headers: {
          'X-Api-Key':    API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!upstreamRes.ok) {
      const txt = await upstreamRes.text();
      return res.status(upstreamRes.status).json({ error: txt });
    }

    const json = await upstreamRes.json();

    // Return same shape as old Netlify getOrderDetail function
    return res.status(200).json({
      success:       true,
      data:          json.data,
      error_code:    json.error_code,
      error_message: json.error_message,
    });

  } catch (err) {
    console.error('order-detail error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
