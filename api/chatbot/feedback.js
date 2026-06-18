// api/chatbot/feedback.js
// POST /api/chatbot/feedback
// Message feedback (thumbs up/down) save করে

import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { messageId, feedback, sessionToken, publicKey } = req.body;
  if (!messageId) return res.status(400).json({ error: 'messageId required' });

  try {
    await kv.set(`feedback:${messageId}`, {
      feedback,
      sessionToken,
      publicKey,
      savedAt: new Date().toISOString(),
    }, { ex: 30 * 24 * 3600 }); // 30 days

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
