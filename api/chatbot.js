// api/chatbot.js
const KV_URL    = process.env.KV_REST_API_URL;
const KV_TOKEN  = process.env.KV_REST_API_TOKEN;

// আপনার analytics কোডে যে কী ব্যবহার করা হয়েছে সেটি দিন (analytics_v3 বা analytics_v4)
const CACHE_KEY = 'analytics_v4'; 

async function kvGet(key) {
  try {
    const res = await fetch(`${KV_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    if (!res.ok) return null;
    const { result } = await res.json();
    return result ? JSON.parse(result) : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ১. চাটবট থেকে কীওয়ার্ড নেওয়া (e.g., /api/chatbot?q=facebook+likes)
  const query = (req.query.q || '').trim().toLowerCase();
  if (!query) {
    return res.status(200).json({
      success: false,
      reply: "Please type a service name or keyword. Example: 'facebook likes' or 'instagram followers'."
    });
  }

  // ২. KV থেকে ক্যাশড অ্যানালিটিক্স ডাটা আনা (ইনস্ট্যান্ট লোড)
  const cached = await kvGet(CACHE_KEY);
  if (!cached || !cached.services || cached.services.length === 0) {
    return res.status(200).json({
      success: false,
      reply: "Service analytics data is currently updating. Please try again in a few minutes."
    });
  }

  // ৩. কীওয়ার্ড ম্যাচিং (Multi-keyword support)
  // "facebook like" লিখলে নামের মধ্যে "facebook" এবং "like" দুটোই থাকতে হবে
  const words = query.split(/\s+/).filter(Boolean);
  let matches = cached.services.filter(s =>
    words.every(w => s.name.toLowerCase().includes(w) || s.sid.includes(w))
  );

  // ৪. সার্চ রেজাল্ট না পাওয়ার ফলব্যাক (Smart Suggestion)
  if (matches.length === 0) {
    const partialMatches = cached.services.filter(s =>
      words.some(w => s.name.toLowerCase().includes(w) || s.sid.includes(w))
    ).slice(0, 3);

    let suggestionText = partialMatches.length > 0 
      ? `No exact match for '${query}'. Did you mean: \n${partialMatches.map(s => `- ${s.name.substring(0, 40)} (ID: ${s.sid})`).join('\n')}?`
      : `No services found matching '${query}'.`;

    return res.status(200).json({
      success: true,
      query: query,
      total_matches: 0,
      services: [],
      reply: suggestionText
    });
  }

  // ৫. সেরা সার্ভিসগুলো ফিল্টার করা (ভেরিফায়েড এবং স্কোর অনুযায়ী সর্ট)
  const topMatches = matches
    .sort((a, b) => {
      if (a.verified && !b.verified) return -1;
      if (!a.verified && b.verified) return 1;
      return b.score - a.score;
    })
    .slice(0, 5); // চাটবটে সর্বোচ্চ ৫টি সেরা সার্ভিস দেখানো

  // ৬. চাটবটের জন্য সুন্দর টেক্সট রেসপন্স তৈরি করা
  let botReply = `🔍 Top results for '${query}':\n\n`;
  
  topMatches.forEach((s, i) => {
    const statusEmoji = s.verified ? '✅' : '⚠️';
    // প্রসেসিং রেটের উপর ভিত্তি করে স্পিড ট্যাগ তৈরি
    const speedTag = s.processing_rate <= 5 ? '🚀 Instant' : s.processing_rate <= 15 ? '⚡ Fast' : '🐢 Average';
    
    botReply += `${i + 1}. ${statusEmoji} ${s.name.substring(0, 45)}\n`;
    botReply += `   🆔 ID: ${s.sid} | ⚡ Speed: ${speedTag}\n`;
    botReply += `   📊 Success: ${s.completion_rate}% | 📦 Orders: ${s.total}\n\n`;
  });

  if (matches.length > 5) {
    botReply += `_...and ${matches.length - 5} more services available._\n`;
  }
  
  botReply += `\n💡 Tip: Use the Service ID (🆔) to place your order on the website!`;

  // ৭. JSON রেসপন্স পাঠানো
  return res.status(200).json({
    success: true,
    query: query,
    total_matches: matches.length,
    services: topMatches.map(s => ({
      id: s.sid,
      name: s.name,
      completion_rate: s.completion_rate,
      processing_rate: s.processing_rate,
      cancel_rate: s.canceled_rate,
      total_orders: s.total,
      verified: s.verified,
      score: s.score
    })),
    reply: botReply.trim() // এটি সরাসরি মেসেঞ্জারে পাঠাতে পারবেন
  });
}
