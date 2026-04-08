# BulkProvider Orders API

Vercel-hosted backend that fetches all orders from the last 90 days via BulkProvider Admin API v2, groups them by status, and calculates average processing time.

---

## 📁 Project Structure

```
orders-api/
├── api/
│   ├── orders.js          # GET /api/orders  — full order list + stats
│   └── orders/
│       └── stats.js       # GET /api/orders/stats — summary only (lightweight)
├── lib/
│   └── bulkprovider.js    # API helper, pagination, calculations
├── .env                   # Local env (never commit this)
├── .env.example           # Template
├── vercel.json            # Vercel config with CORS headers
└── package.json
```

---

## 🚀 Deploy to Vercel

### Step 1: Install Vercel CLI
```bash
npm install -g vercel
```

### Step 2: Login
```bash
vercel login
```

### Step 3: Deploy
```bash
cd orders-api
vercel --prod
```

### Step 4: Set Environment Variable in Vercel Dashboard
1. Go to **vercel.com → Your Project → Settings → Environment Variables**
2. Add:
   - **Name**: `BULKPROVIDER_API_KEY`
   - **Value**: `96fwbo1ptr0b9icjxnwzfht6qzs4jmkehkep121kmwo1t0ber1eqiak11fh3bkb4`
   - **Environment**: Production, Preview, Development

---

## 📡 API Endpoints

### 1. `GET /api/orders`
Returns all orders from last 90 days with per-order processing time.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `status` | string | Filter by status: `pending`, `in_progress`, `processing`, `completed`, `partial`, `canceled`, `error`, `fail` |

**Example:**
```
GET /api/orders
GET /api/orders?status=pending
GET /api/orders?status=completed
```

**Response:**
```json
{
  "success": true,
  "meta": {
    "period": "last_90_days",
    "generated_at": "2026-04-08T10:00:00.000Z",
    "total_orders": 1523,
    "filtered_by_status": null,
    "returned_orders": 1523,
    "overall_average_processing_time_seconds": 86400,
    "overall_average_processing_time_human": "1d"
  },
  "status_summary": {
    "pending":    { "count": 45,  "average_processing_time_seconds": 3600,  "average_processing_time_human": "1h" },
    "in_progress":{ "count": 120, "average_processing_time_seconds": 7200,  "average_processing_time_human": "2h" },
    "processing": { "count": 88,  "average_processing_time_seconds": 1800,  "average_processing_time_human": "30m" },
    "completed":  { "count": 980, "average_processing_time_seconds": 86400, "average_processing_time_human": "1d" },
    "partial":    { "count": 55,  "average_processing_time_seconds": 43200, "average_processing_time_human": "12h" },
    "canceled":   { "count": 200, "average_processing_time_seconds": 600,   "average_processing_time_human": "10m" },
    "error":      { "count": 20,  "average_processing_time_seconds": 300,   "average_processing_time_human": "5m" },
    "fail":       { "count": 15,  "average_processing_time_seconds": 120,   "average_processing_time_human": "2m" }
  },
  "orders": [
    {
      "id": 12345,
      "status": "completed",
      "user": "alex",
      "service_id": 455,
      "service_name": "Instagram Followers",
      "quantity": 1000,
      "remains": 0,
      "link": "https://instagram.com/example",
      "created": "2026-01-10 08:30:00",
      "created_timestamp": 1736498200,
      "last_update": "2026-01-11 08:30:00",
      "last_update_timestamp": 1736584600,
      "processing_time_seconds": 86400,
      "processing_time_human": "1d",
      "charge": { "value": "5.00", "currency_code": "USD" },
      "mode": "auto",
      "creation_type": "new_order_form",
      "provider": "provider.com"
    }
  ]
}
```

---

### 2. `GET /api/orders/stats`
Lightweight summary — no order list, just counts and averages.

**Example:**
```
GET /api/orders/stats
```

**Response:**
```json
{
  "success": true,
  "stats": {
    "period": "last_90_days",
    "generated_at": "2026-04-08T10:00:00.000Z",
    "total_orders": 1523,
    "overall_average_processing_time_seconds": 86400,
    "overall_average_processing_time_human": "1d",
    "by_status": {
      "pending":    { "count": 45,  "percentage": "2.95%", "average_processing_time_seconds": 3600,  "average_processing_time_human": "1h" },
      "completed":  { "count": 980, "percentage": "64.34%","average_processing_time_seconds": 86400, "average_processing_time_human": "1d" },
      "canceled":   { "count": 200, "percentage": "13.13%","average_processing_time_seconds": 600,   "average_processing_time_human": "10m" }
    }
  }
}
```

---

## ⚙️ How It Works

1. **Pagination**: Fetches up to 1000 orders per request, loops until all orders are retrieved.
2. **Rate Limiting**: Adds 250ms delay between paginated calls (API limit: 5 req/sec).
3. **Average Time**: Calculated as `last_update_timestamp - created_timestamp` per order, then averaged per status group.
4. **CORS**: All endpoints allow cross-origin requests for frontend use.

---

## 🔒 Security Note
- Never commit `.env` to git. Add `.env` to `.gitignore`.
- Always store the API key as a Vercel environment variable, not in code.
