(() => {
  'use strict';

  // The browser is a view. Conversations, their history and their running
  // state live on the Host in the User VM (Pi's own session store). The only
  // thing kept here is which conversation this browser last looked at.
  const ACTIVE_KEY = 'pi-coffee.active.v2';

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

  // ---------- state ----------
  let socket;
  let reconnectTimer;
  let connected = false;
  let opened = false;            // this socket has an open Session on the Host
  let activeId = localStorage.getItem(ACTIVE_KEY) || null;
  let pendingOpenId = null;      // session we asked the Host to open on this socket
  let queuedPrompt = null;       // first message typed before a Session existed
  let sessions = [];             // SessionSummary[] from the Host
  let entries = [];              // rendered entries of the active conversation
  let streaming = false;
  let requestNumber = 0;
  let currentAssistant;
  const openTools = new Map();
  let lastTool;
  let thinkingNode;

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
      chip.addEventListener('click', () => { promptBox.value = text; promptBox.focus(); autoGrow(); refreshComposer(); });
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
      bubble.textContent = entry.text + (entry.imageCount ? '\n[' + entry.imageCount + ' 张图片]' : '');
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

  function resetThread() {
    thread.innerHTML = '';
    thinkingNode = undefined;
    entries = [];
    currentAssistant = undefined;
    openTools.clear();
    lastTool = undefined;
  }

  function pushEntry(entry) {
    entries.push(entry);
    renderEntry(entry);
    scrollToEnd();
    return entry;
  }

  function sessionTitle(session) {
    if (!session) return '新对话';
    return session.name || session.preview || '新对话';
  }

  function renderSessionList() {
    sessionList.innerHTML = '';
    const known = sessions.slice();
    if (activeId && !known.some((s) => s.id === activeId)) {
      known.unshift({ id: activeId, preview: '', running: streaming, messageCount: 0 });
    }
    if (known.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty-list';
      empty.textContent = '还没有对话';
      sessionList.appendChild(empty);
      return;
    }
    for (const session of known) {
      const item = document.createElement('li');
      item.className = 'session-item' + (session.id === activeId ? ' active' : '');
      item.setAttribute('role', 'button');
      item.tabIndex = 0;
      item.title = (session.updatedAt ? new Date(session.updatedAt).toLocaleString() + ' · ' : '') + (session.messageCount || 0) + ' 条消息';
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = sessionTitle(session);
      item.appendChild(title);
      if (session.running || (session.id === activeId && streaming)) {
        const running = document.createElement('span');
        running.className = 'running';
        item.appendChild(running);
      }
      const open = () => { switchSession(session.id); closeSidebarOnMobile(); };
      item.addEventListener('click', open);
      item.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
      sessionList.appendChild(item);
    }
  }

  function renderHeader() {
    const session = sessions.find((s) => s.id === activeId);
    const title = activeId ? sessionTitle(session) : '新对话';
    titleEl.textContent = title;
    sessionMeta.textContent = activeId ? activeId.slice(0, 8) : '';
    document.title = (activeId && title !== '新对话' ? title + ' · ' : '') + 'PI Coffee';
    topbarState.innerHTML = streaming ? '<span class="dot busy"></span>Pi 正在工作…' : '';
  }

  // ---------- connection ----------
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
    if (connected) {
      statusText.textContent = streaming ? 'Pi 正在工作…' : '已连接';
      dot.className = 'dot ' + (streaming ? 'busy' : 'ready');
    }
  }

  function send(frame) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(frame));
    return true;
  }

  function connect() {
    clearTimeout(reconnectTimer);
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      try { socket.close(); } catch { /* ignore */ }
    }
    opened = false;
    pendingOpenId = null;
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(scheme + '//' + location.host + '/ws');
    socket = ws;
    setConnection('连接中…');
    ws.onopen = () => {
      setConnection('已连接', 'ready');
      send({ v: 1, type: 'list_sessions' });
      // Resume the conversation this browser last looked at; otherwise stay on
      // the empty state until the user sends something or picks one.
      if (activeId) openSession(activeId);
    };
    ws.onmessage = (event) => {
      let frame;
      try { frame = JSON.parse(event.data); } catch { return; }
      handleFrame(frame, ws);
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      opened = false;
      setConnection('连接断开，重连中…（Host 上的任务不会被打断）', 'error');
      reconnectTimer = setTimeout(connect, 1200);
    };
    ws.onerror = () => { if (socket === ws) setConnection('连接错误', 'error'); };
  }

  // One socket carries one Host Session. Switching conversations reconnects.
  function openSession(id) {
    if (opened || pendingOpenId) { connect(); return; }
    pendingOpenId = id || 'new';
    const frame = { v: 1, type: 'open' };
    if (id) frame.sessionId = id;
    send(frame);
  }

  function handleFrame(frame, ws) {
    if (frame.type === 'sessions') {
      sessions = Array.isArray(frame.sessions) ? frame.sessions : [];
      renderSessionList();
      renderHeader();
      return;
    }
    if (frame.type === 'opened') {
      opened = true;
      pendingOpenId = null;
      activeId = frame.sessionId;
      localStorage.setItem(ACTIVE_KEY, activeId);
      resetThread();
      // The Host is the owner: after a reload it may still be streaming.
      const busy = Boolean(frame.state && frame.state.isStreaming);
      streaming = false;
      setStreaming(busy);
      renderHeader();
      renderSessionList();
      return;
    }
    if (frame.type === 'history') {
      if (frame.sessionId !== activeId) return;
      resetThread();
      for (const item of frame.entries || []) renderHistoryEntry(item);
      if (frame.truncated) {
        entries.unshift({ k: 'note', text: '更早的记录仍保存在 User VM 中，这里只显示最近的部分。' });
        thread.prepend(renderNoteNode(entries[0]));
      }
      if (entries.length === 0) renderHero();
      if (streaming) showThinking(true);
      scrollToEnd();
      // Flush the first message of a brand-new conversation now that the Host
      // has confirmed the Session.
      if (queuedPrompt !== null) {
        const text = queuedPrompt;
        queuedPrompt = null;
        submitPrompt(text);
      }
      return;
    }
    if (frame.type === 'resync_required') {
      pushEntry({ k: 'note', text: '正在运行的这一段输出有部分未能补放；已完成的消息以上方历史为准。' });
      return;
    }
    if (frame.type === 'event') {
      handleEvent(frame.event || {});
      return;
    }
    if (frame.type === 'error') {
      pushEntry({ k: 'note', failure: true, text: '错误（' + frame.code + '）：' + frame.message });
      // A rejected prompt must not leave the composer locked forever.
      setStreaming(frame.code === 'busy');
      if (frame.code === 'not_open' || frame.code === 'already_open') pendingOpenId = null;
      if (queuedPrompt !== null && frame.code !== 'busy') {
        promptBox.value = queuedPrompt;
        queuedPrompt = null;
        autoGrow();
        refreshComposer();
      }
      if (frame.fatal) ws.close();
    }
  }

  function renderNoteNode(entry) {
    const node = document.createElement('div');
    node.className = 'note';
    node.textContent = entry.text;
    entry.node = node;
    return node;
  }

  function renderHistoryEntry(item) {
    if (item.kind === 'user') {
      pushEntry({ k: 'user', text: item.text || '', imageCount: item.imageCount || 0 });
    } else if (item.kind === 'assistant') {
      pushEntry({ k: 'assistant', text: item.text || '' });
    } else if (item.kind === 'tool') {
      pushEntry({ k: 'tool', name: item.name, arg: summarizeArgs(item.args), result: item.result || '', done: true, error: Boolean(item.isError) });
    } else if (item.kind === 'note') {
      pushEntry({ k: 'note', text: item.text || '' });
    }
  }

  function handleEvent(event) {
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
      return;
    }
    // Pi RPC extensions (including the Harness /harness command) surface
    // fire-and-forget notifications as extension_ui_request frames. They are
    // informational only; dialog requests remain a future explicit seam.
    if (event.type === 'extension_ui_request' && event.method === 'notify') {
      pushEntry({ k: 'note', failure: event.notifyType === 'error', text: String(event.message || '') });
      return;
    }
    if (event.type === 'message_end' && event.message && event.message.stopReason === 'error') {
      pushEntry({ k: 'note', failure: true, text: '模型调用失败：' + (event.message.errorMessage || '未知错误') });
      return;
    }
    // Pi extensions can publish a visible custom message (for example a
    // foreground subagent result or a slash-command report). Hidden custom
    // messages are context-only and are not shown.
    if (event.type === 'message_end' && event.message && event.message.role === 'custom' && event.message.display === true) {
      const text = customMessageText(event.message.content);
      if (text.trim()) {
        currentAssistant = undefined;
        showThinking(false);
        pushEntry({ k: 'note', text: text.slice(0, 8000) });
      }
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
      // The store just gained messages; refresh titles/counts from the Host.
      send({ v: 1, type: 'list_sessions' });
    }
  }

  function customMessageText(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.filter((part) => part && part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n');
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
  function switchSession(id) {
    if (id === activeId && opened) return;
    activeId = id;
    localStorage.setItem(ACTIVE_KEY, id);
    streaming = false;
    resetThread();
    renderHeader();
    renderSessionList();
    // A socket owns one Host Session; reconnect and open the chosen one.
    connect();
  }

  function newSession() {
    activeId = null;
    localStorage.removeItem(ACTIVE_KEY);
    streaming = false;
    resetThread();
    renderHero();
    renderHeader();
    renderSessionList();
    connect();
    promptBox.focus();
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
    if (!opened) {
      // First message of a brand-new conversation: open a Session on the Host,
      // then send once `opened` arrives.
      queuedPrompt = text;
      openSession(null);
      promptBox.value = '';
      autoGrow();
      setStreaming(true);
      showThinking(true);
      return;
    }
    submitPrompt(text);
  });
  function submitPrompt(text) {
    const requestId = 'web-' + Date.now() + '-' + (++requestNumber);
    pushEntry({ k: 'user', text });
    setStreaming(true);
    showThinking(true);
    send({ v: 1, type: 'prompt', requestId, text });
    promptBox.value = '';
    autoGrow();
    renderHeader();
    promptBox.focus();
  }
  stopBtn.addEventListener('click', () => {
    if (!opened) return;
    send({ v: 1, type: 'abort' });
    pushEntry({ k: 'note', text: '已请求停止当前任务。' });
  });

  // ---------- sidebar ----------
  $('#new-task').addEventListener('click', () => { newSession(); closeSidebarOnMobile(); });
  $('#open-side').addEventListener('click', () => app.classList.add('side-open'));
  $('#close-side').addEventListener('click', () => app.classList.remove('side-open'));
  function closeSidebarOnMobile() { app.classList.remove('side-open'); }
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeSidebarOnMobile(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && socket && socket.readyState === WebSocket.OPEN) send({ v: 1, type: 'list_sessions' });
  });

  // ---------- boot ----------
  resetThread();
  renderHero();
  renderHeader();
  renderSessionList();
  autoGrow();
  connect();
})();
