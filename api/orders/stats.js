// api/orders/stats.js
// GET /api/orders/stats
// Returns only the summary stats (no order list) — lightweight endpoint

import {
  fetchAllOrders,
  calculateAverageTime,
  formatDuration,
  groupByStatus,
} from "../../lib/bulkprovider.js";

if (req.method === 'OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key');
  return res.status(200).end();
}

res.setHeader('Access-Control-Allow-Origin', '*');

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  try {
    const allOrders = await fetchAllOrders();
    const grouped = groupByStatus(allOrders);

    const allStatuses = [
      "pending",
      "in_progress",
      "processing",
      "completed",
      "partial",
      "canceled",
      "error",
      "fail",
    ];

    const statusBreakdown = {};
    for (const s of allStatuses) {
      const orders = grouped[s] || [];
      const avgSec = calculateAverageTime(orders);
      statusBreakdown[s] = {
        count: orders.length,
        percentage:
          allOrders.length > 0
            ? ((orders.length / allOrders.length) * 100).toFixed(2) + "%"
            : "0%",
        average_processing_time_seconds: avgSec,
        average_processing_time_human: formatDuration(avgSec),
      };
    }

    const overallAvgSec = calculateAverageTime(allOrders);

    return res.status(200).json({
      success: true,
      stats: {
        period: "last_90_days",
        generated_at: new Date().toISOString(),
        total_orders: allOrders.length,
        overall_average_processing_time_seconds: overallAvgSec,
        overall_average_processing_time_human: formatDuration(overallAvgSec),
        by_status: statusBreakdown,
      },
    });
  } catch (err) {
    console.error("Stats API Error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
