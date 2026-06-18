/**
 * SMMGEN AI Chatbot Widget
 * Usage: <script src="https://newapi-gamma-five.vercel.app/chatbot/widget.js" data-key="YOUR_PUBLIC_KEY"></script>
 *
 * এই file টা আপনার দেওয়া widget.js এর মতোই কাজ করবে।
 * শুধু API URLs গুলো আপনার Vercel URL এ point করবে।
 */
(function () {
  'use strict';

  var script     = document.currentScript;
  var PUBLIC_KEY = script && script.dataset.key;
  if (!PUBLIC_KEY) { console.error('[Chatbot] Missing data-key'); return; }

  // ── API URLs — আপনার Vercel project URL দিন ──
  var API_BASE        = 'https://newapi-gamma-five.vercel.app';
  var INIT_URL        = API_BASE + '/api/chatbot/init?key=' + PUBLIC_KEY;
  var MSG_URL         = API_BASE + '/api/chatbot/message';
  var HISTORY_URL     = API_BASE + '/api/chatbot/history';
  var SUGGESTIONS_URL = API_BASE + '/api/chatbot/suggestions';
  var FEEDBACK_URL    = API_BASE + '/api/chatbot/feedback';
  var STORAGE_KEY     = 'smm_chatbot_session_' + PUBLIC_KEY;

  // ── State ──
  var config      = null;
  var sessionToken = null;
  var isOpen      = false;
  var isExpanded  = false;
  var isLoading   = false;
  var messages    = [];
  var sessionMode = 'bot';

  // Restore session from localStorage
  try {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      var parsed = JSON.parse(saved);
      if (parsed.token && parsed.expires > Date.now()) sessionToken = parsed.token;
      else localStorage.removeItem(STORAGE_KEY);
    }
  } catch (e) {}

  // ── Styles ──
  function injectStyles(color, shape) {
    var css = `
      #smm-chatbot-wrapper * { box-sizing: border-box; margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      #smm-chatbot-btn {
        position: fixed; bottom: 24px; right: 24px; z-index: 99998;
        width: 60px; height: 60px; border-radius: 50%; border: none; cursor: pointer;
        background: linear-gradient(135deg, ${color} 0%, ${color}cc 100%); color: #fff;
        box-shadow: 0 4px 16px ${color}44; transition: transform 0.3s, box-shadow 0.3s;
        display: flex; align-items: center; justify-content: center;
      }
      #smm-chatbot-btn:hover { transform: scale(1.08); }
      #smm-chatbot-btn svg { width: 28px; height: 28px; fill: none; stroke: currentColor; stroke-width: 2; }
      #smm-chatbot-btn.smm-pulse::before {
        content: ''; position: absolute; inset: -4px; border-radius: 50%;
        border: 2px solid ${color}55; animation: smm-pulse-ring 2s ease-out infinite;
      }
      @keyframes smm-pulse-ring { 0% { transform: scale(1); opacity: 1; } 100% { transform: scale(1.4); opacity: 0; } }
      #smm-chatbot-greeting {
        position: fixed; bottom: 92px; right: 24px; z-index: 99997;
        background: #fff; color: #1e293b; padding: 14px 40px 14px 16px;
        border-radius: 16px 16px 4px 16px; max-width: 280px;
        box-shadow: 0 8px 30px rgba(0,0,0,0.12); font-size: 14px; line-height: 1.5;
        cursor: pointer; display: none; border-left: 3px solid ${color};
        animation: smm-bubble-in 0.5s cubic-bezier(0.34,1.56,0.64,1);
      }
      @keyframes smm-bubble-in { 0% { opacity:0; transform:translateY(16px) scale(0.85); } 100% { opacity:1; transform:translateY(0) scale(1); } }
      #smm-chatbot-greeting.smm-bubble-out { opacity:0; transform:translateY(10px) scale(0.9); pointer-events:none; }
      #smm-chatbot-greeting .smm-greeting-close {
        position: absolute; top: 6px; right: 8px; background: none; border: none;
        cursor: pointer; color: #cbd5e1; font-size: 16px; padding: 2px 6px;
      }
      #smm-chatbot-window {
        position: fixed; bottom: 96px; right: 24px; z-index: 99999;
        width: 380px; max-width: calc(100vw - 32px); height: 540px; max-height: calc(100vh - 120px);
        background: #fff; border-radius: 20px;
        box-shadow: 0 16px 48px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.04);
        display: none; flex-direction: column; overflow: hidden;
        animation: smm-slide-up 0.3s ease-out;
      }
      #smm-chatbot-window.open { display: flex; }
      @keyframes smm-slide-up { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
      #smm-chatbot-window.expanded {
        width: 700px !important; max-width: calc(100vw - 48px) !important;
        height: 85vh !important; bottom: 24px; border-radius: 16px;
      }
      .smm-chatbot-header {
        background: linear-gradient(135deg, ${color} 0%, ${color}dd 100%);
        color: #fff; padding: 18px 20px; display: flex; align-items: center; gap: 12px; flex-shrink: 0;
      }
      .smm-chatbot-header-avatar {
        width: 42px; height: 42px; border-radius: 50%; background: #fff;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; font-size: 20px; overflow: hidden;
        box-shadow: 0 2px 6px rgba(0,0,0,0.1);
      }
      .smm-chatbot-header-avatar img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
      .smm-chatbot-header-info { flex: 1; min-width: 0; }
      .smm-chatbot-header-name { font-weight: 700; font-size: 16px; }
      .smm-chatbot-header-status { font-size: 12px; opacity: 0.9; margin-top: 2px; }
      .smm-chatbot-header-actions { display: flex; align-items: center; gap: 4px; }
      .smm-chatbot-close, .smm-chatbot-expand, .smm-chatbot-newchat {
        background: rgba(255,255,255,0.2); border: none; color: #fff; cursor: pointer;
        width: 30px; height: 30px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        transition: background 0.2s; font-size: 14px;
      }
      .smm-chatbot-close:hover, .smm-chatbot-expand:hover, .smm-chatbot-newchat:hover { background: rgba(255,255,255,0.35); }
      .smm-chatbot-messages {
        flex: 1; overflow-y: auto; padding: 20px;
        display: flex; flex-direction: column; gap: 12px;
        background: #f7f8fa; scroll-behavior: smooth;
      }
      .smm-chatbot-messages::-webkit-scrollbar { width: 4px; }
      .smm-chatbot-messages::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 4px; }
      .smm-chatbot-msg {
        max-width: 85%; padding: 12px 16px; font-size: 14px; line-height: 1.6;
        word-wrap: break-word; white-space: pre-wrap; animation: smm-msg-in 0.2s ease;
      }
      @keyframes smm-msg-in { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
      .smm-chatbot-msg.bot { align-self: flex-start; background: #fff; color: #1e293b; border-radius: 4px 18px 18px 18px; box-shadow: 0 1px 6px rgba(0,0,0,0.06); }
      .smm-chatbot-msg.user { align-self: flex-end; background: linear-gradient(135deg, ${color}, ${color}dd); color: #fff; border-radius: 18px 18px 4px 18px; }
      .smm-chatbot-msg.system { align-self: center; background: #f1f5f9; color: #64748b; font-size: 12px; font-style: italic; max-width: 90%; text-align: center; border-radius: 10px; padding: 8px 14px; }
      .smm-chatbot-typing { align-self: flex-start; background: #fff; padding: 12px 18px; border-radius: 4px 18px 18px 18px; display: none; gap: 5px; align-items: center; box-shadow: 0 1px 6px rgba(0,0,0,0.06); }
      .smm-chatbot-typing.active { display: flex; }
      .smm-chatbot-typing span { width: 7px; height: 7px; background: #94a3b8; border-radius: 50%; animation: smm-bounce 1.4s infinite; }
      .smm-chatbot-typing span:nth-child(2) { animation-delay: 0.2s; }
      .smm-chatbot-typing span:nth-child(3) { animation-delay: 0.4s; }
      @keyframes smm-bounce { 0%,60%,100% { transform:translateY(0); } 30% { transform:translateY(-5px); } }
      .smm-chatbot-steps {
        align-self: flex-start; background: #fff; padding: 14px 18px;
        border-radius: 4px 18px 18px 18px; display: none; flex-direction: column; gap: 6px;
        box-shadow: 0 1px 6px rgba(0,0,0,0.06); min-width: 200px;
      }
      .smm-chatbot-steps.active { display: flex; }
      .smm-chatbot-steps-header { font-size: 13px; font-weight: 700; color: #1e293b; margin-bottom: 2px; }
      .smm-chatbot-step { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #64748b; }
      .smm-chatbot-step-icon { width: 16px; flex-shrink: 0; text-align: center; font-size: 12px; }
      .smm-chatbot-step.done { color: #94a3b8; }
      .smm-chatbot-step.done .smm-chatbot-step-icon { color: #22c55e; }
      .smm-chatbot-step.active { color: #334155; font-weight: 500; }
      .smm-chatbot-input-area { padding: 16px 20px; background: #fff; border-top: 1px solid #f0f0f0; display: flex; gap: 12px; align-items: center; }
      .smm-chatbot-input {
        flex: 1; border: 1.5px solid #e5e7eb; border-radius: 24px; padding: 10px 18px;
        font-size: 14px; resize: none; outline: none; min-height: 42px; max-height: 100px;
        font-family: inherit; background: #fafafa; transition: border-color 0.2s;
      }
      .smm-chatbot-input:focus { border-color: ${color}; background: #fff; }
      .smm-chatbot-send {
        width: 40px; height: 40px; border-radius: 50%; border: none; cursor: pointer;
        background: ${color}; color: #fff; display: flex; align-items: center; justify-content: center;
        transition: transform 0.15s, opacity 0.15s; flex-shrink: 0;
      }
      .smm-chatbot-send:hover { transform: scale(1.08); }
      .smm-chatbot-send:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
      .smm-chatbot-send svg { width: 18px; height: 18px; }
      .smm-chatbot-powered { padding: 8px; text-align: center; font-size: 11px; color: #b0b0b0; background: #fafafa; border-top: 1px solid #f5f5f5; }
      .smm-chatbot-powered a { color: #888; text-decoration: none; font-weight: 500; }
      .smm-chatbot-powered a:hover { color: ${color}; }
      .smm-chatbot-suggestions { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 20px 12px; }
      .smm-chatbot-chip {
        display: inline-flex; align-items: center; gap: 4px; padding: 8px 14px;
        border-radius: 20px; font-size: 13px; background: #f0f4ff; color: #3b5bdb;
        border: 1px solid #dbe4ff; cursor: pointer; transition: all 0.2s; font-family: inherit;
      }
      .smm-chatbot-chip:hover { background: #dbe4ff; transform: translateY(-1px); }
      .smm-chatbot-chip::before { content: '↗'; font-size: 11px; opacity: 0.6; }
      .smm-chatbot-feedback { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
      .smm-chatbot-feedback-btn {
        background: none; border: 1px solid #e5e7eb; cursor: pointer; padding: 4px 10px;
        border-radius: 16px; font-size: 14px; transition: all 0.2s; color: #6b7280;
      }
      .smm-chatbot-feedback-btn:hover { background: #f9fafb; }
      .smm-chatbot-feedback-btn.active-up { background: #ecfdf5; border-color: #86efac; color: #16a34a; }
      .smm-chatbot-feedback-btn.active-down { background: #fef2f2; border-color: #fca5a5; color: #dc2626; }
      @media (max-width: 480px) {
        #smm-chatbot-window { bottom:0; right:0; left:0; top:0; width:100%; max-width:100%; height:100dvh; max-height:100dvh; border-radius:0; }
        #smm-chatbot-btn { bottom:16px; right:16px; }
        #smm-chatbot-btn.hidden { display:none !important; }
        .smm-chatbot-expand { display:none !important; }
      }
    `;
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  var ICON_CHAT  = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>';
  var ICON_CLOSE = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>';
  var ICON_SEND  = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z"/></svg>';

  function escapeHtml(str) { var d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

  function buildWidget() {
    var wrapper = document.createElement('div');
    wrapper.id  = 'smm-chatbot-wrapper';

    var btn = document.createElement('button');
    btn.id  = 'smm-chatbot-btn';
    btn.innerHTML = ICON_CHAT;
    btn.onclick   = toggleChat;

    var win = document.createElement('div');
    win.id  = 'smm-chatbot-window';
    win.innerHTML = `
      <div class="smm-chatbot-header">
        <div class="smm-chatbot-header-avatar">${config.widgetIconUrl ? '<img src="' + escapeHtml(config.widgetIconUrl) + '" alt="">' : '🤖'}</div>
        <div class="smm-chatbot-header-info">
          <div class="smm-chatbot-header-name">${escapeHtml(config.botName)}</div>
          <div class="smm-chatbot-header-status">● Online</div>
        </div>
        <div class="smm-chatbot-header-actions">
          <button class="smm-chatbot-newchat" onclick="window.__smmNewChat()" title="New Chat">✚</button>
          <button class="smm-chatbot-expand" id="smm-expand" onclick="window.__smmExpand()" title="Expand">⛶</button>
          <button class="smm-chatbot-close" onclick="window.__smmToggle()">✕</button>
        </div>
      </div>
      <div class="smm-chatbot-messages" id="smm-msgs"></div>
      <div class="smm-chatbot-typing" id="smm-typing"><span></span><span></span><span></span></div>
      <div class="smm-chatbot-input-area">
        <textarea class="smm-chatbot-input" id="smm-input" placeholder="Type a message..." rows="1"></textarea>
        <button class="smm-chatbot-send" id="smm-send" onclick="window.__smmSend()">${ICON_SEND}</button>
      </div>
      <div class="smm-chatbot-powered">Powered by <a href="${escapeHtml(config.panelDomain || '/')}" target="_blank">${escapeHtml(config.panelName || 'AI')}</a></div>
    `;

    var greet = document.createElement('div');
    greet.id  = 'smm-chatbot-greeting';
    var greetText = (config.greetingMessage || '').split('\n')[0].substring(0, 80);
    greet.innerHTML = '<span>' + escapeHtml(greetText) + '</span><button class="smm-greeting-close" onclick="event.stopPropagation();dismissGreet()">✕</button>';
    greet.onclick   = toggleChat;

    wrapper.appendChild(win);
    wrapper.appendChild(greet);
    wrapper.appendChild(btn);
    document.body.appendChild(wrapper);

    // Show greeting after 1.5s
    setTimeout(function () {
      if (!isOpen) {
        greet.style.display = 'block';
        btn.classList.add('smm-pulse');
        setTimeout(function () {
          greet.classList.add('smm-bubble-out');
          setTimeout(function () { greet.style.display = 'none'; }, 300);
        }, 8000);
      }
    }, 1500);

    window.dismissGreet = function () {
      var g = document.getElementById('smm-chatbot-greeting');
      if (g) { g.classList.add('smm-bubble-out'); setTimeout(function () { g.style.display = 'none'; }, 300); }
    };

    // Input handlers
    var input = document.getElementById('smm-input');
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.__smmSend(); }
    });
    input.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 100) + 'px';
    });

    // Add greeting message
    addMessage('bot', config.greetingMessage);

    // Add greeting suggestions
    if (config.greetingSuggestions && config.greetingSuggestions.length) {
      renderSuggestions(config.greetingSuggestions);
    }

    // Load history if session exists
    if (sessionToken) loadHistory();
  }

  function toggleChat() {
    var win = document.getElementById('smm-chatbot-window');
    var btn = document.getElementById('smm-chatbot-btn');
    var greet = document.getElementById('smm-chatbot-greeting');
    var isMobile = window.innerWidth <= 480;

    isOpen = !isOpen;
    if (isOpen) {
      win.classList.add('open');
      btn.innerHTML = ICON_CLOSE;
      if (greet) greet.style.display = 'none';
      btn.classList.remove('smm-pulse');
      if (isMobile) btn.classList.add('hidden');
      setTimeout(function () { var i = document.getElementById('smm-input'); if (i) i.focus(); }, 300);
    } else {
      win.classList.remove('open');
      btn.innerHTML = ICON_CHAT;
      btn.classList.remove('hidden');
    }
  }
  window.__smmToggle = toggleChat;

  window.__smmExpand = function () {
    var win = document.getElementById('smm-chatbot-window');
    var btn = document.getElementById('smm-expand');
    isExpanded = !isExpanded;
    win.classList.toggle('expanded', isExpanded);
    if (btn) btn.title = isExpanded ? 'Collapse' : 'Expand';
    var container = document.getElementById('smm-msgs');
    if (container) setTimeout(function () { container.scrollTop = container.scrollHeight; }, 100);
  };

  window.__smmNewChat = function () {
    if (!confirm('Start a new chat? Current history will be cleared.')) return;
    localStorage.removeItem(STORAGE_KEY);
    sessionToken = null;
    sessionMode  = 'bot';
    messages     = [];
    var c = document.getElementById('smm-msgs');
    if (c) c.innerHTML = '';
    document.querySelectorAll('.smm-chatbot-suggestions').forEach(function (el) { el.remove(); });
    addMessage('bot', config.greetingMessage);
    if (config.greetingSuggestions) renderSuggestions(config.greetingSuggestions);
  };

  function loadHistory() {
    fetch(HISTORY_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sessionToken: sessionToken, publicKey: PUBLIC_KEY }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.messages && data.messages.length > 0) {
          var c = document.getElementById('smm-msgs');
          if (c) c.innerHTML = '';
          messages = [];
          data.messages.forEach(function (m) { addMessage(m.role, m.content); });
        }
        if (data.suggestions && data.suggestions.length) renderSuggestions(data.suggestions);
      })
      .catch(function () {});
  }

  function renderSuggestions(suggestions) {
    document.querySelectorAll('.smm-chatbot-suggestions').forEach(function (el) { el.remove(); });
    var container = document.getElementById('smm-msgs');
    if (!container || !suggestions || !suggestions.length) return;
    var div = document.createElement('div');
    div.className = 'smm-chatbot-suggestions';
    suggestions.forEach(function (s) {
      var chip = document.createElement('button');
      chip.className   = 'smm-chatbot-chip';
      chip.textContent = s.text || s;
      chip.onclick     = function () {
        document.querySelectorAll('.smm-chatbot-suggestions').forEach(function (el) { el.remove(); });
        var input = document.getElementById('smm-input');
        if (input) input.value = s.text || s;
        window.__smmSend();
      };
      div.appendChild(chip);
    });
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function addMessage(role, text) {
    if (!text) return;
    var container = document.getElementById('smm-msgs');
    if (!container) return;
    var div = document.createElement('div');
    div.className = 'smm-chatbot-msg ' + (role === 'assistant' ? 'bot' : role);

    if (role === 'user') {
      div.textContent = text;
    } else {
      div.innerHTML = formatMsg(String(text));
    }

    document.querySelectorAll('.smm-chatbot-suggestions').forEach(function (el) { el.remove(); });
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    messages.push({ role: role, content: text });
  }

  function formatMsg(text) {
    text = escapeHtml(text);
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/^###\s+(.+)$/gm, '<strong>$1</strong>');
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:#2563eb;font-weight:500;">$1 →</a>');
    return text;
  }

  function showTyping(show) {
    var t = document.getElementById('smm-typing');
    if (t) t.classList.toggle('active', show);
  }

  // Processing steps UI
  var stepsEl = null;
  function showSteps(show) {
    if (show) {
      if (!stepsEl) {
        stepsEl = document.createElement('div');
        stepsEl.id        = 'smm-steps';
        stepsEl.className = 'smm-chatbot-steps active';
        stepsEl.innerHTML = '<div class="smm-chatbot-steps-header">' + escapeHtml(config.botName) + '</div>';
        var c = document.getElementById('smm-msgs');
        if (c) { c.appendChild(stepsEl); c.scrollTop = c.scrollHeight; }
      }
    } else {
      if (stepsEl) { stepsEl.remove(); stepsEl = null; }
    }
  }

  function addStep(text, status) {
    if (!stepsEl || !text) return;
    var prev = stepsEl.querySelector('.smm-chatbot-step.active');
    if (prev && status === 'active') {
      prev.classList.replace('active', 'done');
      prev.querySelector('.smm-chatbot-step-icon').textContent = '✓';
    }
    var step = document.createElement('div');
    step.className = 'smm-chatbot-step ' + (status || 'active');
    step.innerHTML = '<span class="smm-chatbot-step-icon">' + (status === 'done' ? '✓' : '✴') + '</span>' + escapeHtml(text);
    stepsEl.appendChild(step);
    var c = document.getElementById('smm-msgs');
    if (c) c.scrollTop = c.scrollHeight;
  }

  window.__smmSend = function () {
    if (isLoading) return;
    var input = document.getElementById('smm-input');
    var text  = input.value.trim();
    if (!text) return;

    addMessage('user', text);
    input.value = '';
    input.style.height = 'auto';

    isLoading = true;
    showSteps(true);
    document.getElementById('smm-send').disabled = true;

    fetch(MSG_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body:    JSON.stringify({ message: text, sessionToken: sessionToken, publicKey: PUBLIC_KEY }),
    })
      .then(function (res) {
        if (!res.ok) return res.json().then(function (d) { throw new Error(d.error || 'Error'); });
        var ct = res.headers.get('content-type') || '';

        // SSE streaming
        if (ct.includes('text/event-stream')) {
          var reader  = res.body.getReader();
          var decoder = new TextDecoder();
          var buf     = '';

          function read() {
            return reader.read().then(function (r) {
              if (r.done) return;
              buf += decoder.decode(r.value, { stream: true });
              var lines = buf.split('\n');
              buf = lines.pop() || '';
              for (var i = 0; i < lines.length; i++) {
                var line = lines[i].trim();
                if (line.indexOf('data: ') === 0) {
                  try {
                    var evt = JSON.parse(line.slice(6));
                    if (evt.type === 'step') { addStep(evt.text, evt.status); }
                    else if (evt.type === 'done') {
                      showSteps(false);
                      sessionToken = evt.sessionToken;
                      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: evt.sessionToken, expires: Date.now() + 86400000 })); } catch (e) {}
                      addMessage('bot', evt.reply);
                      if (evt.suggestions) renderSuggestions(evt.suggestions);
                      finishLoad();
                      return;
                    } else if (evt.type === 'error') {
                      showSteps(false);
                      addMessage('bot', '⚠️ ' + (evt.message || 'Error'));
                      finishLoad();
                      return;
                    }
                  } catch (e) {}
                }
              }
              return read();
            });
          }
          return read();
        }

        // JSON fallback
        return res.json().then(function (d) {
          showSteps(false);
          sessionToken = d.sessionToken;
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: d.sessionToken, expires: Date.now() + 86400000 })); } catch (e) {}
          addMessage('bot', d.reply);
          if (d.suggestions) renderSuggestions(d.suggestions);
          finishLoad();
        });
      })
      .catch(function (err) {
        showSteps(false);
        addMessage('bot', '⚠️ ' + (err.message || 'Something went wrong'));
        finishLoad();
      });
  };

  function finishLoad() {
    isLoading = false;
    showTyping(false);
    showSteps(false);
    document.getElementById('smm-send').disabled = false;
    var i = document.getElementById('smm-input');
    if (i) i.focus();
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.smm-chatbot-suggestions') && !e.target.closest('#smm-input')) {
      // keep suggestions visible
    }
  });

  // ── Init ──
  fetch(INIT_URL)
    .then(function (r) { return r.json(); })
    .then(function (data) {
      config = data;
      injectStyles(config.widgetColor || '#7C3AED', config.buttonShape || 'circle');
      buildWidget();
    })
    .catch(function (err) { console.error('[Chatbot] Init failed:', err.message); });
})();
