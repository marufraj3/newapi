// api/cron-refresh.js
import { fetchAllOrders, buildStats, kvSet } from './analytics.js'; // যদি একই ফাইলে রাখেন তাহলে এই লাইন লাগবে না

const CACHE_KEY = 'analytics_v1';
const CACHE_TTL = 12 * 60 * 60; // 12 hours

export default async function handler(req, res) {
  // Vercel cron এর secret verify
  const cronSecret = req.headers['authorization'];
  if (cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('Cron job started: Fetching fresh analytics...');
    
    // সরাসরি ডাটা ফেচ করুন, অন্য API কে কল করবেন না
    const { orders, total_orders, total_pages } = await fetchAllOrders();
    const { statusMap, services } = buildStats(orders);

    const now = Date.now();
    const payload = {
      cached_at: new Date(now).toISOString(),
      expires_at: new Date(now + CACHE_TTL * 1000).toISOString(),
      total_orders,
      total_pages,
      status_map: statusMap,
      services,
    };

    // KV তে ক্যাশ করে রাখুন
    await kvSet(CACHE_KEY, payload, CACHE_TTL);

    console.log(`Cron job success: Cached ${total_orders} orders.`);

    return res.status(200).json({
      ok: true,
      refreshed_at: new Date().toISOString(),
      total_orders: total_orders,
      services_count: services.length,
    });

  } catch (err) {
    console.error('Cron refresh error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
