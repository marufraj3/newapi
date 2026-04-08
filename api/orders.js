import {
  fetchAllOrders,
  calculateAverageTime,
  formatDuration,
  groupByStatus,
} from "../lib/bulkprovider.js";

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  try {
    const { status: filterStatus } = req.query;
    const allOrders = await fetchAllOrders();
    const grouped = groupByStatus(allOrders);

    const allStatuses = ["pending","in_progress","processing","completed","partial","canceled","error","fail"];

    const statusSummary = {};
    for (const s of allStatuses) {
      const orders = grouped[s] || [];
      const avgSeconds = calculateAverageTime(orders);
      statusSummary[s] = {
        count: orders.length,
        average_processing_time_seconds: avgSeconds,
        average_processing_time_human: formatDuration(avgSeconds),
      };
    }

    const overallAvgSeconds = calculateAverageTime(allOrders);
    let orderList = filterStatus ? (grouped[filterStatus] || []) : allOrders;

    const orders = orderList.map((o) => ({
      id: o.id,
      status: o.status,
      user: o.user,
      service_id: o.service_id,
      service_name: o.service_name,
      quantity: o.quantity,
      remains: o.remains,
      link: o.link,
      created: o.created,
      created_timestamp: o.created_timestamp,
      last_update: o.last_update,
      last_update_timestamp: o.last_update_timestamp,
      processing_time_seconds: o.last_update_timestamp && o.created_timestamp
        ? o.last_update_timestamp - o.created_timestamp : null,
      processing_time_human: o.last_update_timestamp && o.created_timestamp
        ? formatDuration(o.last_update_timestamp - o.created_timestamp) : "N/A",
      charge: o.charge,
      mode: o.mode,
      creation_type: o.creation_type,
      provider: o.provider,
    }));

    return res.status(200).json({
      success: true,
      meta: {
        period: "last_90_days",
        generated_at: new Date().toISOString(),
        total_orders: allOrders.length,
        filtered_by_status: filterStatus || null,
        returned_orders: orders.length,
        overall_average_processing_time_seconds: overallAvgSeconds,
        overall_average_processing_time_human: formatDuration(overallAvgSeconds),
      },
      status_summary: statusSummary,
      orders,
    });
  } catch (err) {
    console.error("Orders API Error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
