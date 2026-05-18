// api/chatbot.js
const KV_URL    = process.env.KV_REST_API_URL;
const KV_TOKEN  = process.env.KV_REST_API_TOKEN;
const CACHE_KEY = 'analytics_final_v1'; // আপনার analytics এর ক্যাশ কী

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
  // CORS Setup
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ১. ইউজারের কোয়েরি নেওয়া (chatbot?q=facebook+likes)
  const query = (req.query.q || '').trim().toLowerCase();
  if (!query) {
    return res.status(200).json({
      reply: "Please type a service name or keyword (e.g., 'facebook likes', 'instagram followers')."
    });
  }

  // ২. KV থেকে ক্যাশড অ্যানালিটিক্স ডাটা আনা
  const cached = await kvGet(CACHE_KEY);
  if (!cached || !cached.services) {
    return res.status(200).json({
      reply: "Analytics data is currently loading. Please try again in a few minutes."
    });
  }

  // ৩. কীওয়ার্ড ম্যাচিং (Multi-keyword support)
  // "facebook like" লিখলে "facebook" এবং "like" দুটোই নামের মধ্যে থাকতে হবে
  const words = query.split(/\s+/).filter(Boolean);
  let matches = cached.services.filter(s =>
    words.every(w => s.name.toLowerCase().includes(w) || s.sid.includes(w))
  );

  // ৪. সার্চ রেজাল্ট না পাওয়ার ফলব্যাক (Smart Suggestion)
  if (matches.length === 0) {
    // দেখাচ্ছে সম্ভবত ভুল বানান দিয়েছে, অন্তত ১টা কমন লেটার আছে কি না চেক করি
    const partialMatches = cached.services.filter(s =>
      words.some(w => s.name.toLowerCase().includes(w) || s.sid.includes(w))
    ).slice(0, 3);

    let suggestionText = partialMatches.length > 0 
      ? `Did you mean: ${partialMatches.map(s => s.name.substring(0, 30)).join(', ')}?`
      : `No services found matching '${query}'.`;

    return res.status(200).json({
      query: query,
      total_matches: 0,
      services: [],
      reply: suggestionText
    });
  }

  // ৫. সেরা সার্ভিসগুলো ফিল্টার করা (ভেরিফায়েড এবং স্কোর অনুযায়ী)
  // চাটবট যেন ব্যবহারকারীকে সবচেয়ে ভালো সার্ভিসটা সুপারিশ করে
  const topMatches = matches
    .sort((a, b) => {
      // Verified সার্ভিসগুলোকে উপরে আনা
      if (a.verified && !b.verified) return -1;
      if (!a.verified && b.verified) return 1;
      // এরপর স্কোর অনুযায়ী সর্ট
      return b.score - a.score;
    })
    .slice(0, 5); // চাটবটে সর্বোচ্চ ৫টি সার্ভিস দেখানোই যথেষ্ট

  // ৬. চাটবটের জন্য সুন্দর টেক্সট রেসপন্স তৈরি করা
  let botReply = `🔍 Search results for '${query}':\n\n`;
  
  topMatches.forEach((s, i) => {
    const statusEmoji = s.verified ? '✅' : '⚠️';
    const speedTag = s.processing_rate <= 5 ? '🚀 Super Fast' : s.processing_rate <= 15 ? '⚡ Fast' : '🐢 Slow';
    
    botReply += `${i + 1}. ${statusEmoji} ${s.name.substring(0, 40)}\n`;
    botReply += `   ID: #${s.sid} | Speed: ${speedTag}\n`;
    botReply += `   Success: ${s.completion_rate}% | Orders: ${s.total}\n\n`;
  });

  if (matches.length > 5) {
    botReply += `_...and ${matches.length - 5} more services available._`;
  }

  // ৭. JSON রেসপন্স পাঠানো
  return res.status(200).json({
    query: query,
    total_matches: matches.length,
    services: topMatches.map(s => ({
      id: s.sid,
      name: s.name,
      completion_rate: s.completion_rate,
      processing_rate: s.processing_rate,
      total_orders: s.total,
      verified: s.verified,
      score: s.score
    })),
    reply: botReply.trim() // এটি সরাসরি মেসেঞ্জারে পাঠাতে পারবেন
  });
}
