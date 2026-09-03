// PI Coffee browser shell — controller. The browser is a view: conversations,
// history, models and running state live on the Host in the User VM. The only
// local value is which conversation this browser last displayed.
import {
  activityGroup, assistantNode, el, fillToolCard, formatBytes, installCopyHandlers,
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
  extStatus: $('#ext-status'), widgets: $('#widgets'),
  statsWrap: $('#stats-wrap'), statsPop: $('#stats-pop'), spPct: $('#sp-pct'), spFill: $('#sp-fill'), spWindow: $('#sp-window'),
  spBar: $('#sp-bar'), spLegend: $('#sp-legend'), spCost: $('#sp-cost'), spCompact: $('#sp-compact'),
  uiModal: $('#ui-modal'), uiTitle: $('#ui-title'), uiText: $('#ui-text'), uiOptions: $('#ui-options'), uiInput: $('#ui-input'),
  uiEditor: $('#ui-editor'), uiMeta: $('#ui-meta'), uiOk: $('#ui-ok'), uiNo: $('#ui-no'), uiCancel: $('#ui-cancel'),
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
let attachments = [];          // small inline images: { type, mimeType, data }
let uploads = [];              // files transferred straight to the User VM (ADR-0009)
let transfer = null;           // { url, scope, token, inbox, maxFileBytes, maxBatchBytes } from the Host
let filesAwaitingTransfer = []; // picked before the Session/transfer endpoint was known
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

function pushUser(text, images, imageCount, files) {
  const entry = { k: 'user', text, images, imageCount, files };
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
  addToolDownloadLink(entry);
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
  const raw = (session && (session.name || session.preview)) || '';
  // The preview is the first prompt as sent; drop the attachment listing we append.
  const cut = raw.indexOf('[已上传到工作目录的文件]');
  return (cut > 0 ? raw.slice(0, cut).trim() : raw) || '新对话';
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
function fmtTokens(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(n >= 100_000 ? 0 : 1) + 'K';
  return String(n);
}
function renderStats() {
  if (!statsCache || !activeId) { ui.stats.classList.add('hidden'); hideStatsPop(); return; }
  const usage = statsCache.contextUsage;
  const pct = usage && typeof usage.percent === 'number' ? usage.percent : null;
  const cost = statsCache.cost ? '$' + statsCache.cost.toFixed(3) : null;
  const parts = [pct !== null ? '上下文 ' + Math.round(pct) + '%' : null, cost].filter(Boolean);
  if (parts.length === 0) { ui.stats.classList.add('hidden'); hideStatsPop(); return; }
  ui.stats.textContent = parts.join(' · ');
  ui.stats.classList.remove('hidden');
  ui.stats.classList.toggle('warn', pct !== null && pct >= 75);

  // Popover: what Pi actually reports. Context = what the model sees now;
  // cumulative usage = everything this conversation has spent so far.
  const t = statsCache.tokens || {};
  ui.spPct.textContent = pct !== null ? Math.round(pct) + '% 已用' : '暂无估计';
  ui.spFill.textContent = usage && typeof usage.tokens === 'number' ? '约 ' + fmtTokens(usage.tokens) + ' tokens' : '（压缩后等待下一次回复）';
  ui.spWindow.textContent = usage ? '窗口 ' + fmtTokens(usage.contextWindow) : '';
  const seg = ui.spBar.querySelector('.seg.used');
  seg.style.width = Math.max(0, Math.min(100, pct ?? 0)) + '%';
  seg.classList.toggle('warn', pct !== null && pct >= 75);
  seg.classList.toggle('danger', pct !== null && pct >= 90);
  const rows = [
    ['累计输入', t.input, 'c-in'], ['累计输出', t.output, 'c-out'],
    ['缓存读取', t.cacheRead, 'c-cr'], ['缓存写入', t.cacheWrite, 'c-cw'],
  ];
  const total = Math.max(1, t.total || rows.reduce((s, r) => s + (r[1] || 0), 0));
  ui.spLegend.innerHTML = '';
  const usageBar = el('div', 'stats-bar usage');
  for (const [, value, cls] of rows) {
    const s = el('span', 'seg ' + cls);
    s.style.width = ((value || 0) / total * 100) + '%';
    usageBar.appendChild(s);
  }
  ui.spLegend.appendChild(el('div', 'stats-sub2', '本次对话累计用量 · ' + fmtTokens(t.total) + ' tokens'));
  ui.spLegend.appendChild(usageBar);
  for (const [label, value, cls] of rows) {
    const row = el('div', 'legend-row');
    row.innerHTML = '<span class="dot-sq ' + cls + '"></span><span class="legend-label"></span><span class="legend-val"></span>';
    row.querySelector('.legend-label').textContent = label;
    row.querySelector('.legend-val').textContent = fmtTokens(value);
    ui.spLegend.appendChild(row);
  }
  const msgs = el('div', 'legend-row muted');
  msgs.textContent = `消息 ${statsCache.userMessages ?? 0} 用户 · ${statsCache.assistantMessages ?? 0} 助手 · ${statsCache.toolCalls ?? 0} 次工具调用`;
  ui.spLegend.appendChild(msgs);
  ui.spCost.textContent = cost ? '累计成本 ' + cost : '';
  ui.spCompact.disabled = !opened || streaming || pct === null;
}
let statsHideTimer;
function showStatsPop() {
  if (ui.stats.classList.contains('hidden')) return;
  clearTimeout(statsHideTimer);
  ui.statsPop.classList.remove('hidden');
  ui.stats.setAttribute('aria-expanded', 'true');
  send({ v: 1, type: 'get_stats' });
}
function hideStatsPop(delay = 0) {
  clearTimeout(statsHideTimer);
  statsHideTimer = setTimeout(() => { ui.statsPop.classList.add('hidden'); ui.stats.setAttribute('aria-expanded', 'false'); }, delay);
}
ui.statsWrap.addEventListener('mouseenter', () => showStatsPop());
ui.statsWrap.addEventListener('mouseleave', () => hideStatsPop(180));
ui.stats.addEventListener('focus', () => showStatsPop());
ui.stats.addEventListener('click', () => (ui.statsPop.classList.contains('hidden') ? showStatsPop() : hideStatsPop()));
ui.statsWrap.addEventListener('focusout', (e) => { if (!ui.statsWrap.contains(e.relatedTarget)) hideStatsPop(120); });
ui.spCompact.addEventListener('click', async () => {
  if (!opened || streaming) return;
  hideStatsPop();
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
  const hasText = ui.prompt.value.trim().length > 0 || attachments.length > 0 || completedUploads().length > 0;
  ui.send.disabled = !connected || !hasText || uploadsBusy();
  if (uploadsBusy()) ui.send.title = '等待文件传输完成';
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
  if (pendingOpenId) return;            // an open is already in flight on this socket
  if (opened) { connect(); return; }    // one socket owns one Session: start over
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
      clearExtensionUi();
      resetTransfers();
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
      renderSlash();
      return;
    case 'stats':
      if (frame.sessionId === activeId) { statsCache = frame.stats; renderStats(); }
      return;
    case 'transfer':
      if (frame.sessionId !== activeId) return;
      transfer = frame;
      refreshToolDownloadLinks();
      if (filesAwaitingTransfer.length) { const queued = filesAwaitingTransfer; filesAwaitingTransfer = []; void uploadFiles(queued); }
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
  if (type === 'extension_ui_request') { handleExtensionUi(event); return; }
  if (type === 'transfer_progress' || type === 'transfer_complete' || type === 'transfer_failed') { handleTransferEvent(event); return; }
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
    // Any dialog still open was resolved by Pi (timeout/default); drop it.
    if (uiCurrent || uiQueue.length) { uiQueue.length = 0; closeUiDialog(); }
    send({ v: 1, type: 'get_stats' });
  }
}
function customMessageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((p) => p && p.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('\n');
}

// ---------- extension UI (Pi ctx.ui.* over RPC) ----------
const extStatuses = new Map();   // statusKey -> text
const extWidgets = new Map();    // widgetKey -> { lines, placement }
const uiQueue = [];              // pending dialog requests, shown one at a time
const uiSeen = new Set();        // request ids already shown or answered
let uiCurrent = null;

function handleExtensionUi(event) {
  switch (event.method) {
    case 'notify':
      pushNote(String(event.message || ''), event.notifyType === 'error');
      return;
    case 'setStatus':
      if (event.statusText === undefined || event.statusText === null || event.statusText === '') extStatuses.delete(event.statusKey);
      else extStatuses.set(event.statusKey, String(event.statusText));
      renderExtStatus();
      return;
    case 'setWidget':
      if (!Array.isArray(event.widgetLines) || event.widgetLines.length === 0) extWidgets.delete(event.widgetKey);
      else extWidgets.set(event.widgetKey, { lines: event.widgetLines.map(String), placement: event.widgetPlacement || 'aboveEditor' });
      renderWidgets();
      return;
    case 'setTitle':
      // Pi means the terminal title; here it is informational only.
      return;
    case 'set_editor_text':
      ui.prompt.value = String(event.text || '');
      autoGrow();
      refreshComposer();
      return;
    case 'select':
    case 'confirm':
    case 'input':
    case 'editor':
      if (!event.id || uiSeen.has(event.id)) return;
      uiSeen.add(event.id);
      uiQueue.push(event);
      pushNote('扩展请求你的输入：' + (event.title || event.method));
      showNextUiDialog();
      return;
    default:
      return;
  }
}

function renderExtStatus() {
  ui.extStatus.innerHTML = '';
  for (const [key, text] of extStatuses) {
    const chip = el('span', 'ext-chip', text);
    chip.title = key;
    ui.extStatus.appendChild(chip);
  }
}
function renderWidgets() {
  ui.widgets.innerHTML = '';
  ui.widgets.classList.toggle('hidden', extWidgets.size === 0);
  for (const [key, widget] of extWidgets) {
    const box = el('pre', 'widget');
    box.title = key;
    box.textContent = widget.lines.join('\n');
    ui.widgets.appendChild(box);
  }
}
function clearExtensionUi() {
  extStatuses.clear();
  extWidgets.clear();
  uiQueue.length = 0;
  uiSeen.clear();
  closeUiDialog();
  renderExtStatus();
  renderWidgets();
}

function showNextUiDialog() {
  if (uiCurrent || uiQueue.length === 0) return;
  uiCurrent = uiQueue.shift();
  const req = uiCurrent;
  ui.uiTitle.textContent = req.title || ({ select: '请选择', confirm: '请确认', input: '请输入', editor: '请编辑' })[req.method];
  ui.uiText.textContent = req.message || '';
  ui.uiText.classList.toggle('hidden', !req.message);
  ui.uiOptions.classList.toggle('hidden', req.method !== 'select');
  ui.uiInput.classList.toggle('hidden', req.method !== 'input');
  ui.uiEditor.classList.toggle('hidden', req.method !== 'editor');
  ui.uiNo.classList.toggle('hidden', req.method !== 'confirm');
  ui.uiOk.classList.toggle('hidden', req.method === 'select');
  ui.uiOk.textContent = req.method === 'confirm' ? '是' : '确定';
  ui.uiMeta.textContent = (req.timeout ? `超时 ${Math.round(req.timeout / 1000)} 秒后按默认处理 · ` : '') + (uiQueue.length ? `还有 ${uiQueue.length} 个请求排队` : '');
  ui.uiOptions.innerHTML = '';
  if (req.method === 'select') {
    (req.options || []).forEach((option, index) => {
      const button = el('button', 'ui-option', String(option));
      button.type = 'button';
      button.setAttribute('role', 'option');
      button.addEventListener('click', () => answerUi({ value: String(option) }));
      if (index === 0) setTimeout(() => button.focus(), 0);
      ui.uiOptions.appendChild(button);
    });
  }
  if (req.method === 'input') { ui.uiInput.value = ''; ui.uiInput.placeholder = req.placeholder || ''; setTimeout(() => ui.uiInput.focus(), 0); }
  if (req.method === 'editor') { ui.uiEditor.value = req.prefill || ''; setTimeout(() => ui.uiEditor.focus(), 0); }
  if (req.method === 'confirm') setTimeout(() => ui.uiOk.focus(), 0);
  ui.uiModal.classList.remove('hidden');
}
function answerUi(answer) {
  if (!uiCurrent) return;
  const id = uiCurrent.id;
  send({ v: 1, type: 'ui_response', requestId: requestId('ui'), id, ...answer });
  const summary = answer.cancelled ? '已取消' : answer.confirmed !== undefined ? (answer.confirmed ? '已确认' : '已拒绝') : '已回答：' + String(answer.value).slice(0, 80);
  pushNote(summary + '（' + (uiCurrent.title || uiCurrent.method) + '）');
  closeUiDialog();
  showNextUiDialog();
}
function closeUiDialog() {
  uiCurrent = null;
  ui.uiModal.classList.add('hidden');
}
ui.uiOk.addEventListener('click', () => {
  if (!uiCurrent) return;
  if (uiCurrent.method === 'confirm') answerUi({ confirmed: true });
  else if (uiCurrent.method === 'input') answerUi({ value: ui.uiInput.value });
  else if (uiCurrent.method === 'editor') answerUi({ value: ui.uiEditor.value });
});
ui.uiNo.addEventListener('click', () => answerUi({ confirmed: false }));
ui.uiCancel.addEventListener('click', () => answerUi({ cancelled: true }));
ui.uiInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ui.uiOk.click(); } });

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

// ---------- attachments: inline images + direct file transfer ----------
const MAX_IMAGE_BYTES = 600 * 1024;
const INLINE_IMAGE_LIMIT = 4 * 1024 * 1024; // larger images travel as files
const HASH_LIMIT = 32 * 1024 * 1024;         // sha256 in the browser only for files this small

async function addFiles(files) {
  const toUpload = [];
  for (const file of files) {
    const isSmallImage = file.type.startsWith('image/') && file.size <= INLINE_IMAGE_LIMIT;
    if (isSmallImage) {
      // Small images go inline with the prompt so the model can see them.
      if (attachments.length >= 8) { toast('最多 8 张内联图片，其余作为文件上传'); toUpload.push(file); continue; }
      try { attachments.push(await encodeImage(file)); } catch { toast('无法读取图片'); }
    } else {
      toUpload.push(file);
    }
  }
  renderAttachments();
  refreshComposer();
  if (toUpload.length) await uploadFiles(toUpload);
}

// Files go straight from the browser to the User VM over the LocalSend v2 API
// the Host advertises; the Web Server never sees a byte (ADR-0009).
async function uploadFiles(files) {
  if (!transfer) {
    filesAwaitingTransfer.push(...files);
    if (!opened && !pendingOpenId && connected) { openSession(null); toast('正在为文件建立对话…'); }
    else if (opened) { toast('这个 Host 没有开启文件传输'); filesAwaitingTransfer = []; }
    return;
  }
  const tooBig = files.filter((f) => f.size > transfer.maxFileBytes);
  if (tooBig.length) toast(`已跳过 ${tooBig.length} 个超过 ${formatBytes(transfer.maxFileBytes)} 的文件`);
  const batch = files.filter((f) => f.size <= transfer.maxFileBytes);
  if (batch.length === 0) return;
  const pending = uploads.filter((u) => u.state === 'uploading').reduce((s, u) => s + u.size, 0);
  if (pending + batch.reduce((s, f) => s + f.size, 0) > transfer.maxBatchBytes) { toast(`一次最多传输 ${formatBytes(transfer.maxBatchBytes)}`); return; }

  const entries = batch.map((file) => ({
    id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    file, name: file.name, size: file.size, received: 0, state: 'uploading', path: null, error: null, xhr: null, sessionId: null, token: null,
  }));
  uploads.push(...entries);
  renderAttachments();
  refreshComposer();

  const meta = {};
  for (const u of entries) {
    const sha256 = u.size <= HASH_LIMIT ? await sha256Hex(u.file).catch(() => undefined) : undefined;
    meta[u.id] = { id: u.id, fileName: u.name, size: u.size, fileType: u.file.type || 'application/octet-stream', ...(sha256 ? { sha256 } : {}) };
  }
  let prepared;
  try {
    const response = await fetch(`${transfer.url}/api/localsend/v2/prepare-upload?scope=${encodeURIComponent(transfer.scope)}&token=${encodeURIComponent(transfer.token)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ info: { alias: 'PI Coffee Web', version: '2.0', deviceModel: navigator.platform || 'browser', deviceType: 'web', fingerprint: 'web', port: 0, protocol: 'http', download: false }, files: meta }),
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || ('HTTP ' + response.status));
    prepared = await response.json();
  } catch (error) {
    for (const u of entries) { u.state = 'failed'; u.error = '无法连接 User VM 的传输端点：' + (error.message || error); }
    renderAttachments(); refreshComposer();
    toast('文件传输失败：浏览器无法直连 User VM（' + transfer.url + '）');
    return;
  }
  for (const u of entries) {
    u.sessionId = prepared.sessionId;
    u.token = prepared.files[u.id];
    if (!u.token) { u.state = 'failed'; u.error = '服务端未接受该文件'; continue; }
    void sendFile(u);
  }
  renderAttachments();
}

function sendFile(u) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    u.xhr = xhr;
    xhr.open('POST', `${transfer.url}/api/localsend/v2/upload?sessionId=${encodeURIComponent(u.sessionId)}&fileId=${encodeURIComponent(u.id)}&token=${encodeURIComponent(u.token)}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && u.state === 'uploading') { u.received = Math.max(u.received, e.loaded); renderAttachmentProgress(u); } };
    xhr.onload = () => {
      if (xhr.status === 200) { if (u.state === 'uploading') { u.received = u.size; u.state = u.path ? 'done' : 'finishing'; } }
      else { u.state = 'failed'; u.error = xhr.status === 422 ? '校验失败（SHA-256 不匹配）' : xhr.status === 403 ? '令牌无效' : 'HTTP ' + xhr.status; }
      renderAttachments(); refreshComposer(); resolve();
    };
    xhr.onerror = () => { if (u.state !== 'cancelled') { u.state = 'failed'; u.error = '网络错误'; } renderAttachments(); refreshComposer(); resolve(); };
    xhr.onabort = () => { u.state = 'cancelled'; renderAttachments(); refreshComposer(); resolve(); };
    xhr.send(u.file);
  });
}

async function sha256Hex(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function handleTransferEvent(event) {
  const u = uploads.find((x) => x.id === event.fileId);
  if (!u) return;
  if (event.type === 'transfer_progress') { u.received = Math.max(u.received, event.received || 0); renderAttachmentProgress(u); return; }
  if (event.type === 'transfer_complete') {
    u.path = event.path; u.name = event.fileName || u.name; u.sha256 = event.sha256; u.received = u.size;
    if (u.state !== 'cancelled') u.state = 'done';
    renderAttachments(); refreshComposer();
    return;
  }
  if (event.type === 'transfer_failed' && u.state !== 'cancelled') { u.state = 'failed'; u.error = event.message || '传输失败'; renderAttachments(); refreshComposer(); }
}

function downloadUrl(path) {
  if (!transfer || !path) return null;
  return `${transfer.url}/api/localsend/v2/download?scope=${encodeURIComponent(transfer.scope)}&token=${encodeURIComponent(transfer.token)}&fileId=${encodeURIComponent(path)}`;
}

function refreshToolDownloadLinks() {
  for (const entry of entries) if (entry.k === 'tool' && entry.node) addToolDownloadLink(entry);
}
function addToolDownloadLink(entry) {
  const args = entry.args && typeof entry.args === 'object' ? entry.args : {};
  const path = args.path || args.file_path;
  if (!path || !['write', 'edit', 'read'].includes(entry.name)) return;
  const summary = entry.node.querySelector('summary');
  if (!summary || summary.querySelector('.tool-dl')) return;
  const href = downloadUrl(String(path));
  if (!href) return;
  const link = document.createElement('a');
  link.className = 'tool-dl';
  link.href = href; link.target = '_blank'; link.rel = 'noopener'; link.title = '从 User VM 下载这个文件';
  link.textContent = '下载';
  link.addEventListener('click', (e) => e.stopPropagation());
  summary.insertBefore(link, summary.querySelector('.state'));
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
  ui.attachments.classList.toggle('hidden', attachments.length === 0 && uploads.length === 0);
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
  for (const u of uploads) {
    const chip = el('div', 'upload-chip ' + u.state);
    chip.dataset.id = u.id;
    chip.innerHTML = '<span class="file-ico">📄</span><span class="upload-main"><span class="upload-name"></span><span class="upload-meta"></span><span class="upload-bar"><span class="upload-fill"></span></span></span>';
    chip.querySelector('.upload-name').textContent = u.name;
    const remove = el('button', 'attachment-remove', '×');
    remove.type = 'button';
    remove.title = u.state === 'uploading' ? '取消上传' : '移除';
    remove.addEventListener('click', () => {
      if (u.state === 'uploading' && u.xhr) u.xhr.abort();
      uploads = uploads.filter((x) => x !== u);
      renderAttachments(); refreshComposer();
    });
    chip.appendChild(remove);
    ui.attachments.appendChild(chip);
    renderAttachmentProgress(u);
  }
}
function renderAttachmentProgress(u) {
  const chip = ui.attachments.querySelector(`.upload-chip[data-id="${u.id}"]`);
  if (!chip) return;
  chip.className = 'upload-chip ' + u.state;
  const pct = u.size ? Math.min(100, Math.round((u.received / u.size) * 100)) : 100;
  chip.querySelector('.upload-fill').style.width = pct + '%';
  const meta = chip.querySelector('.upload-meta');
  if (u.state === 'uploading') meta.textContent = `${formatBytes(u.received)} / ${formatBytes(u.size)} · ${pct}%`;
  else if (u.state === 'finishing') meta.textContent = '校验中…';
  else if (u.state === 'done') meta.textContent = `${formatBytes(u.size)} · 已存入 User VM`;
  else if (u.state === 'failed') meta.textContent = u.error || '失败';
  else meta.textContent = '已取消';
}
function resetTransfers() {
  // Endpoint and token are per Session; anything in flight belonged to the old one.
  for (const u of uploads) if (u.state === 'uploading' && u.xhr) u.xhr.abort();
  uploads = [];
  transfer = null;
  renderAttachments();
}
function uploadsBusy() { return uploads.some((u) => u.state === 'uploading' || u.state === 'finishing'); }
function completedUploads() { return uploads.filter((u) => u.state === 'done' && u.path); }
ui.attach.addEventListener('click', () => ui.file.click());
ui.file.addEventListener('change', () => { addFiles([...ui.file.files]); ui.file.value = ''; });
ui.file.removeAttribute('accept'); // any file type: images inline, everything else straight to the VM
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
ui.prompt.addEventListener('input', () => {
  autoGrow();
  refreshComposer();
  slashIndex = 0;
  // The command list comes from the Pi process of an open Session. Typing "/"
  // before the first message opens the new conversation early to fetch it.
  if (ui.prompt.value.startsWith('/') && !opened && !pendingOpenId && connected) openSession(null);
  renderSlash();
});
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
  const files = completedUploads();
  if ((!text && attachments.length === 0 && files.length === 0) || !socket || socket.readyState !== WebSocket.OPEN) return;
  if (uploadsBusy()) { toast('等待文件传输完成'); return; }
  const images = attachments.slice();
  if (!opened) {
    // First message of a brand-new conversation: (re)use the in-flight open
    // and send once `history` confirms the Session.
    queuedPrompt = { text, images };
    attachments = [];
    renderAttachments();
    if (!pendingOpenId) openSession(null);
    ui.prompt.value = '';
    autoGrow();
    setStreaming(true);
    showThinking(true);
    return;
  }
  submitPrompt(text || (files.length ? '（附件）' : '（图片）'), images);
});
function submitPrompt(text, images) {
  const mode = streaming ? ui.mode.value : 'prompt';
  const files = completedUploads().map((u) => ({ name: u.name, size: u.size, path: u.path, href: downloadUrl(u.path) }));
  // Files are already on the User VM's disk; the model gets their paths, not their bytes.
  const wireText = files.length
    ? text + '\n\n[已上传到工作目录的文件]\n' + files.map((f) => `- ${f.path} (${formatBytes(f.size)})`).join('\n')
    : text;
  const frame = { v: 1, type: 'prompt', requestId: requestId('web'), text: wireText };
  if (images && images.length) frame.images = images;
  if (mode !== 'prompt') frame.mode = mode;
  if (mode === 'prompt') {
    pushUser(text, images, undefined, files);
    lastUserText = text;
    setStreaming(true);
    showThinking(true);
  }
  send(frame);
  attachments = [];
  uploads = uploads.filter((u) => u.state === 'uploading' || u.state === 'finishing');
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
    if (!ui.uiModal.classList.contains('hidden')) { answerUi({ cancelled: true }); return; }
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
