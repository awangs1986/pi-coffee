// PI Coffee browser shell — controller. The browser is a view: conversations,
// history, models and running state live on the Host in the User VM. The only
// local value is which conversation this browser last displayed.
import {
  renderMarkdown, activityGroup, assistantNode, el, fillToolCard, formatBytes, installCopyHandlers,
  noteNode, relativeTime, renderPatchText, timeGroup, toolCard, toolResultDetails, toolResultText, updateActivity, updateAssistant, userBubble,
} from './render.js';

import { compactionNotice, isContextError } from './context-status.js';

const ACTIVE_KEY = 'pi-coffee.active.v2';
let creationRequest = (()=>{try{return JSON.parse(sessionStorage.getItem('coffee.pending-creation'));}catch{return null;}})();
function saveCreation(){if(creationRequest)sessionStorage.setItem('coffee.pending-creation',JSON.stringify(creationRequest));else sessionStorage.removeItem('coffee.pending-creation');}
const THEME_KEY = 'pi-coffee.theme.v1';
const $ = (selector) => document.querySelector(selector);
const ui = {
  app: $('#app'), thread: $('#thread'), scroller: $('#scroller'), toBottom: $('#to-bottom'),
  brandBtn: $('#brand-menu-btn'), brandMenu: $('#brand-menu'), themeToggle: $('#theme-toggle'), themeLabel: $('#theme-toggle-label'),
  prompt: $('#prompt'), send: $('#send'), stop: $('#stop'), status: $('#status'), dot: $('#dot'), connBanner: $('#conn-banner'),
  composer: $('#composer'), composerWrap: $('.composer-wrap'),
  title: $('#title'), topbarState: $('#topbar-state'), stats: $('#stats'), sessionMeta: $('#session-meta'),
  sessionList: $('#session-list'), search: $('#search'), queue: $('#queue'), slash: $('#slash'),
  attachments: $('#attachments'), attach: $('#attach'), file: $('#file'), hint: $('#hint'),
  agentBtn: $('#agent-menu-btn'), agentMenu: $('#agent-menu'),
  agentRows: { source: $('#agent-source-row'), model: $('#agent-model-row'), thinking: $('#agent-thinking-row') },
  agentPanes: { source: $('#agent-source-pane'), model: $('#agent-model-pane'), thinking: $('#agent-thinking-pane') },
  agentValues: { source: $('#agent-source-value'), model: $('#agent-model-value'), thinking: $('#agent-thinking-value') },
  modelSource: $('#model-source'), model: $('#model'), thinking: $('#thinking'), modeWrap: $('#mode-wrap'), mode: $('#mode'),
  projectSelect: $('#project-select'), startBranch: $('#start-branch'), projectManage: $('.project-manage'),
  modal: $('#modal'), modalTitle: $('#modal-title'), modalText: $('#modal-text'), modalInput: $('#modal-input'),
  modalOk: $('#modal-ok'), modalCancel: $('#modal-cancel'), toast: $('#toast'),
  extStatus: $('#ext-status'), widgets: $('#widgets'),
  pluginsBtn: $('#plugins-btn'), pluginsModal: $('#plugins-modal'), pluginsBody: $('#plugins-body'), pluginsSub: $('#plugins-sub'), pluginsClose: $('#plugins-close'),
  statsWrap: $('#stats-wrap'), statsPop: $('#stats-pop'), spPct: $('#sp-pct'), spFill: $('#sp-fill'), spWindow: $('#sp-window'),
  spBar: $('#sp-bar'), spLegend: $('#sp-legend'), spCost: $('#sp-cost'), spCompact: $('#sp-compact'),
  uiModal: $('#ui-modal'), uiTitle: $('#ui-title'), uiText: $('#ui-text'), uiOptions: $('#ui-options'), uiInput: $('#ui-input'),
  uiEditor: $('#ui-editor'), uiMeta: $('#ui-meta'), uiOk: $('#ui-ok'), uiNo: $('#ui-no'), uiCancel: $('#ui-cancel'),
};

// ---------- state ----------
let socket, reconnectTimer;
let connected = false, opened = false, streaming = false, modelPending = null;
let activeId = localStorage.getItem(ACTIVE_KEY) || null;
let pendingOpenId = null, queuedPrompt = null, prepareNew = false;
let sessions = [], commands = [], models = null, statsCache = null;
let entries = [];
let requestNumber = 0;
let currentAssistant, currentActivity, activityCount = 0;
const openTools = new Map();
let lastTool, thinkingNode;
let lastUserText = '';
let attachments = [];          // small inline images: { type, mimeType, data }
let uploads = [];              // files transferred straight to the User VM (ADR-0009)
let uploadLog = [];            // completed uploads for the current conversation: { name, size, path }
let workspaceState = null, showArchived = false, workspaceRequestSeq = 0;
let transfer = null;           // { url, scope, token, inbox, maxFileBytes, maxBatchBytes } from the Host
let workspaceChanges = null;   // aggregate Checkout status from `/api/workspace` action `changes`
let workspaceSync = null;
let selectedChangedPath = null, diffWrapped = true;
let workspaceDetailOpen = false; // true while a Diff/Checks document replaces the change list
let lastChangeCardSignature = '';
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
function isMobileSidebar() { return window.matchMedia('(max-width: 820px)').matches; }
function applyTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch { /* private-mode storage can fail */ }
  ui.themeToggle?.setAttribute('aria-pressed', String(next === 'dark'));
  if (ui.themeLabel) ui.themeLabel.textContent = next === 'dark' ? '浅色模式' : '深色模式';
}
function closeBrandMenu() {
  ui.brandMenu?.classList.add('hidden');
  ui.brandBtn?.setAttribute('aria-expanded', 'false');
}
function toggleBrandMenu() {
  const open = ui.brandMenu?.classList.contains('hidden');
  if (!open) { closeBrandMenu(); return; }
  ui.brandMenu.classList.remove('hidden');
  ui.brandBtn?.setAttribute('aria-expanded', 'true');
}

// ---------- Agent settings menu ----------
const modelControlsLocked = () => !!modelPending || !connected || !opened;
function sourceLabel(source) {
  return source === 'relay' ? 'Relay' : 'Native';
}
function selectedModelInfo() {
  if (!models) return null;
  return models.models.find((m) => m.provider === models.current?.provider && m.id === models.current?.id) || models.current || null;
}
function closeAgentPanes() {
  for (const pane of Object.values(ui.agentPanes)) pane.classList.add('hidden');
  for (const row of Object.values(ui.agentRows)) row.setAttribute('aria-expanded', 'false');
}
function closeAgentMenu() {
  ui.agentMenu?.classList.add('hidden');
  ui.agentBtn?.setAttribute('aria-expanded', 'false');
  closeAgentPanes();
}
function toggleAgentMenu() {
  if (!ui.agentMenu || ui.agentBtn.disabled) return;
  const open = ui.agentMenu.classList.contains('hidden');
  closeBrandMenu();
  if (!open) { closeAgentMenu(); return; }
  renderAgentSettings();
  ui.agentMenu.classList.remove('hidden');
  ui.agentBtn.setAttribute('aria-expanded', 'true');
  setTimeout(() => ui.agentRows.model.focus(), 0);
}
function openAgentPane(kind) {
  closeAgentPanes();
  const pane = ui.agentPanes[kind];
  if (!pane) return;
  renderAgentPane(kind);
  pane.classList.remove('hidden');
  ui.agentRows[kind].setAttribute('aria-expanded', 'true');
}
function agentOption({ label, meta = '', selected = false, onClick }) {
  const button = el('button', 'agent-option' + (selected ? ' selected' : ''));
  button.type = 'button';
  button.setAttribute('role', 'menuitemradio');
  button.setAttribute('aria-checked', String(selected));
  button.append(el('span', 'agent-option-label', label));
  if (meta) button.append(el('span', 'agent-option-meta', meta));
  if (selected) button.append(el('span', 'agent-option-check', '✓'));
  button.addEventListener('click', onClick);
  return button;
}
function renderAgentPane(kind) {
  const pane = ui.agentPanes[kind];
  pane.replaceChildren();
  if (!models) return;
  const current = selectedModelInfo();
  if (kind === 'source') {
    const sources = [...new Set(models.models.map((m) => m.source || 'native'))];
    for (const source of sources) {
      const available = models.models.filter((m) => (m.source || 'native') === source).length;
      pane.append(agentOption({
        label: sourceLabel(source),
        meta: `${available} 个模型`,
        selected: (models.current?.source || current?.source || 'native') === source,
        onClick: () => {
          closeAgentMenu();
          const next = models.models.find((m) => (m.source || 'native') === source);
          if (next && (models.current?.source || current?.source || 'native') !== source) chooseModel(next.provider, next.id);
        },
      }));
    }
    return;
  }
  if (kind === 'model') {
    const bySource = new Map();
    for (const model of models.models) {
      const source = model.source || 'native';
      if (!bySource.has(source)) bySource.set(source, []);
      bySource.get(source).push(model);
    }
    for (const [source, sourceModels] of bySource) {
      pane.append(el('div', 'agent-pane-label', sourceLabel(source)));
      for (const model of sourceModels) {
        const selected = current?.provider === model.provider && current?.id === model.id;
        pane.append(agentOption({
          label: model.id,
          meta: model.provider,
          selected,
          onClick: () => { closeAgentMenu(); if (!selected) chooseModel(model.provider, model.id); },
        }));
      }
    }
    return;
  }
  const levels = models.thinkingLevels || [];
  for (const level of levels) {
    pane.append(agentOption({
      label: level,
      selected: models.thinkingLevel === level,
      onClick: () => {
        closeAgentMenu();
        ui.thinking.value = level;
        send({ v: 1, type: 'set_thinking', requestId: requestId('thinking'), level });
      },
    }));
  }
}
function renderAgentSettings() {
  if (!models || !ui.agentBtn) return;
  const current = selectedModelInfo();
  const source = models.current?.source || current?.source || 'native';
  ui.agentValues.source.textContent = sourceLabel(source);
  ui.agentValues.model.textContent = models.current ? models.current.id : '—';
  ui.agentValues.model.title = models.current ? `${models.current.provider}/${models.current.id}` : '';
  const levels = models.thinkingLevels || [];
  ui.agentRows.thinking.classList.toggle('hidden', levels.length === 0);
  ui.agentValues.thinking.textContent = models.thinkingLevel || levels[0] || '—';
  ui.agentBtn.dataset.state = `${source} · ${models.current ? models.current.id : 'no model'} · ${models.thinkingLevel || 'default'}`;
  ui.agentBtn.title = `Agent · ${sourceLabel(source)} · ${models.current ? models.current.provider + '/' + models.current.id : '未选择模型'} · 思考 ${models.thinkingLevel || '默认'}`;
  ui.agentBtn.disabled = modelControlsLocked() || !models;
  for (const kind of ['source', 'model', 'thinking']) renderAgentPane(kind);
}
function openSidebar() {
  if (isMobileSidebar()) ui.app.classList.add('side-open');
  ui.app.classList.remove('side-collapsed');
}
function collapseSidebar() {
  if (isMobileSidebar()) ui.app.classList.remove('side-open');
  else ui.app.classList.add('side-collapsed');
}

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
  uploadLog = [];
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
const pendingAssistantRenders = new Set();
function scheduleAssistantRender() {
  if(currentAssistant)pendingAssistantRenders.add(currentAssistant);
  if (renderTimer) return;
  renderTimer = requestAnimationFrame(() => {
    renderTimer = null;
    const stick = nearBottom();
    for(const entry of pendingAssistantRenders)if(entry.node.isConnected)updateAssistant(entry.node,entry.text);
    pendingAssistantRenders.clear();
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
  if(workspaceState) {
    for(const c of workspaceState.conversations) if(!known.some(s=>s.id===c.id)) known.push({id:c.id,preview:c.creationState==='failed'?'创建失败 · 点击重试':c.creationState==='creating'?'创建中 · 点击恢复':c.workspaceKind==='chat'?'Chat 任务':'Work 任务',updatedAt:c.createdAt,running:false});
    const selected=activeId ? '' : $('#project-select').value;
    known=known.filter(s=> {const c=workspaceState.conversations.find(c=>c.id===s.id);return Boolean(c?.archived || workspaceState.legacyArchived?.includes(s.id))===showArchived && (!selected || c?.projectId===selected);});
  }
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
    if(workspaceState?.conversations.find(c=>c.id===session.id)?.runState==='interrupted')main.append(el('span','interrupted-badge','上次运行中断 · 未自动续跑'));
    const meta = el('span', 'meta', [relativeTime(session.updatedAt), session.messageCount ? session.messageCount + ' 条' : ''].filter(Boolean).join(' · '));
    main.appendChild(meta);
    item.appendChild(main);
    if (session.running || (session.id === activeId && streaming)) item.appendChild(el('span', 'running'));
    const menu = el('button', 'more', '⋯');
    menu.type = 'button';
    menu.title = workspaceState ? '重命名 / 归档' : '重命名 / 删除';
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
  const archived=workspaceState?.conversations.find(c=>c.id===session.id)?.archived || workspaceState?.legacyArchived?.includes(session.id);
  const del = el('button', 'popitem', workspaceState ? (archived ? '恢复对话' : '归档') : '删除');
  del.type = 'button';
  del.addEventListener('click', async () => {
    closeMenu();
    if(workspaceState) {
      try {await workspaceApi({action:archived ? 'restore' : 'archive',id:session.id});await loadWorkspace();if(!archived && activeId===session.id)newSession(false);} catch(e) {toast(e.message);}return;
    }
    await deleteSession(session);
  });
  if(archived) {
    const remove=el('button','popitem danger','永久删除…');remove.addEventListener('click',async()=> {
      closeMenu();const confirmation=await askModal({title:'永久删除归档对话',text:`将永久删除原生对话历史和本地目录（包括附件、搜索结果、图片及产物）：\n${workspaceState.conversations.find(c=>c.id===session.id)?.cwd || '旧对话历史；旧目录保留'}\nChat 本地文件没有 Git 备份。Work 未提交/未推送代码会阻止删除；远端分支、PR、仓库和旧全局数据保留。运行中的任务须先结束。输入 ID 确认：${session.id}`,input:'',okLabel:'永久删除',danger:true});
      if(confirmation!==session.id)return;
      try {await workspaceApi({action:'delete',id:session.id,confirmation,includeLocalFiles:true});await loadWorkspace();send({v:1,type:'list_sessions'});}catch(e){toast(e.message);}
    });menuNode.append(remove);
  }
  menuNode.append(rename, del);
  document.body.appendChild(menuNode);
  const rect = anchor.getBoundingClientRect();
  menuNode.style.top = rect.bottom + 4 + 'px';
  menuNode.style.left = Math.min(rect.left, window.innerWidth - 160) + 'px';
}
ui.brandBtn?.addEventListener('click', toggleBrandMenu);
ui.themeToggle?.addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
ui.agentBtn?.addEventListener('click', toggleAgentMenu);
ui.agentRows.source?.addEventListener('click', () => openAgentPane('source'));
ui.agentRows.model?.addEventListener('click', () => openAgentPane('model'));
ui.agentRows.thinking?.addEventListener('click', () => openAgentPane('thinking'));
ui.agentMenu?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.stopPropagation(); closeAgentMenu(); ui.agentBtn.focus(); }
});
document.addEventListener('click', (event) => {
  if (menuNode && !menuNode.contains(event.target)) closeMenu();
  if (!event.target.closest('.brand-wrap')) closeBrandMenu();
  if (!event.target.closest('.agent-menu-wrap')) closeAgentMenu();
  if (ui.projectManage?.open && !ui.projectManage.contains(event.target)) ui.projectManage.open = false;
});

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
async function requestLocalCompaction() {
  if (!opened) return;
  if (streaming) { toast('请先停止当前任务，再执行本地压缩。'); return; }
  hideStatsPop();
  const ok = await askModal({ title: '本地压缩上下文？', text: '默认 context-fold 配置在 VM 本地生成恢复索引，不调用模型生成摘要。原始记录保留；压缩后不会自动重放任务。若插件被关闭，请先恢复默认配置。', okLabel: '本地压缩' });
  if (!ok) return;
  send({ v: 1, type: 'compact', requestId: requestId('compact') });
  toast('正在本地压缩…');
}
function offerContextRecovery(message) {
  if (!isContextError(message)) return;
  const entry = pushNote('上下文过大。可本地压缩后继续；若仍过大，请缩短本次输入或检查模型窗口配置。');
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'btn small'; button.textContent = '本地压缩上下文';
  const sessionId = activeId;
  button.addEventListener('click', () => { if (sessionId === activeId) void requestLocalCompaction(); });
  entry.node.append(button);
}
ui.spCompact.addEventListener('click', requestLocalCompaction);
ui.title.addEventListener('click', () => {
  const session = sessions.find((s) => s.id === activeId);
  if (session) renameSession(session);
});

// ---------- connection ----------
function setConnection(text, kind) {
  ui.status.textContent = text;
  ui.dot.className = 'dot' + (kind ? ' ' + kind : '');
  connected = kind === 'ready' || kind === 'busy';
  // The footer dot is too subtle: the center column must also announce a lost link.
  ui.connBanner.classList.toggle('hidden', connected);
  if (!connected) ui.connBanner.textContent = text || '连接已断开，正在自动重连…';
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
  ui.send.disabled = !connected || !hasText || uploadsBusy() || !!modelPending;
  ui.model.disabled = ui.modelSource.disabled = ui.thinking.disabled = modelControlsLocked();
  if (ui.agentBtn) ui.agentBtn.disabled = modelControlsLocked() || !models;
  renderProjectContext();
  ui.stop.classList.toggle('hidden', !(connected && streaming));
  ui.modeWrap.classList.toggle('hidden', !(connected && streaming));
  ui.send.title = uploadsBusy() ? '等待文件传输完成' : streaming ? (ui.mode.value === 'steer' ? '插话：在当前工具调用后打断' : '排队：等这轮结束后发送') : '发送';
  ui.hint.textContent = streaming ? '运行中 · Enter ' + (ui.mode.value === 'steer' ? '插话' : '排队') : 'Enter 发送 · Shift+Enter 换行';
  if (connected) {
    ui.status.textContent = streaming ? 'Pi 正在工作…' : '已连接';
    ui.dot.className = 'dot ' + (streaming ? 'busy' : 'ready');
  }
}

function renderProjectContext() {
  if (!ui.projectSelect || !ui.startBranch) return;
  const conversation = workspaceState?.conversations.find((c) => c.id === activeId);
  const activeProject = workspaceState?.projects.find((p) => p.id === conversation?.projectId);
  const lockedToConversation = Boolean(conversation);
  if (conversation) {
    if ([...ui.projectSelect.options].some((option) => option.value === conversation.projectId)) ui.projectSelect.value = conversation.projectId;
    ui.startBranch.value = conversation.branch || '';
  } else if (!ui.startBranch.value) {
    const project = workspaceState?.projects.find((p) => p.id === ui.projectSelect.value);
    if (project?.branch) ui.startBranch.placeholder = project.branch;
  }
  ui.projectSelect.disabled = lockedToConversation;
  ui.startBranch.disabled = lockedToConversation;
  const kind=$('#task-kind');kind.disabled=lockedToConversation;
  if(conversation)kind.value=conversation.workspaceKind==='chat'?'chat':'project';
  const projectWorkspace=kind.value==='project';
  ui.projectSelect.closest('label').classList.toggle('hidden',!projectWorkspace);
  ui.startBranch.closest('label').classList.toggle('hidden',!projectWorkspace);
  $('#create-task').classList.toggle('hidden',lockedToConversation);
  if(!lockedToConversation && activeId)$('#create-task').textContent='为旧任务创建目录';
  const context=$('#workspace-context');context.replaceChildren();
  if(conversation){
    context.append(el('span','',`VM：${conversation.vmId || workspaceState.vmId || '未知'} · ${activeProject?.name || '无项目'} · ${conversation.creationState==='failed'?'创建失败':conversation.creationState==='creating'?'创建中':'就绪'}`));
    const path=el('code','workspace-path',conversation.cwd);const copy=el('button','btn small','复制路径');copy.type='button';
    copy.onclick=async()=>{try{await navigator.clipboard.writeText(conversation.cwd);toast('已复制完整路径');}catch{const selection=window.getSelection();const range=document.createRange();range.selectNodeContents(path);selection.removeAllRanges();selection.addRange(range);toast('已选中完整路径，可复制');}};
    context.append(path,copy);
    if(activeProject?.webUrl){const link=el('a','','打开项目');link.href=activeProject.webUrl;link.target='_blank';link.rel='noopener noreferrer';context.append(link);}
    context.append(el('span','workspace-branch',conversation.workspaceKind==='chat'?'本地文件 · 分支/同步不适用':`当前分支：${workspaceSync?.branch ?? '正在核查…'} · ${workspaceSync?.lastRemoteAt ? '最后核查 '+workspaceSync.lastRemoteAt : '尚未核查远端'}`));
    if(conversation.creationError)context.append(el('span','',conversation.creationError));
  }
  ui.projectSelect.title = activeProject ? activeProject.name : 'Gitea 仓库';
  ui.startBranch.title = conversation ? `当前对话固定使用 ${conversation.branch}` : '新对话起始分支';
  ui.projectSelect.classList.toggle('locked', lockedToConversation);
  ui.startBranch.classList.toggle('locked', lockedToConversation);
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
    if (activeId) openSession(activeId).catch(e=>toast(e.message));
    else if(prepareNew){prepareNew=false;openSession(null).catch(e=>toast(e.message));}
  };
  ws.onmessage = (event) => {
    let frame;
    try { frame = JSON.parse(event.data); } catch { return; }
    handleFrame(frame, ws);
  };
  ws.onclose = () => {
    modelPending=null;
    if (socket !== ws) return;
    opened = false;
    workspaceSync={...workspaceSync,state:'unknown',error:'VM 连接断开；显示上次已知值'};renderSyncState();renderProjectContext();
    setConnection('连接断开，重连中…（Host 上的任务不会被打断）', 'error');
    reconnectTimer = setTimeout(connect, 1200);
  };
  ws.onerror = () => { if (socket === ws) setConnection('连接错误', 'error'); };
}
async function openSession(id) {
  if(!connected){toast('等待 VM 连接就绪');return;}
  if (pendingOpenId) return;            // an open is already in flight on this socket
  if (opened) { connect(); return; }    // one socket owns one Session: start over
  if(!id && !workspaceState){await loadWorkspace();if(!workspaceState){toast('工作区服务尚未就绪');return;}}
  const existing=workspaceState?.conversations.find(c=>c.id===id);
  if((!id && workspaceState) || existing?.creationState==='failed' || existing?.creationState==='creating') {
    const workspaceKind=existing?.workspaceKind || $('#task-kind').value;
    const projectId=existing?.projectId || ui.projectSelect.value;
    if(workspaceKind==='project' && !projectId) {toast('请先选择 Gitea 项目');return;}
    const signature=JSON.stringify([workspaceKind,projectId,existing?.startBranch || ui.startBranch.value.trim()]);
    if(!creationRequest || creationRequest.signature!==signature)creationRequest={signature,id:existing?.id || [...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join('')};
    saveCreation();pendingOpenId='creating';$('#create-task').disabled=true;$('#create-task').textContent='创建中…';
    try {
      const c=await workspaceApi({action:'conversation',id:creationRequest.id,workspaceKind,...(workspaceKind==='project'?{projectId,branch:existing?.startBranch || ui.startBranch.value.trim() || undefined}:{})});
      id=c.id;activeId=id;localStorage.setItem(ACTIVE_KEY,id);creationRequest=null;saveCreation();workspaceSync=null;await loadWorkspace();
    }catch(e){pendingOpenId=null;toast(e.message);await loadWorkspace();return;}
    finally{$('#create-task').disabled=false;$('#create-task').textContent='创建任务 / 重试';}
  }
  pendingOpenId = id || 'new';
  const frame = { v: 1, type: 'open' };
  if (id) frame.sessionId = id;
  send(frame);
}
function afterOpened() {
  send({ v: 1, type: 'get_models' });
  send({ v: 1, type: 'get_commands' });
  send({ v: 1, type: 'get_stats' });
  if (pluginsWaiting) send({ v: 1, type: 'get_extensions' });
}

function handleFrame(frame, ws) {
  switch (frame.type) {
    case 'sessions':
      sessions = Array.isArray(frame.sessions) ? frame.sessions : [];
      renderSessionList();
      renderHeader();
      return;
    case 'opened':
      const sameTransfer=transfer?.scope===frame.sessionId;
      opened = true;
      pendingOpenId = null;
      activeId = frame.sessionId;
      localStorage.setItem(ACTIVE_KEY, activeId);
      statsCache = null;
      resetThread();
      clearExtensionUi();
      if(!sameTransfer)resetTransfers();
      void loadWorkspace();
      workspaceChanges=null;selectedChangedPath=null;lastChangeCardSignature='';if(workspaceDetailOpen)closeWorkspaceDetail();renderWorkspaceSummary();renderWorkspaceList();renderProjectContext();
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
      models = frame;modelPending=null;refreshComposer();
      renderModels();
      return;
    case 'commands':
      commands = Array.isArray(frame.commands) ? frame.commands : [];
      renderSlash();
      return;
    case 'stats':
      if (frame.sessionId === activeId) { statsCache = frame.stats; renderStats(); }
      return;
    case 'extensions':
      if (frame.sessionId !== activeId) return;
      renderPlugins(Array.isArray(frame.extensions) ? frame.extensions : []);
      return;
    case 'transfer':
      setTimeout(()=>{if(workspaceState) {renderWorkspaceList();void refreshArtifactCards();void refreshWorkspaceChanges(false).catch(()=>undefined);}},0);
      if (frame.sessionId !== activeId) return;
      transfer = frame;
      refreshToolDownloadLinks();
      renderUploadLogCard(); // relink rows with the fresh token
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
      if(modelPending && frame.requestId===modelPending){modelPending=null;renderModels();refreshComposer();}
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
  if (type === 'message_end' && event.message && event.message.stopReason === 'error') { pushNote('模型调用失败：' + (event.message.errorMessage || '未知错误'), true); offerContextRecovery(event.message.errorMessage); return; }
  if (type === 'message_end' && event.message && event.message.role === 'custom' && event.message.display === true) {
    const text = customMessageText(event.message.content);
    if (text.trim()) { currentAssistant = undefined; showThinking(false); pushNote(text.slice(0, 8000)); }
    return;
  }
  if (type === 'auto_retry_start') { pushNote('上游暂时不可用，Pi 正在重试（' + event.attempt + '/' + event.maxAttempts + '）…'); return; }
  if (type === 'compaction_end') { const notice = compactionNotice(event); pushNote(notice.text, notice.failure); send({ v: 1, type: 'get_stats' }); return; }
  if (type === 'agent_settled') {
    setStreaming(false);
    for (const entry of openTools.values()) { entry.done = true; fillToolCard(entry.node, entry); }
    openTools.clear();
    renderQueue({ steering: [], followUp: [] });
    // Any dialog still open was resolved by Pi (timeout/default); drop it.
    if (uiCurrent || uiQueue.length) { uiQueue.length = 0; closeUiDialog(); }
    send({ v: 1, type: 'get_stats' });
    void refreshWorkspaceChanges(false).then(() => maybeRenderChangesCard()).catch(() => undefined);
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
      offerContextRecovery(event.message);
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

// ---------- plugins panel (what the User VM's Pi has loaded) ----------
let pluginsWaiting = false;
function openPlugins() {
  ui.pluginsModal.classList.remove('hidden');
  ui.pluginsSub.textContent = '';
  ui.pluginsBody.innerHTML = '<div class="plugins-empty">正在向 User VM 查询…</div>';
  pluginsWaiting = true;
  if (opened) send({ v: 1, type: 'get_extensions' });
  else if (!pendingOpenId && connected) { openSession(null); }
  else if (!connected) ui.pluginsBody.innerHTML = '<div class="plugins-empty">未连接到 Host</div>';
}
function closePlugins() { ui.pluginsModal.classList.add('hidden'); pluginsWaiting = false; }
const ORIGIN_LABEL = { configured: 'PI Coffee 加载', cli: '命令行加载', auto: '自动发现', inline: 'Pi 内置', package: '安装包', settings: '设置' };
const SCOPE_LABEL = { user: '用户级', project: '项目级', temporary: '本次进程' };
function renderPlugins(list) {
  if (!pluginsWaiting && ui.pluginsModal.classList.contains('hidden')) return;
  pluginsWaiting = false;
  const groups = [['extension', '扩展'], ['skill', '技能'], ['prompt', '提示模板']];
  const counts = groups.map(([kind, label]) => `${list.filter((e) => e.kind === kind).length} ${label}`);
  ui.pluginsSub.textContent = counts.join(' · ');
  ui.pluginsBody.innerHTML = '';
  if (list.length === 0) { ui.pluginsBody.appendChild(el('div', 'plugins-empty', '这个 Pi 进程没有加载任何扩展、技能或提示模板。')); return; }
  for (const [kind, label] of groups) {
    const items = list.filter((e) => e.kind === kind);
    if (items.length === 0) continue;
    ui.pluginsBody.appendChild(el('div', 'side-label', label));
    for (const item of items) {
      const row = el('div', 'plugin');
      const head = el('div', 'plugin-head');
      head.appendChild(el('span', 'plugin-name', item.name));
      const badge = el('span', 'plugin-badge ' + (item.origin || ''), ORIGIN_LABEL[item.origin] || item.origin || '');
      head.appendChild(badge);
      if (item.scope && SCOPE_LABEL[item.scope]) head.appendChild(el('span', 'plugin-scope', SCOPE_LABEL[item.scope]));
      row.appendChild(head);
      if (item.path) { const p = el('div', 'plugin-path', item.path); p.title = item.path; row.appendChild(p); }
      if (item.commands && item.commands.length) {
        const cmds = el('div', 'plugin-cmds');
        for (const c of item.commands) {
          const chip = el('button', 'plugin-cmd', '/' + c.name);
          chip.type = 'button';
          chip.title = (c.description || '') + '\n点击填入输入框';
          chip.addEventListener('click', () => { closePlugins(); ui.prompt.value = '/' + c.name + ' '; ui.prompt.focus(); autoGrow(); refreshComposer(); });
          cmds.appendChild(chip);
          if (c.description) cmds.appendChild(el('span', 'plugin-cmd-desc', c.description));
        }
        row.appendChild(cmds);
      } else if (kind === 'extension') {
        row.appendChild(el('div', 'plugin-cmd-desc', '未注册斜杠命令（通过事件 / 工具生效）'));
      }
      ui.pluginsBody.appendChild(row);
    }
  }
}
ui.pluginsBtn.addEventListener('click', () => { closeBrandMenu(); openPlugins(); });
ui.pluginsClose.addEventListener('click', closePlugins);
ui.pluginsModal.addEventListener('click', (e) => { if (e.target === ui.pluginsModal) closePlugins(); });

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
  const current = models.models.find((m) => m.provider === models.current?.provider && m.id === models.current?.id);
  const source = models.current?.source || current?.source || 'native';
  ui.modelSource.value = source;
  for (const option of ui.modelSource.options) option.disabled = !models.models.some((m) => (m.source || 'native') === option.value);
  ui.model.innerHTML = '';
  for (const m of models.models || []) {
    if ((m.source || 'native') !== source) continue;
    const option = document.createElement('option');
    option.value = m.provider + '/' + m.id;
    option.textContent = m.id + ' · ' + m.provider;
    ui.model.appendChild(option);
  }
  if (models.current && !current) {
    const option = document.createElement('option');
    option.value = models.current.provider + '/' + models.current.id;
    option.textContent = models.current.id + '（当前不可用，请检查 VM 登录/配置）';
    option.disabled = true;
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
  renderAgentSettings();
}
ui.model.addEventListener('change', () => {
  const [provider, ...rest] = ui.model.value.split('/');
  if (!provider || rest.length === 0) return;
  chooseModel(provider,rest.join('/'));
});
function chooseModel(provider,id) {
  modelPending=requestId('model');refreshComposer();
  send({v:1,type:'set_model',requestId:modelPending,provider,id});
}
ui.modelSource.addEventListener('change',()=>{
  const next=models?.models.find(m=>(m.source || 'native')===ui.modelSource.value);
  if(next)chooseModel(next.provider,next.id);else renderModels();
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
      toUpload.push(file); // Persist original bytes before sending the inline representation.
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
    if (!opened && !pendingOpenId && connected) { void openSession(activeId); toast('正在为文件建立对话…'); }
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
      if (xhr.status === 200) { if (u.state === 'uploading') { try{const result=JSON.parse(xhr.responseText);u.path=result.path;u.sha256=result.sha256;}catch{} u.received = u.size; u.state = u.path ? 'done' : 'finishing'; } }
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
    // Keep a transcript-side aggregate so uploads stay discoverable after the rail rolls on.
    if (!uploadLog.some((f) => f.path === u.path)) { uploadLog.push({ name: u.name, size: u.size, path: u.path }); renderUploadLogCard(); }
    return;
  }
  if (event.type === 'transfer_failed' && u.state !== 'cancelled') { u.state = 'failed'; u.error = event.message || '传输失败'; renderAttachments(); refreshComposer(); }
}

function downloadUrl(path) {
  if (!transfer || !path) return null;
  return `${transfer.url}/api/localsend/v2/download?scope=${encodeURIComponent(transfer.scope)}&token=${encodeURIComponent(transfer.token)}&fileId=${encodeURIComponent(path)}`;
}
function renderUploadLogCard() {
  let card = $('#upload-log');
  if (!uploadLog.length) { card?.remove(); return; }
  if (!card) { card = el('section', 'upload-log'); card.id = 'upload-log'; card.append(el('h3', '', '已上传文件')); ui.thread.append(card); }
  for (const child of [...card.querySelectorAll('.upload-log-row')]) child.remove();
  for (const f of uploadLog.slice(0, 20)) {
    const href = downloadUrl(f.path);
    const row = el('div', 'upload-log-row');
    row.append(el('span', 'upload-log-name', f.name + ' · ' + formatBytes(f.size)));
    if (href) { const a = el('a', '', '下载'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; row.append(a); }
    card.append(row);
  }
  if (uploadLog.length > 20) card.append(el('p', 'workspace-note', `其余 ${uploadLog.length - 20} 个文件仍在工作区可用。`));
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
function uploadsBusy() { return filesAwaitingTransfer.length>0 || uploads.some((u) => u.state === 'uploading' || u.state === 'finishing'); }
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
  ui.prompt.style.height = Math.min(ui.prompt.scrollHeight, 336) + 'px';
}
function syncToBottomPosition() {
  const height = ui.composerWrap?.getBoundingClientRect().height || 150;
  ui.app.style.setProperty('--composer-offset', Math.ceil(height + 18) + 'px');
}
if (globalThis.ResizeObserver && ui.composerWrap) new ResizeObserver(syncToBottomPosition).observe(ui.composerWrap);
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
  if(modelPending){toast('等待模型来源切换确认');return;}
  if (uploadsBusy() || uploads.some(u=>u.state==='failed')) { toast('请等待原始附件上传成功，或移除失败附件'); return; }
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
  if(workspaceState?.conversations.find(c=>c.id===id)?.archived || workspaceState?.legacyArchived?.includes(id)) {toast("请从对话菜单恢复后再打开");return;}
  if (id === activeId && opened) return;
  resetTransfers();filesAwaitingTransfer=[];attachments=[];queuedPrompt=null;workspaceSync=null;
  activeId = id;
  localStorage.setItem(ACTIVE_KEY, id);
  streaming = false;
  statsCache = null;
  selectedChangedPath = null;
  lastChangeCardSignature = '';
  resetThread();
  renderProjectContext();
  renderHeader();
  renderSessionList();
  connect();
}
function newSession(focus = true) {
  prepareNew=false;creationRequest=null;saveCreation();workspaceSync=null;resetTransfers();filesAwaitingTransfer=[];attachments=[];queuedPrompt=null;
  $('#task-kind').value='chat';ui.projectSelect.value='';ui.startBranch.value='';
  activeId = null;
  localStorage.removeItem(ACTIVE_KEY);
  streaming = false;
  statsCache = null;
  selectedChangedPath = null;
  lastChangeCardSignature = '';
  resetThread();
  renderHero();
  renderProjectContext();
  renderHeader();
  renderSessionList();
  connect();
  if (focus) ui.prompt.focus();
}

// ---------- sidebar / global ----------
$('#new-task').addEventListener('click', () => { newSession(); closeSidebarOnMobile(); });
$('#open-side').addEventListener('click', openSidebar);
$('#close-side').addEventListener('click', collapseSidebar);
function closeSidebarOnMobile() { ui.app.classList.remove('side-open'); }
ui.search.addEventListener('input', renderSessionList);
ui.scroller.addEventListener('scroll', () => ui.toBottom.classList.toggle('hidden', nearBottom()));
ui.toBottom.addEventListener('click', scrollToEnd);
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); newSession(); return; }
  if (event.key === 'Escape') {
    if (!ui.uiModal.classList.contains('hidden')) { answerUi({ cancelled: true }); return; }
    if (!ui.pluginsModal.classList.contains('hidden')) { closePlugins(); return; }
    if (!ui.modal.classList.contains('hidden')) { ui.modalCancel.click(); return; }
    if (menuNode) { closeMenu(); return; }
    if (ui.brandMenu && !ui.brandMenu.classList.contains('hidden')) { closeBrandMenu(); return; }
    if (ui.agentMenu && !ui.agentMenu.classList.contains('hidden')) { closeAgentMenu(); return; }
    if (ui.projectManage?.open) { ui.projectManage.open = false; return; }
    if (!ui.slash.classList.contains('hidden')) { ui.slash.classList.add('hidden'); return; }
    if (workspaceDetailOpen) { closeWorkspaceDetail(); return; }
    closeSidebarOnMobile();
    if (streaming && opened && document.activeElement !== ui.prompt) { send({ v: 1, type: 'abort' }); pushNote('已请求停止当前任务。'); }
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && socket && socket.readyState === WebSocket.OPEN) send({ v: 1, type: 'list_sessions' });
});
installCopyHandlers(ui.thread);

// ---------- boot ----------
applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
if (window.matchMedia('(min-width: 1100px)').matches) setWorkspaceOpen(true);
resetThread();
renderHero();
renderHeader();
renderSessionList();
autoGrow();
refreshComposer();
syncToBottomPosition();
connect();


// Project metadata stays on the VM. This panel extends the existing shell rather than replacing it.
async function workspaceApi(value) {
  const r=await fetch('/api/workspace',value ? {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)} : {});
  const data=await r.json();if(!r.ok)throw new Error(data.error || '工作区请求失败');return data;
}
function setWorkspaceOpen(open) {
  ui.app.classList.toggle('files-open', open);
  $('#workspace-panel').classList.toggle('hidden', !open);
}
async function loadWorkspace() {
  const seq=++workspaceRequestSeq;
  try {
    const hadWorkspace = Boolean(workspaceState);
    const data=await workspaceApi();if(seq!==workspaceRequestSeq)return;workspaceState=data;
    $('#project-controls').classList.remove('hidden');$('#files-toggle').classList.remove('hidden');
    if (!hadWorkspace && window.matchMedia('(min-width: 1100px)').matches) setWorkspaceOpen(true);
    const select=ui.projectSelect, old=select.value;select.replaceChildren();
    const all=document.createElement("option");all.value="";all.textContent="选择项目 / 全部任务";select.append(all);
    for(const p of data.projects){const o=document.createElement('option');o.value=p.id;o.textContent=p.name;select.append(o);}
    if(data.projects.some(p=>p.id===old))select.value=old;
    renderProjectContext();
    renderSessionList();
    const hasActive=activeId && data.conversations.some(c=>c.id===activeId);
    if(hasActive) {
      const id=activeId,c=data.conversations.find(c=>c.id===id),chat=c.workspaceKind==='chat';
      $('#migrate-workspace').classList.toggle('hidden',chat || Boolean(c.startSha));
      $('#checkpoint-workspace').classList.toggle('hidden',chat || !c.startSha);
      $('#pull-request').classList.toggle('hidden',chat || !c.startSha);
      if(c.creationState==='failed' || c.creationState==='creating')return;
      const grant=await workspaceApi({action:'files',id});
      if(activeId===id){transfer=grant;bindWorkspaceArtifacts();void refreshArtifactCards();void refreshWorkspaceStatus();void refreshWorkspaceChanges(false).then(()=>maybeRenderChangesCard()).catch(()=>undefined);}
    }
    else {workspaceChanges=null;workspaceSync=null;renderSyncState();for(const id of ['migrate-workspace','checkpoint-workspace','pull-request'])$('#'+id).classList.add('hidden');selectedChangedPath=null;if(workspaceDetailOpen)closeWorkspaceDetail();renderWorkspaceSummary();renderWorkspaceList();}
  } catch(e) {if(workspaceState){workspaceSync={...workspaceSync,state:'unknown',error:e.message};renderSyncState();renderProjectContext();}}
}
$('#task-kind').addEventListener('change',()=>{creationRequest=null;saveCreation();renderProjectContext();});
$('#create-task').addEventListener('click',async()=>{
  if(activeId && !workspaceState?.conversations.some(c=>c.id===activeId)){
    const id=activeId,workspaceKind=$('#task-kind').value,projectId=ui.projectSelect.value;
    if(workspaceKind==='project' && !projectId)return toast('请先选择项目');
    try{await workspaceApi({action:'conversation',id,workspaceKind,...(workspaceKind==='project'?{projectId,branch:ui.startBranch.value.trim() || undefined}:{})});await loadWorkspace();connect();}catch(e){toast(e.message);}return;
  }
  void openSession(null);
});
ui.projectSelect.addEventListener('change',async()=>{
  creationRequest=null;saveCreation();ui.startBranch.value='';showArchived=false;renderProjectContext();renderSessionList();
  const id=ui.projectSelect.value,list=$('#remote-branches');list.replaceChildren();if(!id || activeId)return;
  try{const branches=await workspaceApi({action:'branches',projectId:id});if(ui.projectSelect.value!==id || activeId)return;for(const branch of branches){const option=document.createElement('option');option.value=branch;list.append(option);}ui.startBranch.value=workspaceState.projects.find(p=>p.id===id)?.branch || branches[0] || '';}
  catch(e){toast('分支列表不可用，可填写已知远端分支：'+e.message);}
});
$('#show-archive').addEventListener('click',()=>{ui.projectManage.open=false;showArchived=true;renderSessionList();});
$('#show-active').addEventListener('click',()=>{ui.projectManage.open=false;showArchived=false;renderSessionList();});
$('#project-discover').addEventListener('click',async()=> {ui.projectManage.open=false;try{await workspaceApi({action:'discover'});await loadWorkspace();}catch(e){toast(e.message);}});
$('#project-add').addEventListener('click',async()=> {
  ui.projectManage.open=false;
  const name=await askModal({title:'新建项目',text:'使用英文字母、数字、短横线或下划线。已存在的目录不会被覆盖。',input:'',okLabel:'下一步'});if(!name)return;
  const source=await askModal({title:'项目来源',text:'留空创建空 Git 项目；填写 HTTP(S)/SSH Git URL 克隆。导入 ZIP 请填写 zip:文件名（先在现有对话上传）。',input:'',okLabel:'创建'});if(source===null)return;
  try {
    const data=source.startsWith('zip:') ? {action:'import',name,scope:activeId,file:source.slice(4)} : {action:'project',name,url:source || undefined};
    const p=await workspaceApi(data);await loadWorkspace();ui.projectSelect.value=p.id;showArchived=false;renderProjectContext();renderSessionList();toast('项目已创建');
  } catch(e){toast(e.message);}
});
function renderSyncState() {
  const node=$('#sync-state');if(!node)return;
  if(!workspaceSync){node.textContent='';node.classList.add('hidden');return;}
  const labels={synced:'已同步',unpublished:'未发布',ahead:'待推送',behind:'远端较新',diverged:'已分叉',unknown:'未知 / 上次值已陈旧',local:'本地文件 · 不适用 Git 同步',branch_mismatch:'分支已改变 · 暂停推送'};
  node.textContent=`${labels[workspaceSync.state] || workspaceSync.state}${workspaceSync.dirty ? ' · 有本地改动' : ''}`;
  node.title=workspaceSync.error || (workspaceSync.remoteSha ? `远端 ${workspaceSync.remoteSha.slice(0,12)} · ${workspaceSync.lastRemoteAt || ''}` : '远端分支尚未确认');node.classList.remove('hidden');node.dataset.state=workspaceSync.state;
}
async function refreshWorkspaceStatus() {
  if(!activeId)return;const id=activeId;try{const value=await workspaceApi({action:'status',id});if(id!==activeId)return;workspaceSync=value;}catch(e){if(id!==activeId)return;workspaceSync={...workspaceSync,state:'unknown',error:e.message};}renderSyncState();renderProjectContext();
}
$('#checkpoint-workspace').addEventListener('click',async()=>{
  if(!activeId)return toast('请先打开代码对话');
  try {
    const changes=workspaceChanges || await refreshWorkspaceChanges(false);const paths=changes?.checkpointPaths || [];
    if(!paths.length){workspaceSync=await workspaceApi({action:'sync',id:activeId});renderSyncState();return toast('没有待提交代码；远端 SHA 已确认');}
    const message=await askModal({title:'创建并推送 Checkpoint',text:`将提交当前审查中 ${paths.length} 个文件到 Conversation 分支。私密路径不会包含。`,input:'checkpoint: work in progress',okLabel:'提交并推送'});if(!message)return;
    workspaceSync=await workspaceApi({action:'checkpoint',id:activeId,paths,message});renderSyncState();await refreshWorkspaceChanges(false);toast('Checkpoint 已由远端 SHA 确认');
  }catch(e){await refreshWorkspaceStatus().catch(()=>undefined);toast(e.message);}
});
$('#pull-request').addEventListener('click',async()=>{
  if(!activeId)return toast('请先打开代码对话');
  try {const title=await askModal({title:'创建 Gitea PR',text:'PR 合并在 Gitea 中完成。',input:'PI Coffee Conversation changes',okLabel:'创建 / 打开'});if(!title)return;const pr=await workspaceApi({action:'pull_request',id:activeId,title});window.open(pr.url,'_blank','noopener,noreferrer');toast(`PR #${pr.number} · ${pr.state}`);}catch(e){toast(e.message);}
});
$('#migrate-workspace').addEventListener('click',async()=>{
  if(!activeId)return;
  try {
    const conversation=workspaceState.conversations.find(c=>c.id===activeId),project=workspaceState.projects.find(p=>p.id===conversation?.projectId);if(!conversation || !project)return;
    if(!project.repoUrl){const repoUrl=await askModal({title:'绑定 Gitea Repository',text:'填写无凭据的 clone URL。旧目录会保留用于回滚。',input:'',okLabel:'验证并绑定'});if(!repoUrl)return;await workspaceApi({action:'bind_project',projectId:project.id,repoUrl});}
    const plan=await workspaceApi({action:'migration_plan',id:activeId});const ok=await askModal({title:'迁移为独立 Checkout',text:`旧目录：${plan.legacyCwd}\n本地改动：${plan.dirty?'有，将复制':'无'}\n迁移完成前不会删除旧目录。`,okLabel:'开始迁移'});if(!ok)return;
    await workspaceApi({action:'migrate',id:activeId});await loadWorkspace();toast('Checkout 已迁移；旧目录仍保留');
  }catch(e){toast(e.message);}
});
function fileEndpoint(route,path) {
  if(!transfer)throw new Error('请先打开对话以获取 VM 文件授权');
  const u=new URL('/api/localsend/v2/'+route,transfer.url);u.search=new URLSearchParams({scope:transfer.scope,token:transfer.token,...(path===undefined?{}:{path})});return u.href;
}
function renderWorkspaceSummary(data=workspaceChanges) {
  const node=$('#workspace-summary');if(!node)return;
  if(!data || !data.files.length){node.replaceChildren();return;}
  const add=data.files.reduce((sum,file)=>sum+(typeof file.additions==='number' ? file.additions : 0),0);
  const del=data.files.reduce((sum,file)=>sum+(typeof file.deletions==='number' ? file.deletions : 0),0);
  node.replaceChildren(el('span','wt-add','+'+add),el('span','wt-del','−'+del));
}
async function refreshWorkspaceChanges(announce=true) {
  if(!workspaceState || !activeId || !workspaceState.conversations.some(c=>c.id===activeId)){workspaceChanges=null;selectedChangedPath=null;renderWorkspaceSummary();renderWorkspaceList();return null;}
  if(announce)toast('正在读取 Diff 与 Checks…');
  if(workspaceState.conversations.find(c=>c.id===activeId)?.workspaceKind==='chat'){workspaceChanges=null;selectedChangedPath=null;renderWorkspaceSummary();renderWorkspaceList();return null;}
  const id=activeId;const changes=await workspaceApi({action:'changes',id});if(id!==activeId)return null;workspaceChanges=changes;
  if(selectedChangedPath && !workspaceChanges.files.some((file) => file.path === selectedChangedPath)) selectedChangedPath=null;
  renderWorkspaceSummary();
  renderWorkspaceList();
  return workspaceChanges;
}
function changeFileStats(file) {
  return file.additions===null && file.deletions===null ? '未跟踪' : `+${file.additions ?? 0} −${file.deletions ?? 0}`;
}
function changedFileRow(file, { selected = false } = {}) {
  const code=file.status==='?' ? 'U' : String(file.status).toUpperCase();
  const row=el('button','file-row workspace-change-row' + (selected ? ' selected' : ''));
  row.type='button';
  row.title=`查看 ${file.path} 的 Diff`;
  row.setAttribute('aria-current',selected ? 'true' : 'false');
  const status=el('span','workspace-change-status '+code.toLowerCase(),code);
  const path=el('span','workspace-change-path',file.path);path.title=file.path;
  const stats=el('span','workspace-change-stats',changeFileStats(file));
  row.append(status,path,stats);
  return row;
}
function changedFilesCard(data) {
  const add=data.files.reduce((sum,file)=>sum+(typeof file.additions==='number' ? file.additions : 0),0);
  const del=data.files.reduce((sum,file)=>sum+(typeof file.deletions==='number' ? file.deletions : 0),0);
  const card=el('section','changes-card');
  card.setAttribute('aria-label','本轮 Checkout 变更');
  const head=el('div','changes-card-head');
  head.append(
    el('strong','changes-card-title',`已编辑 ${data.files.length} 个文件`),
    el('span','changes-card-stats',`+${add} −${del}`),
  );
  card.append(head);
  const list=el('div','changes-card-list');
  for(const file of data.files) {
    const row=changedFileRow(file,{selected:selectedChangedPath===file.path});
    row.addEventListener('click',()=>showWorkspaceReview('diff',file.path));
    list.append(row);
  }
  card.append(list);
  if(data.files.length>3) {
    const more=el('button','changes-card-more',`展开其余 ${data.files.length - 3} 个文件`);
    more.type='button';
    more.addEventListener('click',()=>{const expanded=card.classList.toggle('expanded');more.textContent=expanded ? '收起文件列表' : `展开其余 ${data.files.length - 3} 个文件`;});
    card.append(more);
  }
  const actions=el('div','changes-card-actions');
  const review=el('button','btn small','Review changes');
  review.type='button';review.addEventListener('click',()=>showWorkspaceReview('diff'));
  actions.append(review);
  card.append(actions);
  return card;
}
function maybeRenderChangesCard(data=workspaceChanges) {
  if(!data || streaming || !data.files.length) return;
  const signature=activeId + ':' + data.target + ':' + data.files.map((file) => [file.path,file.status,file.additions,file.deletions].join(':')).join('|');
  if(signature===lastChangeCardSignature) return;
  lastChangeCardSignature=signature;
  appendNode(changedFilesCard(data));
}
function patchForFile(patch,path) {
  if(!patch || !path) return '';
  const sections=patch.split(/(?=^diff --git )/m).filter(Boolean);
  for(const section of sections) {
    let target=section.match(/^diff --git [^\n]* b\/(.+)$/m)?.[1] || section.match(/^\+\+\+ b\/(.+)$/m)?.[1];
    if(target?.startsWith('"') && target.endsWith('"'))target=target.slice(1,-1).replace(/\\(["\\])/g,'$1');
    if(target===path)return section;
  }
  return '';
}
function middleTruncate(path,max=24) {
  if(path.length<=max)return path;
  const base=path.split('/').pop() || path;
  const head=(path.split('/')[0] || '').slice(0,12);
  let out=(head && base!==path) ? head+'…'+base : base;
  if(out.length>max){const keep=Math.floor((max-1)/2);out=out.slice(0,keep)+'…'+out.slice(-(max-1-keep));}
  return out;
}
function renderWorkspaceList(data=workspaceChanges) {
  const node=$('#workspace-list');if(!node)return;
  node.replaceChildren();
  if(!workspaceState || !activeId || !workspaceState.conversations.some(c=>c.id===activeId)){node.append(el('p','workspace-empty','打开项目对话以查看变更。'));return;}
  if(!data){node.append(el('p','workspace-empty','正在读取变更…'));return;}
  if(!data.files.length){node.append(el('p','workspace-empty','没有变更。'));return;}
  for(const file of data.files) {
    const row=el('button','wt-file'+(selectedChangedPath===file.path ? ' selected' : ''));
    row.type='button';
    row.title=file.path;row.setAttribute('aria-label',`查看 ${file.path} 的 Diff`);
    const stats=el('span','wt-file-stats');
    if(typeof file.additions==='number' && file.additions>0)stats.append(el('span','wt-add','+'+file.additions));
    if(typeof file.deletions==='number' && file.deletions>0)stats.append(el('span','wt-del','−'+file.deletions));
    if(!stats.children.length)stats.append(el('span','wt-new',file.status==='?' ? '未跟踪' : '±0'));
    row.append(el('span','wt-file-name',middleTruncate(file.path)),stats);
    row.addEventListener('click',()=>showWorkspaceReview('diff',file.path));
    node.append(row);
  }
}
function setReviewTab(tab) {
  for(const [id,name] of [['files-diff','diff'],['files-checks','checks']]) {
    const active=Boolean(tab) && tab===name;
    $('#'+id).classList.toggle('active',active);
    $('#'+id).setAttribute('aria-selected',String(active));
  }
}
function closeWorkspaceDetail() {
  workspaceDetailOpen=false;
  selectedChangedPath=null;
  $('#workspace-panel').classList.remove('detail-open');
  $('#workspace-detail').classList.add('hidden');
  setReviewTab('diff');
  renderWorkspaceList();
}
function reviewHead(label,{wrapToggle=true}={}) {
  const head=el('div','wt-detail-head');
  const back=el('button','btn small','‹ 返回');back.type='button';back.title='返回变更文件列表';
  back.addEventListener('click',closeWorkspaceDetail);
  head.append(back,el('span','wt-detail-title',label));
  if(wrapToggle) {
    const wrap=el('button','btn small',diffWrapped ? '折行' : '换行关');
    wrap.type='button';wrap.title='切换 Diff 换行';wrap.setAttribute('aria-pressed',String(diffWrapped));
    wrap.addEventListener('click',()=>{diffWrapped=!diffWrapped;renderWorkspaceDiff(workspaceChanges);});
    head.append(wrap);
  }
  return head;
}
function renderWorkspaceDiff(data, path=selectedChangedPath) {
  selectedChangedPath=path && data.files.some((file) => file.path===path) ? path : null;
  const detail=$('#workspace-detail');detail.replaceChildren();
  detail.append(reviewHead(selectedChangedPath || '全部变更'));
  const meta=el('div','workspace-diff-meta');
  meta.append(el('span','','branch '+data.branch),el('span','','base '+data.base.slice(0,12)),el('span','','target '+data.target.slice(0,12)),el('span',data.stale?'workspace-warning':'',data.stale?'远端刷新失败 · 基线可能陈旧':'刷新 '+data.refreshedAt));
  detail.append(meta);
  const file=data.files.find((item) => item.path===selectedChangedPath);
  detail.append(el('pre','workspace-stat',selectedChangedPath ? file ? `${file.path}\n${changeFileStats(file)}` : selectedChangedPath : data.stat));
  const patch=selectedChangedPath ? patchForFile(data.patch,selectedChangedPath) : data.patch;
  const body=el('div','workspace-patch' + (diffWrapped ? ' wrapped' : ' unwrapped'));
  body.innerHTML=patch ? renderPatchText(patch) : selectedChangedPath ? '<div class="workspace-empty">该文件没有可直接显示的文本 Diff；可能是二进制、超大小或被安全边界排除。</div>' : '<div class="workspace-empty">没有已跟踪或未跟踪的文本变更。</div>';
  detail.append(body);
  if(data.truncated)detail.append(el('p','workspace-warning','Diff 过大，仅显示前 150 KB；请在 VM 使用 git diff 查看完整内容。'));
}
function renderWorkspaceChecks(data) {
  const detail=$('#workspace-detail');detail.replaceChildren();
  detail.append(reviewHead('Checks · '+data.branch,{wrapToggle:false}));
  for(const check of data.checks) {
    const card=el('div','workspace-check '+(check.ok ? 'ok' : 'failed'));
    const head=el('div','workspace-check-head');
    head.append(el('span','workspace-check-icon',check.ok ? '✓' : '!'),el('strong','',check.command),el('span','workspace-check-state',check.ok ? '通过' : '发现问题'));
    card.append(head,el('pre','workspace-check-output',check.output || (check.ok ? 'clean' : '无输出')));
    detail.append(card);
  }
  detail.append(el('p','workspace-note','当前 Checks 是 Checkout 的本地 git diff --check；不会自动运行测试或远程 CI。'));
}
async function showWorkspacePreview(path) {
  if(!workspaceState || !transfer || !activeId){toast('请先打开项目对话');return;}
  workspaceDetailOpen=true;
  setWorkspaceOpen(true);
  setReviewTab('');
  $('#workspace-panel').classList.add('detail-open');
  const detail=$('#workspace-detail');detail.classList.remove('hidden');
  detail.replaceChildren();
  detail.append(reviewHead('预览 · '+middleTruncate(path),{wrapToggle:false}));
  const actions=el('div','workspace-preview-actions');
  const open=el('a','btn small','外部打开');open.href=fileEndpoint('preview',path);open.target='_blank';open.rel='noopener noreferrer';
  const download=el('a','btn small','下载');download.href=fileEndpoint('workspace-download',path);download.target='_blank';download.rel='noopener noreferrer';
  actions.append(open,download);detail.append(actions);
  const url=fileEndpoint('preview',path);
  if(/\.(png|jpe?g|gif|webp|svg)$/i.test(path)) {
    const img=document.createElement('img');img.src=url;img.alt=path;img.loading='lazy';
    img.onerror=()=>detail.append(el('p','workspace-warning','图片加载失败，请外部打开或下载。'));
    detail.append(img);return;
  }
  if(/\.pdf$/i.test(path)) {
    const frame=document.createElement('iframe');frame.src=url;frame.title=path;frame.referrerPolicy='no-referrer';frame.setAttribute('sandbox','');
    frame.onerror=()=>detail.append(el('p','workspace-warning','沙箱内无法渲染 PDF，请外部打开或下载。'));
    detail.append(frame,el('p','workspace-note','PDF 在沙箱中预览；需要完整查看时请外部打开或下载。'));return;
  }
  try {
    const r=await fetch(url);
    if(!r.ok)throw new Error('预览不可用，请下载');
    if(!/^(text\/|application\/json)/i.test(r.headers.get('content-type') || ''))throw new Error('此格式不支持文本预览，请下载');
    const text=await r.text();
    if(selectedChangedPath!==null)selectedChangedPath=null;
    if(/\.md$/i.test(path)){const body=el('div','markdown');body.innerHTML=renderMarkdown(text);detail.append(body);bindWorkspaceArtifacts();}
    else detail.append(el('pre','file-text',text));
  } catch(e){detail.append(el('p','workspace-warning',e.message));}
}
async function showWorkspaceReview(tab,path=null) {
  if(!workspaceState || !activeId){toast('请先打开项目对话');return;}
  if(tab==='diff')selectedChangedPath=path;else selectedChangedPath=null;
  workspaceDetailOpen=true;
  setWorkspaceOpen(true);
  setReviewTab(tab);
  $('#workspace-panel').classList.add('detail-open');
  const detail=$('#workspace-detail');detail.classList.remove('hidden');
  detail.replaceChildren(el('p','workspace-empty','正在读取 Diff / Checks…'));
  try {
    const data=await refreshWorkspaceChanges(false);
    if(!data)return;
    if(tab==='checks')renderWorkspaceChecks(data);
    else renderWorkspaceDiff(data,path);
  }
  catch(e){detail.replaceChildren(el('p','workspace-empty',e.message));toast(e.message);}
}
async function downloadWorkspacePatch() {
  if(!workspaceState || !activeId){toast('请先打开项目对话');return;}
  const data=workspaceChanges || await refreshWorkspaceChanges(false);
  if(!data)return;
  if(!data.patch){toast('没有可下载的文本变更');return;}
  const blob=new Blob([data.patch],{type:'text/plain;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=((data.projectId || 'workspace')+'-'+(data.branch || 'changes')+'.patch').replace(/[^\w.-]+/g,'-');
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  if(data.truncated)toast('补丁仅含前 150 KB；完整内容请在 VM 使用 git diff 导出。');
}
$('#files-toggle').addEventListener('click',()=>{const open=!ui.app.classList.contains('files-open');setWorkspaceOpen(open);if(open){renderWorkspaceList();void refreshWorkspaceChanges(false).catch(e=>toast(e.message));}});
$('#files-close').addEventListener('click',()=>setWorkspaceOpen(false));
$('#files-diff').addEventListener('click',closeWorkspaceDetail);
$('#files-checks').addEventListener('click',()=>{showWorkspaceReview('checks').catch(e=>toast(e.message));});
$('#view-all-changes').addEventListener('click',()=>{showWorkspaceReview('diff').catch(e=>toast(e.message));});
$('#wt-download').addEventListener('click',()=>{void downloadWorkspacePatch().catch(e=>toast(e.message));});
void loadWorkspace();
setInterval(()=>{if(!document.hidden || uploadsBusy())void loadWorkspace();},5000);
fetch('/api/me').then(r=>r.ok?r.json():null).then(user=>{if(!user)return;const account=el('button','foot-btn',user.login+' · 退出');account.onclick=async()=>{await fetch('/auth/logout',{method:'POST'});localStorage.removeItem(ACTIVE_KEY);location.href='/auth/login';};$('.sidebar-foot').append(account);}).catch(()=>{});

function bindWorkspaceArtifacts() {
 if(!workspaceState || !transfer)return;
 for(const node of document.querySelectorAll('[data-workspace-path]')) {
  const path=node.getAttribute('data-workspace-path');
  const url=fileEndpoint(node.hasAttribute('data-workspace-download')?'workspace-download':'preview',path);
  if(node.tagName==='IMG'){if(node.getAttribute('src')!==url)node.src=url;}
  else {node.href=url;node.target='_blank';node.rel='noopener noreferrer';}
 }
}
new MutationObserver(()=>bindWorkspaceArtifacts()).observe(ui.thread,{childList:true,subtree:true});

let artifactSignature='';
async function refreshArtifactCards() {
 if(!workspaceState || !transfer || !activeId)return;
 const id=activeId;
 try {
  const r=await fetch(fileEndpoint('artifacts'));if(!r.ok)return;const data=await r.json();if(id!==activeId)return;
  const signature=id+JSON.stringify(data.artifacts)+transfer.token;
  if(signature===artifactSignature && $('#generated-artifacts'))return;
  artifactSignature=signature;$('#generated-artifacts')?.remove();
  if(!data.artifacts?.length)return;
  const section=el('section','generated-artifacts');section.id='generated-artifacts';section.append(el('h3','','工作区产物'));
  for(const file of data.artifacts.slice(0,20)) {
    const card=el('div','generated-card');card.append(el('span','',file.path));
    if(!file.available)card.append(el('span','', '文件已移除或不可访问'));
    else {
      const open=el('a','','打开');open.href=fileEndpoint('preview',file.path);open.target='_blank';open.rel='noopener noreferrer';open.addEventListener('click',(e)=>{e.preventDefault();void showWorkspacePreview(file.path);});
      const download=el('a','','下载');download.href=fileEndpoint('workspace-download',file.path);download.target='_blank';download.rel='noopener noreferrer';card.append(open,download);
      if(/\.(png|jpe?g|gif|webp|svg)$/i.test(file.path)){const img=document.createElement('img');img.src=open.href;img.alt=file.path;img.onerror=()=>{img.alt='预览不可用：'+file.path;};const link=open.cloneNode(false);link.append(img);card.append(link);}
    }
    section.append(card);
  }
  ui.thread.append(section);
 }catch { /* Browsing failure must not fail the running chat. Refresh/reconnect can retry. */ }
}
