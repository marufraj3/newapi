// api/chatbot/history.js
// POST /api/chatbot/history
// Session এর chat history return করে

import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { sessionToken, publicKey } = req.body;
  if (!sessionToken) return res.status(200).json({ messages: [], mode: 'bot' });

  try {
    const session = await kv.get(`chat:${sessionToken}`);
    if (!session) return res.status(200).json({ messages: [], mode: 'bot' });

    // Format messages for frontend
    const messages = session.messages.map(m => ({
      role:      m.role === 'assistant' ? 'bot' : m.role,
      content:   m.content,
      agentName: m.agentName || null,
    }));

    return res.status(200).json({
      messages,
      mode:        session.mode || 'bot',
      suggestions: session.lastSuggestions || [],
    });

  } catch (err) {
    console.error('History error:', err.message);
    return res.status(200).json({ messages: [], mode: 'bot' });
  }
}
