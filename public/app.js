// PI Coffee browser shell — controller. The browser is a view: conversations,
// history, models and running state live on the Host in the User VM. The only
// local value is which conversation this browser last displayed.
import {
  activityGroup, assistantNode, el, fillToolCard, installCopyHandlers,
  noteNode, relativeTime, timeGroup, toolCard, toolResultDetails, toolResultText, updateActivity, updateAssistant, userBubble,
} from './render.js';

const ACTIVE_KEY = 'pi-coffee.active.v2';
const $ = (selector) => document.querySelector(selector);
const ui = {
  app: $('#app'), thread: $('#thread'), scroller: $('#scroller'), toBottom: $('#to-bottom'),
  prompt: $('#prompt'), send: $('#send'), stop: $('#stop'), status: $('#status'), dot: $('#dot'),
  title: $('#title'), topbarState: $('#topbar-state'), stats: $('#stats'), sessionMeta: $('#session-meta'),
  sessionList: $('#session-list'), search: $('#search'), queue: $('#queue'), slash: $('#slash'),
  attachments: $('#attachments'), attach: $('#attach'), file: $('#file'), hint: $('#hint'),
  model: $('#model'), thinking: $('#thinking'), modeWrap: $('#mode-wrap'), mode: $('#mode'),
  modal: $('#modal'), modalTitle: $('#modal-title'), modalText: $('#modal-text'), modalInput: $('#modal-input'),
  modalOk: $('#modal-ok'), modalCancel: $('#modal-cancel'), toast: $('#toast'),
};

// ---------- state ----------
let socket, reconnectTimer;
let connected = false, opened = false, streaming = false;
let activeId = localStorage.getItem(ACTIVE_KEY) || null;
let pendingOpenId = null, queuedPrompt = null;
let sessions = [], commands = [], models = null, statsCache = null;
let entries = [];
let requestNumber = 0;
let currentAssistant, currentActivity, activityCount = 0;
const openTools = new Map();
let lastTool, thinkingNode;
let lastUserText = '';
let attachments = [];
let renderTimer = null;

// ---------- helpers ----------
const scrollToEnd = () => { ui.scroller.scrollTop = ui.scroller.scrollHeight; };
const nearBottom = () => ui.scroller.scrollHeight - ui.scroller.scrollTop - ui.scroller.clientHeight < 120;
function toast(text, ms = 1800) {
  ui.toast.textContent = text;
  ui.toast.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ui.toast.classList.add('hidden'), ms);
}
function send(frame) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(frame));
  return true;
}
function requestId(prefix) { return prefix + '-' + Date.now() + '-' + (++requestNumber); }

// ---------- modal ----------
function askModal({ title, text, input, okLabel = '确定', danger = false }) {
  return new Promise((resolve) => {
    ui.modalTitle.textContent = title;
    ui.modalText.textContent = text || '';
    ui.modalText.classList.toggle('hidden', !text);
    ui.modalInput.classList.toggle('hidden', input === undefined);
    ui.modalOk.textContent = okLabel;
    ui.modalOk.classList.toggle('danger', danger);
    if (input !== undefined) ui.modalInput.value = input;
    ui.modal.classList.remove('hidden');
    const done = (value) => {
      ui.modal.classList.add('hidden');
      ui.modalOk.onclick = ui.modalCancel.onclick = null;
      ui.modalInput.onkeydown = null;
      resolve(value);
    };
    ui.modalOk.onclick = () => done(input !== undefined ? ui.modalInput.value.trim() : true);
    ui.modalCancel.onclick = () => done(null);
    ui.modalInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ui.modalOk.click(); } if (e.key === 'Escape') done(null); };
    setTimeout(() => (input !== undefined ? ui.modalInput : ui.modalOk).focus(), 0);
  });
}

// ---------- thread rendering ----------
function resetThread() {
  ui.thread.innerHTML = '';
  entries = [];
  currentAssistant = undefined;
  currentActivity = undefined;
  activityCount = 0;
  openTools.clear();
  lastTool = undefined;
  thinkingNode = undefined;
}

const CHIPS = ['列出当前目录的文件', '解释这个仓库的结构', '写一个 Python 脚本统计文件行数'];
function renderHero() {
  const hero = el('div', 'hero');
  hero.id = 'hero';
  hero.innerHTML = '<h1>有什么可以帮你？</h1><p>Pi 会在你的 User VM 中直接执行任务。</p><div class="chips"></div>';
  const chips = hero.querySelector('.chips');
  for (const text of CHIPS) {
    const chip = el('button', 'chip', text);
    chip.type = 'button';
    chip.addEventListener('click', () => { ui.prompt.value = text; ui.prompt.focus(); autoGrow(); refreshComposer(); });
    chips.appendChild(chip);
  }
  ui.thread.appendChild(hero);
}
const removeHero = () => { const hero = $('#hero'); if (hero) hero.remove(); };

function appendNode(node) {
  removeHero();
  const stick = nearBottom();
  ui.thread.appendChild(node);
  if (stick) scrollToEnd();
}

function pushUser(text, images, imageCount) {
  const entry = { k: 'user', text, images, imageCount };
  entry.node = userBubble(entry);
  entries.push(entry);
  appendNode(entry.node);
  currentActivity = undefined;
  return entry;
}
function pushAssistant(text) {
  const entry = { k: 'assistant', text: text || '' };
  entry.node = assistantNode(entry);
  entries.push(entry);
  appendNode(entry.node);
  // Once text arrives, the tool group for this run is closed visually.
  currentActivity = undefined;
  return entry;
}
function pushNote(text, failure) {
  const entry = { k: 'note', text, failure };
  entry.node = noteNode(entry);
  entries.push(entry);
  appendNode(entry.node);
  return entry;
}
function pushTool(tool) {
  const entry = { k: 'tool', ...tool };
  entry.node = toolCard(entry);
  entries.push(entry);
  if (!currentActivity) {
    currentActivity = activityGroup();
    activityCount = 0;
    appendNode(currentActivity);
  }
  activityCount += 1;
  currentActivity.querySelector('.activity-body').appendChild(entry.node);
  updateActivity(currentActivity, activityCount, !tool.done);
  if (nearBottom()) scrollToEnd();
  return entry;
}
function scheduleAssistantRender() {
  if (renderTimer) return;
  renderTimer = requestAnimationFrame(() => {
    renderTimer = null;
    if (!currentAssistant) return;
    const stick = nearBottom();
    updateAssistant(currentAssistant.node, currentAssistant.text);
    if (stick) scrollToEnd();
  });
}
function showThinking(show) {
  if (show && !thinkingNode) {
    thinkingNode = el('div', 'thinking');
    thinkingNode.innerHTML = '<span class="dots"><span></span><span></span><span></span></span><span>Pi 正在思考…</span>';
    appendNode(thinkingNode);
  } else if (!show && thinkingNode) {
    thinkingNode.remove();
    thinkingNode = undefined;
  }
}

function renderHistory(frame) {
  resetThread();
  if (frame.truncated) pushNote('更早的记录仍保存在 User VM 中，这里只显示最近的部分。');
  for (const item of frame.entries || []) {
    if (item.kind === 'user') { pushUser(item.text || '', undefined, item.imageCount); lastUserText = item.text || lastUserText; }
    else if (item.kind === 'assistant') pushAssistant(item.text || '');
    else if (item.kind === 'tool') pushTool({ name: item.name, args: item.args, result: item.result || '', done: true, error: Boolean(item.isError), details: item.diff ? { patch: item.diff } : undefined });
    else if (item.kind === 'note') pushNote(item.text || '');
  }
  // History groups are finished work: collapse them.
  for (const group of ui.thread.querySelectorAll('.activity')) { group.open = false; group.classList.remove('running'); }
  currentActivity = undefined;
  if (entries.length === 0) renderHero();
  if (streaming) showThinking(true);
  scrollToEnd();
  addRegenerateButton();
}

function addRegenerateButton() {
  ui.thread.querySelectorAll('.msg-tool.regen').forEach((b) => b.remove());
  const last = [...entries].reverse().find((e) => e.k === 'assistant');
  if (!last || !lastUserText || streaming) return;
  const tools = last.node.querySelector('.msg-tools');
  if (!tools) return;
  const regen = el('button', 'msg-tool regen', '重新生成');
  regen.type = 'button';
  regen.title = '用同一条消息再问一次';
  regen.addEventListener('click', () => { if (!streaming && opened) submitPrompt(lastUserText, []); });
  tools.appendChild(regen);
}

// ---------- sidebar ----------
function sessionTitle(session) {
  return (session && (session.name || session.preview)) || '新对话';
}
function renderSessionList() {
  ui.sessionList.innerHTML = '';
  const filter = ui.search.value.trim().toLowerCase();
  let known = sessions.slice();
  if (activeId && !known.some((s) => s.id === activeId)) known.unshift({ id: activeId, preview: '', running: streaming, messageCount: 0, updatedAt: new Date().toISOString() });
  if (filter) known = known.filter((s) => sessionTitle(s).toLowerCase().includes(filter) || (s.preview || '').toLowerCase().includes(filter));
  if (known.length === 0) {
    ui.sessionList.appendChild(el('li', 'empty-list', filter ? '没有匹配的对话' : '还没有对话'));
    return;
  }
  let group = null;
  for (const session of known) {
    const g = timeGroup(session.updatedAt);
    if (g !== group) { group = g; ui.sessionList.appendChild(el('li', 'side-label', g)); }
    const item = el('li', 'session-item' + (session.id === activeId ? ' active' : ''));
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
    const main = el('div', 'session-main');
    main.appendChild(el('span', 'title', sessionTitle(session)));
    const meta = el('span', 'meta', [relativeTime(session.updatedAt), session.messageCount ? session.messageCount + ' 条' : ''].filter(Boolean).join(' · '));
    main.appendChild(meta);
    item.appendChild(main);
    if (session.running || (session.id === activeId && streaming)) item.appendChild(el('span', 'running'));
    const menu = el('button', 'more', '⋯');
    menu.type = 'button';
    menu.title = '重命名 / 删除';
    menu.setAttribute('aria-label', '对话操作');
    menu.addEventListener('click', (event) => { event.stopPropagation(); openSessionMenu(session, menu); });
    item.appendChild(menu);
    const open = () => { switchSession(session.id); closeSidebarOnMobile(); };
    item.addEventListener('click', open);
    item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    ui.sessionList.appendChild(item);
  }
}

let menuNode;
function closeMenu() { if (menuNode) { menuNode.remove(); menuNode = undefined; } }
function openSessionMenu(session, anchor) {
  closeMenu();
  menuNode = el('div', 'popmenu');
  const rename = el('button', 'popitem', '重命名');
  rename.type = 'button';
  rename.addEventListener('click', async () => { closeMenu(); await renameSession(session); });
  const del = el('button', 'popitem danger', '删除');
  del.type = 'button';
  del.addEventListener('click', async () => { closeMenu(); await deleteSession(session); });
  menuNode.append(rename, del);
  document.body.appendChild(menuNode);
  const rect = anchor.getBoundingClientRect();
  menuNode.style.top = rect.bottom + 4 + 'px';
  menuNode.style.left = Math.min(rect.left, window.innerWidth - 160) + 'px';
}
document.addEventListener('click', (event) => { if (menuNode && !menuNode.contains(event.target)) closeMenu(); });

async function renameSession(session) {
  const name = await askModal({ title: '重命名对话', input: session.name || session.preview || '', okLabel: '保存' });
  if (name === null || name === '') return;
  send({ v: 1, type: 'rename_session', requestId: requestId('rename'), sessionId: session.id, name });
  toast('已重命名');
}
async function deleteSession(session) {
  const ok = await askModal({ title: '删除这个对话？', text: '会从 User VM 的会话存储中永久删除「' + sessionTitle(session) + '」，不可恢复。', okLabel: '删除', danger: true });
  if (!ok) return;
  send({ v: 1, type: 'delete_session', requestId: requestId('delete'), sessionId: session.id });
  if (session.id === activeId) newSession(false);
  toast('已删除');
}

function renderHeader() {
  const session = sessions.find((s) => s.id === activeId);
  const title = activeId ? sessionTitle(session) : '新对话';
  ui.title.textContent = title;
  ui.title.disabled = !activeId;
  ui.sessionMeta.textContent = activeId ? activeId.slice(0, 8) : '';
  document.title = (activeId && title !== '新对话' ? title + ' · ' : '') + 'PI Coffee';
  ui.topbarState.innerHTML = streaming ? '<span class="dot busy"></span>Pi 正在工作…' : '';
  renderStats();
}
function renderStats() {
  if (!statsCache || !activeId) { ui.stats.classList.add('hidden'); return; }
  const usage = statsCache.contextUsage;
  const pct = usage && typeof usage.percent === 'number' ? Math.round(usage.percent) + '%' : null;
  const cost = statsCache.cost ? '$' + statsCache.cost.toFixed(3) : null;
  const parts = [pct ? '上下文 ' + pct : null, cost].filter(Boolean);
  if (parts.length === 0) { ui.stats.classList.add('hidden'); return; }
  ui.stats.textContent = parts.join(' · ');
  ui.stats.classList.remove('hidden');
  ui.stats.classList.toggle('warn', usage && typeof usage.percent === 'number' && usage.percent >= 75);
}
ui.stats.addEventListener('click', async () => {
  if (!opened || streaming) return;
  const ok = await askModal({ title: '压缩上下文？', text: 'Pi 会把较早的对话总结为摘要以释放上下文窗口。记录本身不会丢失。', okLabel: '压缩' });
  if (!ok) return;
  send({ v: 1, type: 'compact', requestId: requestId('compact') });
  toast('正在压缩…');
});
ui.title.addEventListener('click', () => {
  const session = sessions.find((s) => s.id === activeId);
  if (session) renameSession(session);
});

// ---------- connection ----------
function setConnection(text, kind) {
  ui.status.textContent = text;
  ui.dot.className = 'dot' + (kind ? ' ' + kind : '');
  connected = kind === 'ready' || kind === 'busy';
  refreshComposer();
}
function setStreaming(active) {
  if (streaming === active) return;
  streaming = active;
  if (!active) {
    currentAssistant = undefined;
    showThinking(false);
    if (currentActivity) { updateActivity(currentActivity, activityCount, false); currentActivity.open = false; }
    currentActivity = undefined;
    addRegenerateButton();
  } else {
    ui.thread.querySelectorAll('.msg-tool.regen').forEach((b) => b.remove());
  }
  refreshComposer();
  renderHeader();
  renderSessionList();
}
function refreshComposer() {
  const hasText = ui.prompt.value.trim().length > 0 || attachments.length > 0;
  ui.send.disabled = !connected || !hasText;
  ui.stop.classList.toggle('hidden', !(connected && streaming));
  ui.modeWrap.classList.toggle('hidden', !(connected && streaming));
  ui.send.title = streaming ? (ui.mode.value === 'steer' ? '插话：在当前工具调用后打断' : '排队：等这轮结束后发送') : '发送';
  ui.hint.textContent = streaming ? '运行中 · Enter 将消息' + (ui.mode.value === 'steer' ? '插话' : '排队') : 'Enter 发送 · Shift+Enter 换行';
  if (connected) {
    ui.status.textContent = streaming ? 'Pi 正在工作…' : '已连接';
    ui.dot.className = 'dot ' + (streaming ? 'busy' : 'ready');
  }
}

function connect() {
  clearTimeout(reconnectTimer);
  if (socket) { socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null; try { socket.close(); } catch { /* ignore */ } }
  opened = false;
  pendingOpenId = null;
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(scheme + '//' + location.host + '/ws');
  socket = ws;
  setConnection('连接中…');
  ws.onopen = () => {
    setConnection('已连接', 'ready');
    send({ v: 1, type: 'list_sessions' });
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
function openSession(id) {
  if (opened || pendingOpenId) { connect(); return; }
  pendingOpenId = id || 'new';
  const frame = { v: 1, type: 'open' };
  if (id) frame.sessionId = id;
  send(frame);
}
function afterOpened() {
  send({ v: 1, type: 'get_models' });
  send({ v: 1, type: 'get_commands' });
  send({ v: 1, type: 'get_stats' });
}

function handleFrame(frame, ws) {
  switch (frame.type) {
    case 'sessions':
      sessions = Array.isArray(frame.sessions) ? frame.sessions : [];
      renderSessionList();
      renderHeader();
      return;
    case 'opened':
      opened = true;
      pendingOpenId = null;
      activeId = frame.sessionId;
      localStorage.setItem(ACTIVE_KEY, activeId);
      statsCache = null;
      resetThread();
      streaming = false;
      setStreaming(Boolean(frame.state && frame.state.isStreaming));
      renderHeader();
      renderSessionList();
      afterOpened();
      return;
    case 'history':
      if (frame.sessionId !== activeId) return;
      renderHistory(frame);
      if (queuedPrompt !== null) { const q = queuedPrompt; queuedPrompt = null; submitPrompt(q.text, q.images); }
      return;
    case 'models':
      models = frame;
      renderModels();
      return;
    case 'commands':
      commands = Array.isArray(frame.commands) ? frame.commands : [];
      return;
    case 'stats':
      if (frame.sessionId === activeId) { statsCache = frame.stats; renderStats(); }
      return;
    case 'ack':
      if (frame.operation === 'steer' || frame.operation === 'follow_up') toast(frame.operation === 'steer' ? '已插话' : '已排队');
      if (frame.operation === 'set_model' || frame.operation === 'set_thinking') send({ v: 1, type: 'get_models' });
      if (frame.operation === 'compact') setTimeout(() => send({ v: 1, type: 'get_stats' }), 800);
      return;
    case 'resync_required':
      pushNote('正在运行的这一段输出有部分未能补放；已完成的消息以上方历史为准。');
      return;
    case 'event':
      handleEvent(frame.event || {});
      return;
    case 'error':
      pushNote('错误（' + frame.code + '）：' + frame.message, true);
      setStreaming(frame.code === 'busy');
      if (frame.code === 'not_open' || frame.code === 'already_open') pendingOpenId = null;
      if (queuedPrompt !== null && frame.code !== 'busy') { ui.prompt.value = queuedPrompt.text; attachments = queuedPrompt.images || []; renderAttachments(); queuedPrompt = null; autoGrow(); refreshComposer(); }
      if (frame.fatal) ws.close();
      return;
    default:
      return;
  }
}

function handleEvent(event) {
  const type = event.type;
  if (type === 'agent_start') { setStreaming(true); showThinking(true); currentAssistant = undefined; return; }
  const delta = event.assistantMessageEvent;
  if (delta && delta.type === 'thinking_delta') { showThinking(true); return; }
  if (delta && delta.type === 'text_delta') {
    showThinking(false);
    if (!currentAssistant) currentAssistant = pushAssistant('');
    currentAssistant.text += delta.delta || '';
    scheduleAssistantRender();
    return;
  }
  if (type === 'tool_execution_start') {
    showThinking(false);
    currentAssistant = undefined;
    const entry = pushTool({ name: event.toolName, args: event.args, result: '', done: false, error: false });
    if (event.toolCallId) openTools.set(event.toolCallId, entry);
    lastTool = entry;
    return;
  }
  if (type === 'tool_execution_end') {
    const entry = (event.toolCallId && openTools.get(event.toolCallId)) || lastTool;
    if (entry) {
      entry.done = true;
      entry.error = Boolean(event.isError);
      entry.result = toolResultText(event.result);
      entry.details = toolResultDetails(event.result);
      fillToolCard(entry.node, entry);
      if (event.toolCallId) openTools.delete(event.toolCallId);
    }
    if (currentActivity) updateActivity(currentActivity, activityCount, openTools.size > 0);
    showThinking(true);
    return;
  }
  if (type === 'queue_update') { renderQueue(event); return; }
  if (type === 'extension_ui_request' && event.method === 'notify') { pushNote(String(event.message || ''), event.notifyType === 'error'); return; }
  if (type === 'message_end' && event.message && event.message.stopReason === 'error') { pushNote('模型调用失败：' + (event.message.errorMessage || '未知错误'), true); return; }
  if (type === 'message_end' && event.message && event.message.role === 'custom' && event.message.display === true) {
    const text = customMessageText(event.message.content);
    if (text.trim()) { currentAssistant = undefined; showThinking(false); pushNote(text.slice(0, 8000)); }
    return;
  }
  if (type === 'auto_retry_start') { pushNote('上游暂时不可用，Pi 正在重试（' + event.attempt + '/' + event.maxAttempts + '）…'); return; }
  if (type === 'compaction_end') { pushNote('已压缩上下文。'); send({ v: 1, type: 'get_stats' }); return; }
  if (type === 'agent_settled') {
    setStreaming(false);
    for (const entry of openTools.values()) { entry.done = true; fillToolCard(entry.node, entry); }
    openTools.clear();
    renderQueue({ steering: [], followUp: [] });
    send({ v: 1, type: 'get_stats' });
  }
}
function customMessageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((p) => p && p.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('\n');
}

// ---------- queue strip ----------
function renderQueue(event) {
  const items = [...(event.steering || []).map((t) => ({ kind: '插话', t })), ...(event.followUp || []).map((t) => ({ kind: '排队', t }))];
  ui.queue.innerHTML = '';
  ui.queue.classList.toggle('hidden', items.length === 0);
  for (const item of items) {
    const row = el('div', 'queue-item');
    row.appendChild(el('span', 'queue-kind', item.kind));
    row.appendChild(el('span', 'queue-text', item.t));
    ui.queue.appendChild(row);
  }
}

// ---------- models ----------
function renderModels() {
  if (!models) return;
  ui.model.innerHTML = '';
  for (const m of models.models || []) {
    const option = document.createElement('option');
    option.value = m.provider + '/' + m.id;
    option.textContent = m.id + (m.provider && (models.models || []).some((o) => o.id === m.id && o.provider !== m.provider) ? ' (' + m.provider + ')' : '');
    ui.model.appendChild(option);
  }
  if (models.current) ui.model.value = models.current.provider + '/' + models.current.id;
  ui.thinking.innerHTML = '';
  for (const level of models.thinkingLevels || []) {
    const option = document.createElement('option');
    option.value = level;
    option.textContent = '思考：' + level;
    ui.thinking.appendChild(option);
  }
  ui.thinking.value = models.thinkingLevel || '';
}
ui.model.addEventListener('change', () => {
  const [provider, ...rest] = ui.model.value.split('/');
  if (!provider || rest.length === 0) return;
  send({ v: 1, type: 'set_model', requestId: requestId('model'), provider, id: rest.join('/') });
});
ui.thinking.addEventListener('change', () => {
  if (ui.thinking.value) send({ v: 1, type: 'set_thinking', requestId: requestId('thinking'), level: ui.thinking.value });
});

// ---------- slash commands ----------
let slashIndex = 0;
function slashItems() {
  const value = ui.prompt.value;
  if (!value.startsWith('/') || /\s/.test(value)) return [];
  const query = value.slice(1).toLowerCase();
  return commands.filter((c) => c.name.toLowerCase().startsWith(query)).slice(0, 8);
}
function renderSlash() {
  const items = slashItems();
  ui.slash.innerHTML = '';
  ui.slash.classList.toggle('hidden', items.length === 0);
  if (items.length === 0) return;
  slashIndex = Math.min(slashIndex, items.length - 1);
  items.forEach((c, index) => {
    const row = el('div', 'slash-item' + (index === slashIndex ? ' active' : ''));
    row.setAttribute('role', 'option');
    row.innerHTML = '<span class="slash-name">/' + c.name + '</span><span class="slash-desc"></span><span class="slash-src"></span>';
    row.querySelector('.slash-desc').textContent = c.description || '';
    row.querySelector('.slash-src').textContent = c.source === 'extension' ? '扩展' : c.source === 'skill' ? '技能' : '模板';
    row.addEventListener('mousedown', (e) => { e.preventDefault(); applySlash(c); });
    ui.slash.appendChild(row);
  });
}
function applySlash(command) {
  ui.prompt.value = '/' + command.name + ' ';
  ui.slash.classList.add('hidden');
  ui.prompt.focus();
  autoGrow();
  refreshComposer();
}

// ---------- attachments ----------
const MAX_IMAGE_BYTES = 600 * 1024;
async function addFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    if (attachments.length >= 8) { toast('最多 8 张图片'); break; }
    try {
      attachments.push(await encodeImage(file));
    } catch {
      toast('无法读取图片');
    }
  }
  renderAttachments();
  refreshComposer();
}
function encodeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        if (file.size <= MAX_IMAGE_BYTES && scale === 1) {
          resolve({ type: 'image', mimeType: file.type, data: dataUrl.split(',')[1] });
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const out = canvas.toDataURL('image/jpeg', 0.85);
        resolve({ type: 'image', mimeType: 'image/jpeg', data: out.split(',')[1] });
      };
      img.onerror = () => reject(new Error('decode failed'));
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}
function renderAttachments() {
  ui.attachments.innerHTML = '';
  ui.attachments.classList.toggle('hidden', attachments.length === 0);
  attachments.forEach((image, index) => {
    const wrap = el('div', 'attachment');
    const img = document.createElement('img');
    img.src = 'data:' + image.mimeType + ';base64,' + image.data;
    img.alt = '附图 ' + (index + 1);
    const remove = el('button', 'attachment-remove', '×');
    remove.type = 'button';
    remove.title = '移除';
    remove.addEventListener('click', () => { attachments.splice(index, 1); renderAttachments(); refreshComposer(); });
    wrap.append(img, remove);
    ui.attachments.appendChild(wrap);
  });
}
ui.attach.addEventListener('click', () => ui.file.click());
ui.file.addEventListener('change', () => { addFiles([...ui.file.files]); ui.file.value = ''; });
ui.prompt.addEventListener('paste', (event) => {
  const files = [...(event.clipboardData?.items || [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
  if (files.length) { event.preventDefault(); addFiles(files); }
});
for (const type of ['dragenter', 'dragover']) document.addEventListener(type, (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); ui.app.classList.add('dragging'); } });
for (const type of ['dragleave', 'drop']) document.addEventListener(type, (e) => { if (type === 'drop') { e.preventDefault(); addFiles([...(e.dataTransfer?.files || [])]); } ui.app.classList.remove('dragging'); });

// ---------- composer ----------
function autoGrow() {
  ui.prompt.style.height = 'auto';
  ui.prompt.style.height = Math.min(ui.prompt.scrollHeight, 220) + 'px';
}
ui.prompt.addEventListener('input', () => { autoGrow(); refreshComposer(); slashIndex = 0; renderSlash(); });
ui.prompt.addEventListener('keydown', (event) => {
  const slashOpen = !ui.slash.classList.contains('hidden');
  if (slashOpen) {
    const items = slashItems();
    if (event.key === 'ArrowDown') { event.preventDefault(); slashIndex = (slashIndex + 1) % items.length; renderSlash(); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); slashIndex = (slashIndex - 1 + items.length) % items.length; renderSlash(); return; }
    if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) { event.preventDefault(); applySlash(items[slashIndex]); return; }
    if (event.key === 'Escape') { ui.slash.classList.add('hidden'); return; }
  }
  if (event.key === 'ArrowUp' && ui.prompt.value === '' && lastUserText) { event.preventDefault(); ui.prompt.value = lastUserText; autoGrow(); refreshComposer(); return; }
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('#composer').requestSubmit(); }
});
ui.mode.addEventListener('change', refreshComposer);
$('#composer').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = ui.prompt.value.trim();
  if ((!text && attachments.length === 0) || !socket || socket.readyState !== WebSocket.OPEN) return;
  const images = attachments.slice();
  if (!opened) {
    queuedPrompt = { text, images };
    attachments = [];
    renderAttachments();
    openSession(null);
    ui.prompt.value = '';
    autoGrow();
    setStreaming(true);
    showThinking(true);
    return;
  }
  submitPrompt(text || '（图片）', images);
});
function submitPrompt(text, images) {
  const mode = streaming ? ui.mode.value : 'prompt';
  const frame = { v: 1, type: 'prompt', requestId: requestId('web'), text };
  if (images && images.length) frame.images = images;
  if (mode !== 'prompt') frame.mode = mode;
  if (mode === 'prompt') {
    pushUser(text, images);
    lastUserText = text;
    setStreaming(true);
    showThinking(true);
  }
  send(frame);
  attachments = [];
  renderAttachments();
  ui.prompt.value = '';
  ui.slash.classList.add('hidden');
  autoGrow();
  refreshComposer();
  renderHeader();
  ui.prompt.focus();
}
ui.stop.addEventListener('click', () => { if (opened) { send({ v: 1, type: 'abort' }); pushNote('已请求停止当前任务。'); } });

// ---------- session actions ----------
function switchSession(id) {
  if (id === activeId && opened) return;
  activeId = id;
  localStorage.setItem(ACTIVE_KEY, id);
  streaming = false;
  statsCache = null;
  resetThread();
  renderHeader();
  renderSessionList();
  connect();
}
function newSession(focus = true) {
  activeId = null;
  localStorage.removeItem(ACTIVE_KEY);
  streaming = false;
  statsCache = null;
  resetThread();
  renderHero();
  renderHeader();
  renderSessionList();
  connect();
  if (focus) ui.prompt.focus();
}

// ---------- sidebar / global ----------
$('#new-task').addEventListener('click', () => { newSession(); closeSidebarOnMobile(); });
$('#open-side').addEventListener('click', () => ui.app.classList.add('side-open'));
$('#close-side').addEventListener('click', () => ui.app.classList.remove('side-open'));
function closeSidebarOnMobile() { ui.app.classList.remove('side-open'); }
ui.search.addEventListener('input', renderSessionList);
ui.scroller.addEventListener('scroll', () => ui.toBottom.classList.toggle('hidden', nearBottom()));
ui.toBottom.addEventListener('click', scrollToEnd);
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); newSession(); return; }
  if (event.key === 'Escape') {
    if (!ui.modal.classList.contains('hidden')) { ui.modalCancel.click(); return; }
    if (menuNode) { closeMenu(); return; }
    if (!ui.slash.classList.contains('hidden')) { ui.slash.classList.add('hidden'); return; }
    closeSidebarOnMobile();
    if (streaming && opened && document.activeElement !== ui.prompt) { send({ v: 1, type: 'abort' }); pushNote('已请求停止当前任务。'); }
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && socket && socket.readyState === WebSocket.OPEN) send({ v: 1, type: 'list_sessions' });
});
installCopyHandlers(ui.thread);

// ---------- boot ----------
resetThread();
renderHero();
renderHeader();
renderSessionList();
autoGrow();
refreshComposer();
connect();
