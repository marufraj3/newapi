// api/chatbot/message.js
// POST /api/chatbot/message
// User message নিয়ে AI response দেয়
// Service analytics + order data context দিয়ে Claude AI ব্যবহার করে

import { kv } from '@vercel/kv';

const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;
const BULKPROVIDER_URL = 'https://mothersmm.com/adminapi/v2';
const BP_KEY           = process.env.BULKPROVIDER_API_KEY;
const SESSION_TTL      = 24 * 60 * 60; // 24 hours

// ── Rate limiting ─────────────────────────────────────────────────────────────
const rateLimitMap = new Map();
function checkRateLimit(ip) {
  const now   = Date.now();
  const key   = ip;
  const entry = rateLimitMap.get(key) || { count: 0, reset: now + 60000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 60000; }
  entry.count++;
  rateLimitMap.set(key, entry);
  return entry.count > 20; // 20 messages per minute
}

// ── Session helpers ───────────────────────────────────────────────────────────
function generateToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function getSession(token) {
  if (!token) return null;
  try { return await kv.get(`chat:${token}`); } catch { return null; }
}

async function saveSession(token, data) {
  try { await kv.set(`chat:${token}`, data, { ex: SESSION_TTL }); } catch {}
}

// ── Fetch service analytics from cache ───────────────────────────────────────
async function getServiceContext() {
  try {
    // analytics cache থেকে নাও (api/analytics.js এ save হয়েছে)
    const cached = await kv.get('analytics_v1');
    if (cached && cached.services) {
      const top20 = cached.services.slice(0, 20).map(s => ({
        id:              s.sid,
        name:            s.name,
        completion_rate: s.completion_rate,
        cancel_rate:     s.canceled_rate,
        score:           s.score,
        verified:        s.verified,
        total_orders:    s.total,
      }));
      return `REAL SERVICE ANALYTICS (Last 90 days, ${cached.total_orders?.toLocaleString()} orders analyzed):\n` +
        top20.map(s =>
          `• #${s.id} ${s.name}\n  Score: ${s.score}/100 | Completion: ${s.completion_rate}% | Cancel: ${s.cancel_rate}% | ${s.verified ? '✅ Verified' : '⚠️ Unverified'} | ${s.total_orders} orders`
        ).join('\n');
    }
  } catch {}
  return 'Service analytics not available right now.';
}

// ── Fetch specific service by ID or keyword ───────────────────────────────────
async function searchServices(query) {
  try {
    const cached = await kv.get('analytics_v1');
    if (!cached || !cached.services) return null;

    const words   = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = cached.services.filter(s =>
      words.every(w => s.name.toLowerCase().includes(w) || String(s.sid).includes(w))
    ).slice(0, 5);

    if (!matches.length) return null;

    return matches.map(s =>
      `#${s.sid} ${s.name}\n  Score: ${s.score}/100 | Completion: ${s.completion_rate}% | Cancel: ${s.canceled_rate}% | ${s.verified ? '✅ Verified' : '⚠️ Unverified'} | Total orders: ${s.total}`
    ).join('\n\n');
  } catch { return null; }
}

// ── System prompt ─────────────────────────────────────────────────────────────
async function buildSystemPrompt() {
  const serviceCtx = await getServiceContext();

  return `You are an AI assistant for an SMM (Social Media Marketing) panel.
Your job is to help users find the best services based on real performance data.

PANEL INFO:
- Name: SMMGEN / MotherSMM
- Website: https://mothersmm.com
- Services: Instagram, TikTok, Facebook, YouTube, Twitter followers, likes, views, etc.

${serviceCtx}

INSTRUCTIONS:
1. Always recommend services based on REAL data above (completion rate, score, verified status)
2. Higher score = better service. Verified ✅ services are more reliable.
3. When user asks for "best X", look at the list above and recommend top scoring verified services
4. Be friendly, concise, and helpful
5. Answer in the SAME language as the user's message
6. If asked about pricing, say pricing is on the website
7. Format: Use **bold** for service names, bullet points for lists
8. Keep responses under 200 words unless necessary
9. Never make up data — only use the analytics provided above
10. If user asks about a specific service ID, find it in the list and share its stats`;
}

// ── Call Claude AI with SSE streaming ─────────────────────────────────────────
async function streamClaudeResponse(messages, systemPrompt, res) {
  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      stream:     true,
      system:     systemPrompt,
      messages,
    }),
  });

  if (!anthropicRes.ok) {
    throw new Error(`Claude API error: ${anthropicRes.status}`);
  }

  return anthropicRes;
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit check
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  if (checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many messages', retryAfter: 60 });
  }

  const { message, sessionToken: inToken, publicKey } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message required' });
  if (!publicKey) return res.status(400).json({ error: 'Public key required' });

  // Get or create session
  let token   = inToken;
  let session = token ? await getSession(token) : null;

  if (!session) {
    token   = generateToken();
    session = { messages: [], mode: 'bot', createdAt: Date.now() };
  }

  // Add user message to history
  session.messages.push({ role: 'user', content: message });

  // Check if message is about a specific service (smart search)
  const serviceKeywords = ['service', 'best', 'recommend', 'which', 'tiktok', 'instagram', 'facebook', 'youtube', 'twitter', 'followers', 'likes', 'views', 'comments'];
  const isServiceQuery  = serviceKeywords.some(k => message.toLowerCase().includes(k));

  // Build AI messages (last 10 for context window)
  const aiMessages = session.messages.slice(-10).map(m => ({
    role:    m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));

  try {
    const systemPrompt = await buildSystemPrompt();

    // SSE streaming response
    const acceptSSE = (req.headers['accept'] || '').includes('text/event-stream');

    if (acceptSSE) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Send processing steps
      const sendStep = (text, status = 'active') => {
        res.write(`data: ${JSON.stringify({ type: 'step', text, status })}\n\n`);
      };

      sendStep('প্রশ্ন বিশ্লেষণ করছি…');
      await new Promise(r => setTimeout(r, 200));

      if (isServiceQuery) {
        sendStep('Service analytics চেক করছি…');
        await new Promise(r => setTimeout(r, 300));
      }

      sendStep('উত্তর তৈরি করছি…');

      // Call Claude
      const claudeRes = await streamClaudeResponse(aiMessages, systemPrompt, res);
      const reader    = claudeRes.body.getReader();
      const decoder   = new TextDecoder();
      let   fullReply = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.type === 'content_block_delta' && evt.delta?.text) {
                fullReply += evt.delta.text;
              }
            } catch {}
          }
        }
      }

      // Save to session
      session.messages.push({ role: 'assistant', content: fullReply });
      await saveSession(token, session);

      // Generate suggestions based on reply
      const suggestions = generateSuggestions(message, fullReply);

      // Send final done event
      const msgId = generateToken();
      res.write(`data: ${JSON.stringify({
        type:         'done',
        reply:        fullReply,
        sessionToken: token,
        mode:         'bot',
        messageId:    msgId,
        suggestions,
      })}\n\n`);
      res.end();

    } else {
      // Non-streaming fallback
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method:  'POST',
        headers: {
          'x-api-key':         ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type':      'application/json',
        },
        body: JSON.stringify({
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          system:     systemPrompt,
          messages:   aiMessages,
        }),
      });

      const claudeData = await claudeRes.json();
      const reply      = claudeData.content?.[0]?.text || 'Sorry, I could not generate a response.';

      session.messages.push({ role: 'assistant', content: reply });
      await saveSession(token, session);

      const suggestions = generateSuggestions(message, reply);

      return res.status(200).json({
        reply,
        sessionToken: token,
        mode:         'bot',
        messageId:    generateToken(),
        suggestions,
      });
    }

  } catch (err) {
    console.error('Chatbot message error:', err.message);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}

// ── Smart suggestions generator ───────────────────────────────────────────────
function generateSuggestions(userMsg, botReply) {
  const msg = (userMsg + ' ' + botReply).toLowerCase();

  if (msg.includes('instagram')) {
    return [
      { text: 'Best Instagram followers?' },
      { text: 'Instagram likes quality?' },
      { text: 'Compare TikTok vs Instagram' },
    ];
  }
  if (msg.includes('tiktok')) {
    return [
      { text: 'Best TikTok views?' },
      { text: 'TikTok likes quality?' },
      { text: 'Compare TikTok services' },
    ];
  }
  if (msg.includes('facebook')) {
    return [
      { text: 'Best Facebook page likes?' },
      { text: 'Facebook followers quality?' },
      { text: 'Compare Facebook services' },
    ];
  }
  if (msg.includes('youtube')) {
    return [
      { text: 'Best YouTube views?' },
      { text: 'YouTube subscribers quality?' },
    ];
  }

  // Default suggestions
  return [
    { text: 'Best Instagram service?' },
    { text: 'Best TikTok service?' },
    { text: 'Show me verified services' },
  ];
}
