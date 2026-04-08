// lib/bulkprovider.js
// BulkProvider Admin API v2 helper

const BASE_URL = "https://bulkprovider.com/adminapi/v2";
const API_KEY = process.env.BULKPROVIDER_API_KEY;

/**
 * Generic fetch wrapper for BulkProvider API
 */
async function apiFetch(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "X-Api-Key": API_KEY,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`API error ${res.status}: ${errorText}`);
  }

  return res.json();
}

/**
 * Fetch all orders for last 90 days with pagination
 * Handles all statuses: pending, in_progress, processing, completed, partial, canceled, error, fail
 */
async function fetchAllOrders() {
  const now = Math.floor(Date.now() / 1000);
  const ninetyDaysAgo = now - 90 * 24 * 60 * 60;

  let allOrders = [];
  let offset = 0;
  const limit = 1000; // max per request

  while (true) {
    const params = new URLSearchParams({
      created_from: ninetyDaysAgo,
      created_to: now,
      limit,
      offset,
      sort: "date-desc",
    });

    const data = await apiFetch(`/orders?${params.toString()}`);

    if (!data?.data?.list || data.data.list.length === 0) {
      break;
    }

    allOrders = allOrders.concat(data.data.list);

    // Check if there are more pages
    const total = data.pagination?.total ?? data.data.count ?? 0;
    offset += limit;

    if (offset >= total || data.data.list.length < limit) {
      break;
    }

    // Rate limit: 5 req/sec — add small delay between paginated calls
    await new Promise((r) => setTimeout(r, 250));
  }

  return allOrders;
}

/**
 * Calculate average processing time in seconds
 * from created_timestamp to last_update_timestamp
 */
function calculateAverageTime(orders) {
  const validOrders = orders.filter(
    (o) =>
      o.created_timestamp &&
      o.last_update_timestamp &&
      o.last_update_timestamp > o.created_timestamp
  );

  if (validOrders.length === 0) return null;

  const totalSeconds = validOrders.reduce((sum, o) => {
    return sum + (o.last_update_timestamp - o.created_timestamp);
  }, 0);

  return Math.round(totalSeconds / validOrders.length);
}

/**
 * Format seconds into human-readable string
 */
function formatDuration(seconds) {
  if (seconds === null) return "N/A";
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

/**
 * Group orders by status
 */
function groupByStatus(orders) {
  return orders.reduce((acc, order) => {
    const status = order.status || "unknown";
    if (!acc[status]) acc[status] = [];
    acc[status].push(order);
    return acc;
  }, {});
}

module.exports = {
  apiFetch,
  fetchAllOrders,
  calculateAverageTime,
  formatDuration,
  groupByStatus,
};
