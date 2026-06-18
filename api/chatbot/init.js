// api/chatbot/init.js
// GET /api/chatbot/init?key=PUBLIC_KEY
// Widget config return করে

const WIDGETS = {
  // Public Key → Widget Config
  // আপনার website এর জন্য একটা key বানান
  'YOUR_PUBLIC_KEY': {
    botName:          'SMMGEN AI Assistant',
    panelName:        'SMMGEN',
    panelDomain:      'https://mothersmm.com',
    widgetColor:      '#7C3AED',
    buttonShape:      'circle',
    buttonIcon:       'chat',
    widgetIconUrl:    '', // logo URL দিন অথবা খালি রাখুন
    greetingMessage:  '👋 Welcome to SMMGEN AI Assistant!\n\nI recommend the best services using performance data, pricing, and insights from SMMGEN\'s order history.\n\n💡 You can ask me things like:\n• Best services for your needs\n• Service suggestion & Recent Order history check\n• Price & quality suggestions\n• General questions — in any language\n\nJust type your question, and I\'ll assist you instantly 🚀',
    greetingSuggestions: [
      { text: 'Hello' },
      { text: 'Best TikTok Likes' },
      { text: 'What is the best Facebook followers?' },
      { text: 'Any other options?' },
    ],
    greetingIntervalHours: 24,
    pusherKey:     '', // Pusher লাগলে key দিন
    pusherCluster: 'ap1',
    allowedOrigins: ['*'], // production এ specific domain দিন
  },
};

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { key } = req.query;
  const widget = WIDGETS[key];

  if (!widget) {
    return res.status(404).json({ error: 'Invalid public key' });
  }

  return res.status(200).json(widget);
}
