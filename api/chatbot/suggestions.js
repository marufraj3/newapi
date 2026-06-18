// api/chatbot/suggestions.js
// GET /api/chatbot/suggestions?key=PUBLIC_KEY&lang=en
// Greeting suggestions return করে

const DEFAULT_SUGGESTIONS = {
  en: [
    { text: 'Hello' },
    { text: 'Best TikTok Likes' },
    { text: 'What is the best Facebook followers?' },
    { text: 'Any other options?' },
  ],
  bn: [
    { text: 'হ্যালো' },
    { text: 'সেরা TikTok Likes' },
    { text: 'সেরা Facebook followers কোনটা?' },
    { text: 'আর কী আছে?' },
  ],
};

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const lang = req.query.lang || 'en';
  const suggestions = DEFAULT_SUGGESTIONS[lang] || DEFAULT_SUGGESTIONS['en'];

  return res.status(200).json({ suggestions });
}
