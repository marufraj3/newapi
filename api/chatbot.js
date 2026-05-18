// api/chatbot.js
// এটি সরাসরি BulkProvider API থেকে ডাটা ফেচ করে, তাই KV ক্যাশের দরকার নেই

const BASE_URL = "https://mothersmm.com/adminapi/v2";
const API_KEY  = process.env.BULKPROVIDER_API_KEY;

async function fetchOrdersForService(serviceId) {
  const now = Math.floor(Date.now() / 1000);
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60; // স্পিডের জন্য শেষ ৩০ দিনের ডাটা চেক করা হচ্ছে

  const params = new URLSearchParams({
    created_from: thirtyDaysAgo,
    created_to: now,
    limit: 500, // ৫০০ অর্ডার দিয়েই ভালো স্ট্যাটাস পাওয়া যায়
    service_ids: serviceId,
    sort: 'date-desc',
  });

  const res = await fetch(`${BASE_URL}/orders?${params}`, {
    headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
  });

  if (!res.ok) return [];
  const json = await res.json();
  return json?.data?.list || [];
}

function buildServiceStats(orders) {
  if (orders.length === 0) return null;

  const s = {
    id: orders[0].service_id,
    name: orders[0].service_name || 'Unknown',
    completed: 0, canceled: 0, partial: 0, in_progress: 0, processing: 0,
    total: 0, total_qty: 0,
  };

  for (const order of orders) {
    s.total += 1;
    s.total_qty += Number(order.quantity) || 0;

    const status = (order.status || '').toLowerCase();
    if (status === 'completed') s.completed += 1;
    else if (status === 'canceled') s.canceled += 1;
    else if (status === 'partial') s.partial += 1;
    else if (status === 'in_progress' || status === 'pending') s.in_progress += 1;
    else if (status === 'processing') s.processing += 1;
  }

  s.completion_rate = s.total > 0 ? parseFloat(((s.completed / s.total) * 100).toFixed(1)) : 0;
  s.cancel_rate = s.total > 0 ? parseFloat(((s.canceled / s.total) * 100).toFixed(1)) : 0;
  s.processing_rate = s.total > 0 ? parseFloat(((s.processing / s.total) * 100).toFixed(1)) : 0;
  
  s.score = Math.max(0, Math.min(100, Math.round(s.completion_rate - s.cancel_rate * 1.5)));
  s.verified = s.completion_rate >= 80 && s.total >= 5 && s.cancel_rate < 10;

  return s;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const query = (req.query.q || '').trim().toLowerCase();
  if (!query) {
    return res.status(200).json({
      reply: "Please type a service name or keyword. Example: 'facebook likes' or 'instagram followers'."
    });
  }

  try {
    // ১. প্রথমে BulkProvider এর সার্ভিস লিস্ট থেকে ম্যাচিং সার্ভিসগুলোর ID বের করা
    const servicesRes = await fetch(`${BASE_URL}/services`, {
      headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' }
    });
    
    if (!servicesRes.ok) throw new Error('Failed to fetch service list');
    
    const servicesData = await servicesRes.json();
    const allServices = servicesData?.data || []; // API এর ডাটা স্ট্রাকচার অনুযায়ী বসান

    // কীওয়ার্ড ম্যাচিং
    const words = query.split(/\s+/).filter(Boolean);
    const matchedServices = allServices.filter(s =>
      words.every(w => s.name.toLowerCase().includes(w))
    ).slice(0, 3); // চাটবটে সর্বোচ্চ সেরা ৩টি সার্ভিসের ডাটা ফেচ করব (স্পিডের জন্য)

    if (matchedServices.length === 0) {
      return res.status(200).json({
        reply: `❌ No services found matching '${query}'. Please check spelling or try a different keyword.`
      });
    }

    // ২. ম্যাচ করা সার্ভিসগুলোর অর্ডার হিস্ট্রি ফেচ করা (প্যারালালে)
    const statsPromises = matchedServices.map(s => fetchOrdersForService(s.service || s.id));
    const ordersArrays = await Promise.all(statsPromises);

    // ৩. স্ট্যাটাস বিল্ড করা
    const results = ordersArrays.map(orders => buildServiceStats(orders)).filter(Boolean);

    if (results.length === 0) {
      return res.status(200).json({
        reply: `⚠️ Found services for '${query}', but no recent order data available to verify speed.`
      });
    }

    // ৪. সেরা সার্ভিসগুলো সর্ট করা
    results.sort((a, b) => {
      if (a.verified && !b.verified) return -1;
      if (!a.verified && b.verified) return 1;
      return b.score - a.score;
    });

    // ৫. চাটবটের জন্য রেসপন্স তৈরি করা
    let botReply = `🔍 Top results for '${query}':\n\n`;
    
    results.forEach((s, i) => {
      const statusEmoji = s.verified ? '✅' : '⚠️';
      const speedTag = s.processing_rate <= 10 ? '🚀 Fast/Instant' : s.processing_rate <= 25 ? '⚡ Average' : '🐢 Slow';
      
      botReply += `${i + 1}. ${statusEmoji} ${s.name.substring(0, 45)}\n`;
      botReply += `   🆔 ID: ${s.id} | ⚡ Speed: ${speedTag}\n`;
      botReply += `   📊 Success: ${s.completion_rate}% | Cancel: ${s.cancel_rate}%\n`;
      botReply += `   📦 Recent Orders: ${s.total}\n\n`;
    });

    botReply += `💡 Tip: Use the Service ID (🆔) to place your order!`;

    return res.status(200).json({
      reply: botReply.trim()
    });

   } catch (err) {
    console.error('Chatbot error:', err.message);
    
    // ডিবাগিংয়ের জন্য আসল এরর মেসেজটি রিটার্ন করছি
    return res.status(200).json({
      reply: `⚠️ Debug Error: ${err.message}` 
    });
  }
}
