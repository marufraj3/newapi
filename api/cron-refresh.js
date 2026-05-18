// api/cron-refresh.js
// Vercel Cron — প্রতি 12 ঘণ্টায় একবার analytics cache refresh করে
// vercel.json এ cron config যোগ করতে হবে (নিচে দেওয়া আছে)

export default async function handler(req, res) {
  // Vercel cron এর secret verify
  const cronSecret = req.headers['authorization'];
  if (cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // analytics endpoint কে force refresh করো
    const base = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://newapi-gamma-five.vercel.app';

    const res2 = await fetch(`${base}/api/analytics?refresh=1`, {
      signal: AbortSignal.timeout(55000), // 55s (Vercel cron max 60s)
    });

    if (!res2.ok) throw new Error(`Analytics refresh failed: ${res2.status}`);
    const data = await res2.json();

    return res.status(200).json({
      ok:           true,
      refreshed_at: new Date().toISOString(),
      total_orders: data.total_orders,
      services:     data.services?.length,
    });

  } catch (err) {
    console.error('Cron refresh error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
