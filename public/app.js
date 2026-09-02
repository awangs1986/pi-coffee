(() => {
  'use strict';

  // ---------- DOM ----------
  const $ = (selector) => document.querySelector(selector);
  const app = $('#app');
  const thread = $('#thread');
  const scroller = $('#scroller');
  const promptBox = $('#prompt');
  const sendBtn = $('#send');
  const stopBtn = $('#stop');
  const statusText = $('#status');
  const dot = $('#dot');
  const titleEl = $('#title');
  const topbarState = $('#topbar-state');
  const sessionMeta = $('#session-meta');
  const sessionList = $('#session-list');

  // ---------- local persistence (display cache only; the Host owns the truth) ----------
  const STORE = {
    sessions: 'pi-coffee.sessions.v1',
    active: 'pi-coffee.active.v1',
    transcript: (id) => 'pi-coffee.transcript.v1.' + id,
    legacySession: 'pi-coffee.session-id',
    legacyCursor: 'pi-coffee.cursor',
  };
  const MAX_SESSIONS = 30;
  const MAX_ENTRIES = 120;
  const MAX_TEXT = 60_000;

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota: display cache is best-effort */ }
  }

  let sessions = loadJson(STORE.sessions, []);
  let activeId = localStorage.getItem(STORE.active) || null;

  // One-time migration from the single-session MVP shell.
  const legacyId = localStorage.getItem(STORE.legacySession);
  if (legacyId && !sessions.some((s) => s.id === legacyId)) {
    sessions.unshift({ id: legacyId, title: '之前的对话', updatedAt: Date.now(), cursor: Number(localStorage.getItem(STORE.legacyCursor) || 0) });
    if (!activeId) activeId = legacyId;
    localStorage.removeItem(STORE.legacySession);
    localStorage.removeItem(STORE.legacyCursor);
    persistSessions();
  }

  function persistSessions() {
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    for (const dropped of sessions.slice(MAX_SESSIONS)) localStorage.removeItem(STORE.transcript(dropped.id));
    sessions = sessions.slice(0, MAX_SESSIONS);
    saveJson(STORE.sessions, sessions);
    if (activeId) localStorage.setItem(STORE.active, activeId); else localStorage.removeItem(STORE.active);
  }
  function sessionEntry(id) { return sessions.find((s) => s.id === id); }
  function touchSession(id, patch) {
    const entry = sessionEntry(id);
    if (!entry) return;
    Object.assign(entry, patch, { updatedAt: Date.now() });
    persistSessions();
  }

  // ---------- transcript model ----------
  // entries: {k:'user',text} | {k:'assistant',text} | {k:'tool',name,arg,result,error,done} | {k:'note',text,failure}
  let entries = [];
  let persistTimer;
  function persistTranscript(immediate) {
    clearTimeout(persistTimer);
    if (!activeId) return;
    // Bind the target id now: a pending write must never land on a session the
    // user switched to in the meantime.
    const targetId = activeId;
    const snapshot = entries;
    const write = () => {
      const trimmed = snapshot.slice(-MAX_ENTRIES).map(({ node, ...e }) => (
        e.k === 'assistant' || e.k === 'user' ? { ...e, text: (e.text || '').slice(-MAX_TEXT) } : e
      ));
      saveJson(STORE.transcript(targetId), trimmed);
    };
    if (immediate) write(); else persistTimer = setTimeout(write, 400);
  }

  // ---------- rendering ----------
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // Deliberately tiny: fenced code, inline code, bold. Everything is escaped first.
  function renderMarkdown(raw) {
    const parts = String(raw || '').split('```');
    return parts.map((part, index) => {
      if (index % 2 === 1) {
        const newline = part.indexOf('\n');
        const lang = newline >= 0 ? part.slice(0, newline).trim() : '';
        const code = newline >= 0 ? part.slice(newline + 1) : part;
        return '<pre><code' + (lang ? ' class="lang-' + escapeHtml(lang) + '"' : '') + '>' + escapeHtml(code.replace(/\n$/, '')) + '</code></pre>';
      }
      const html = escapeHtml(part)
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
      return html.split(/\n{2,}/).filter((p) => p.trim()).map((p) => '<p>' + p.replace(/^\n+|\n+$/g, '') + '</p>').join('');
    }).join('');
  }

  function scrollToEnd() { scroller.scrollTop = scroller.scrollHeight; }
  function nearBottom() { return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120; }

  const CHIPS = ['列出当前目录的文件', '解释这个仓库的结构', '写一个 Python 脚本统计文件行数'];
  function renderHero() {
    const hero = document.createElement('div');
    hero.className = 'hero';
    hero.id = 'hero';
    hero.innerHTML = '<h1>有什么可以帮你？</h1><p>Pi 会在你的 User VM 中直接执行任务。</p><div class="chips"></div>';
    const chips = hero.querySelector('.chips');
    for (const text of CHIPS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = text;
      chip.addEventListener('click', () => { promptBox.value = text; promptBox.focus(); autoGrow(); });
      chips.appendChild(chip);
    }
    thread.appendChild(hero);
  }
  function removeHero() { const hero = $('#hero'); if (hero) hero.remove(); }

  function renderEntry(entry) {
    removeHero();
    let node;
    if (entry.k === 'user') {
      node = document.createElement('div');
      node.className = 'msg user';
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = entry.text;
      node.appendChild(bubble);
    } else if (entry.k === 'assistant') {
      node = document.createElement('div');
      node.className = 'msg assistant';
      const body = document.createElement('div');
      body.className = 'body';
      body.innerHTML = renderMarkdown(entry.text);
      node.appendChild(body);
    } else if (entry.k === 'tool') {
      node = document.createElement('details');
      node.className = 'tool' + (entry.done ? (entry.error ? ' error' : '') : ' running');
      node.innerHTML = '<summary><span class="chev">▸</span><span class="name"></span><span class="arg"></span><span class="state"></span></summary><pre></pre>';
      node.querySelector('.name').textContent = entry.name || 'tool';
      node.querySelector('.arg').textContent = entry.arg || '';
      node.querySelector('.state').textContent = entry.done ? (entry.error ? '失败' : '完成') : '运行中';
      node.querySelector('pre').textContent = entry.result || (entry.done ? '' : '…');
    } else {
      node = document.createElement('div');
      node.className = 'note' + (entry.failure ? ' failure' : '');
      node.textContent = entry.text;
    }
    entry.node = node;
    thread.appendChild(node);
    scrollToEnd();
    return node;
  }

  function updateAssistantNode(entry) {
    if (!entry.node) return;
    const stick = nearBottom();
    entry.node.querySelector('.body').innerHTML = renderMarkdown(entry.text);
    if (stick) scrollToEnd();
  }

  function updateToolNode(entry) {
    if (!entry.node) return;
    entry.node.className = 'tool' + (entry.done ? (entry.error ? ' error' : '') : ' running');
    entry.node.querySelector('.state').textContent = entry.done ? (entry.error ? '失败' : '完成') : '运行中';
    entry.node.querySelector('pre').textContent = entry.result || '';
  }

  let thinkingNode;
  function showThinking(show) {
    if (show && !thinkingNode) {
      thinkingNode = document.createElement('div');
      thinkingNode.className = 'thinking';
      thinkingNode.innerHTML = '<span class="dots"><span></span><span></span><span></span></span><span>Pi 正在思考…</span>';
      thread.appendChild(thinkingNode);
      scrollToEnd();
    } else if (!show && thinkingNode) {
      thinkingNode.remove();
      thinkingNode = undefined;
    }
  }

  function renderThread() {
    thread.innerHTML = '';
    thinkingNode = undefined;
    if (entries.length === 0) renderHero();
    for (const entry of entries) renderEntry(entry);
    scrollToEnd();
  }

  function renderSessionList() {
    sessionList.innerHTML = '';
    if (sessions.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty-list';
      empty.textContent = '还没有对话';
      sessionList.appendChild(empty);
      return;
    }
    for (const session of sessions) {
      const item = document.createElement('li');
      item.className = 'session-item' + (session.id === activeId ? ' active' : '');
      item.setAttribute('role', 'button');
      item.tabIndex = 0;
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = session.title || '新对话';
      item.appendChild(title);
      if (session.id === activeId && streaming) {
        const running = document.createElement('span');
        running.className = 'running';
        item.appendChild(running);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.title = '从列表移除（Host 上的会话不受影响）';
      remove.setAttribute('aria-label', '移除对话');
      remove.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
      remove.addEventListener('click', (event) => { event.stopPropagation(); removeSession(session.id); });
      item.appendChild(remove);
      const open = () => { switchSession(session.id); closeSidebarOnMobile(); };
      item.addEventListener('click', open);
      item.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
      sessionList.appendChild(item);
    }
  }

  function renderHeader() {
    const entry = activeId ? sessionEntry(activeId) : undefined;
    titleEl.textContent = entry && entry.title ? entry.title : '新对话';
    sessionMeta.textContent = activeId ? activeId.slice(0, 8) : '';
    document.title = (entry && entry.title ? entry.title + ' · ' : '') + 'PI Coffee';
    topbarState.innerHTML = streaming ? '<span class="dot busy"></span>Pi 正在工作…' : '';
  }

  // ---------- connection state ----------
  let socket;
  let reconnectTimer;
  let streaming = false;
  let connected = false;
  let requestNumber = 0;
  let currentAssistant;
  const openTools = new Map();
  let lastTool;

  function setConnection(text, kind) {
    statusText.textContent = text;
    dot.className = 'dot' + (kind ? ' ' + kind : '');
    connected = kind === 'ready' || kind === 'busy';
    refreshComposer();
  }

  function setStreaming(active) {
    if (streaming === active) return;
    streaming = active;
    if (!active) { currentAssistant = undefined; showThinking(false); }
    refreshComposer();
    renderHeader();
    renderSessionList();
  }

  function refreshComposer() {
    sendBtn.disabled = !connected || streaming || promptBox.value.trim().length === 0;
    stopBtn.classList.toggle('hidden', !(connected && streaming));
    sendBtn.classList.toggle('hidden', connected && streaming);
    if (connected) setConnectionLabel();
  }
  function setConnectionLabel() {
    statusText.textContent = streaming ? 'Pi 正在工作…' : '已连接';
    dot.className = 'dot ' + (streaming ? 'busy' : 'ready');
  }

  function connect() {
    clearTimeout(reconnectTimer);
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      try { socket.close(); } catch { /* ignore */ }
    }
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(scheme + '//' + location.host + '/ws');
    socket = ws;
    setConnection('连接中…');
    ws.onopen = () => {
      const frame = { v: 1, type: 'open' };
      const entry = activeId ? sessionEntry(activeId) : undefined;
      if (entry) {
        frame.sessionId = entry.id;
        if (entry.cursor > 0) frame.after = entry.cursor;
      }
      ws.send(JSON.stringify(frame));
    };
    ws.onmessage = (event) => {
      let frame;
      try { frame = JSON.parse(event.data); } catch { return; }
      handleFrame(frame, ws);
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      setConnection('连接断开，重连中…（Host 上的任务不会被打断）', 'error');
      reconnectTimer = setTimeout(connect, 1200);
    };
    ws.onerror = () => { if (socket === ws) setConnection('连接错误', 'error'); };
  }

  function handleFrame(frame, ws) {
    if (frame.type === 'opened') {
      if (!activeId || activeId !== frame.sessionId) {
        // A brand-new Host session: register it locally.
        activeId = frame.sessionId;
        if (!sessionEntry(activeId)) sessions.unshift({ id: activeId, title: '', updatedAt: Date.now(), cursor: 0 });
        persistSessions();
      }
      touchSession(activeId, { cursor: Math.max(sessionEntry(activeId).cursor || 0, frame.cursor || 0) });
      setConnection('已连接', 'ready');
      // The Host owns the run: after a reload it may still be streaming.
      const busy = Boolean(frame.state && frame.state.isStreaming);
      setStreaming(busy);
      if (busy) showThinking(true);
      renderHeader();
      renderSessionList();
      return;
    }
    if (frame.type === 'resync_required') {
      pushEntry({ k: 'note', text: '本地进度已过期（Host 保留 ' + frame.oldestCursor + '…' + frame.newestCursor + '）；更早的输出不再补放，新消息将继续显示。' });
      touchSession(activeId, { cursor: frame.newestCursor });
      return;
    }
    if (frame.type === 'event') {
      if (activeId) touchSession(activeId, { cursor: Math.max(sessionEntry(activeId).cursor || 0, frame.cursor || 0) });
      handleEvent(frame.event || {});
      return;
    }
    if (frame.type === 'error') {
      pushEntry({ k: 'note', failure: true, text: '错误（' + frame.code + '）：' + frame.message });
      // A rejected prompt must not leave the composer locked forever.
      setStreaming(frame.code === 'busy');
      if (frame.fatal) ws.close();
    }
  }

  function handleEvent(event) {
    // Pi RPC extensions (including the Harness /harness command) surface
    // fire-and-forget notifications as extension_ui_request frames. They are
    // informational only; dialog requests remain a future explicit seam.
    if (event.type === 'extension_ui_request' && event.method === 'notify') {
      pushEntry({ k: 'note', failure: event.notifyType === 'error', text: String(event.message || '') });
      return;
    }
    if (event.type === 'agent_start') {
      setStreaming(true);
      showThinking(true);
      currentAssistant = undefined;
      return;
    }
    const delta = event.assistantMessageEvent;
    if (delta && delta.type === 'thinking_delta') {
      showThinking(true);
      return;
    }
    if (delta && delta.type === 'text_delta') {
      showThinking(false);
      if (!currentAssistant) currentAssistant = pushEntry({ k: 'assistant', text: '' });
      currentAssistant.text += delta.delta || '';
      updateAssistantNode(currentAssistant);
      persistTranscript(false);
      return;
    }
    if (event.type === 'tool_execution_start') {
      showThinking(false);
      currentAssistant = undefined;
      const entry = pushEntry({ k: 'tool', name: event.toolName, arg: summarizeArgs(event.args), result: '', done: false, error: false });
      if (event.toolCallId) openTools.set(event.toolCallId, entry);
      lastTool = entry;
      return;
    }
    if (event.type === 'tool_execution_end') {
      const entry = (event.toolCallId && openTools.get(event.toolCallId)) || lastTool;
      if (entry) {
        entry.done = true;
        entry.error = Boolean(event.isError);
        entry.result = summarizeResult(event.result);
        updateToolNode(entry);
        if (event.toolCallId) openTools.delete(event.toolCallId);
      }
      showThinking(true);
      persistTranscript(false);
      return;
    }
    if (event.type === 'message_end' && event.message && event.message.stopReason === 'error') {
      pushEntry({ k: 'note', failure: true, text: '模型调用失败：' + (event.message.errorMessage || '未知错误') });
      return;
    }
    if (event.type === 'auto_retry_start') {
      pushEntry({ k: 'note', text: '上游暂时不可用，Pi 正在重试（' + event.attempt + '/' + event.maxAttempts + '）…' });
      return;
    }
    if (event.type === 'agent_settled') {
      setStreaming(false);
      for (const entry of openTools.values()) { entry.done = true; updateToolNode(entry); }
      openTools.clear();
      persistTranscript(true);
    }
  }

  function pushEntry(entry) {
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
    renderEntry(entry);
    return entry;
  }

  function summarizeArgs(args) {
    if (!args || typeof args !== 'object') return '';
    const text = args.command || args.path || args.file_path || args.pattern || args.query || JSON.stringify(args);
    return String(text).slice(0, 200);
  }
  function summarizeResult(result) {
    const block = result && Array.isArray(result.content) ? result.content.find((c) => c.type === 'text') : undefined;
    const text = block && block.text ? block.text : (typeof result === 'string' ? result : '');
    return text.length > 4000 ? text.slice(0, 4000) + '\n…' : text;
  }

  // ---------- session actions ----------
  function loadTranscript(id) {
    entries = id ? loadJson(STORE.transcript(id), []) : [];
    for (const entry of entries) delete entry.node;
    // Anything cached as running ended with a previous page; the live state
    // comes from the Host's opened frame.
    for (const entry of entries) if (entry.k === 'tool' && !entry.done) entry.done = true;
  }

  function switchSession(id) {
    if (id === activeId && socket && socket.readyState === WebSocket.OPEN) return;
    persistTranscript(true);
    activeId = id;
    persistSessions();
    streaming = false;
    currentAssistant = undefined;
    openTools.clear();
    loadTranscript(id);
    renderThread();
    renderHeader();
    renderSessionList();
    connect();
  }

  function newSession() {
    persistTranscript(true);
    activeId = null;
    persistSessions();
    streaming = false;
    currentAssistant = undefined;
    openTools.clear();
    entries = [];
    renderThread();
    renderHeader();
    renderSessionList();
    connect();
    promptBox.focus();
  }

  function removeSession(id) {
    sessions = sessions.filter((s) => s.id !== id);
    localStorage.removeItem(STORE.transcript(id));
    if (id === activeId) {
      persistSessions();
      newSession();
      return;
    }
    persistSessions();
    renderSessionList();
  }

  // ---------- composer ----------
  function autoGrow() {
    promptBox.style.height = 'auto';
    promptBox.style.height = Math.min(promptBox.scrollHeight, 220) + 'px';
  }
  promptBox.addEventListener('input', () => { autoGrow(); refreshComposer(); });
  promptBox.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      $('#composer').requestSubmit();
    }
  });
  $('#composer').addEventListener('submit', (event) => {
    event.preventDefault();
    const text = promptBox.value.trim();
    if (!text || !socket || socket.readyState !== WebSocket.OPEN || streaming) return;
    const requestId = 'web-' + Date.now() + '-' + (++requestNumber);
    pushEntry({ k: 'user', text });
    if (activeId) {
      const entry = sessionEntry(activeId);
      if (entry && !entry.title) touchSession(activeId, { title: text.replace(/\s+/g, ' ').slice(0, 40) });
      else touchSession(activeId, {});
    }
    persistTranscript(true);
    setStreaming(true);
    showThinking(true);
    socket.send(JSON.stringify({ v: 1, type: 'prompt', requestId, text }));
    promptBox.value = '';
    autoGrow();
    renderHeader();
    renderSessionList();
    promptBox.focus();
  });
  stopBtn.addEventListener('click', () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ v: 1, type: 'abort' }));
    pushEntry({ k: 'note', text: '已请求停止当前任务。' });
  });

  // ---------- sidebar ----------
  $('#new-task').addEventListener('click', () => { newSession(); closeSidebarOnMobile(); });
  $('#open-side').addEventListener('click', () => app.classList.add('side-open'));
  $('#close-side').addEventListener('click', () => app.classList.remove('side-open'));
  function closeSidebarOnMobile() { app.classList.remove('side-open'); }
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeSidebarOnMobile(); });

  // ---------- boot ----------
  if (activeId && !sessionEntry(activeId)) activeId = null;
  loadTranscript(activeId);
  renderThread();
  renderHeader();
  renderSessionList();
  autoGrow();
  connect();
})();
