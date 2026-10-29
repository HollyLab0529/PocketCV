// 口袋简历 PocketCV · 后台：存储路由、网页连接、填写调度、AI 接口转发

import { createStore } from './src/infra/storage-core.js';

const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const store = createStore({
  async get(key) { await storageReady; return (await chrome.storage.local.get(key))[key]; },
  async set(key, value) { await storageReady; await chrome.storage.local.set({ [key]: value }); },
});

let writes = Promise.resolve();
const serialize = (fn) => { const next = writes.then(fn); writes = next.catch(() => {}); return next; };

const INTERNAL_PAGES = new Set(['panel.html', 'manager.html']);
const trusted = (sender) => {
  if (sender.id !== chrome.runtime.id || !sender.url) return false;
  try {
    const u = new URL(sender.url);
    return sender.url.startsWith(chrome.runtime.getURL('')) && INTERNAL_PAGES.has(u.pathname.slice(1));
  } catch { return false; }
};

const targets = new Map(); // tabId -> { tabId, frameId, documentId, token, label, kind, inputType, origin }
const undos = new Map();   // tabId -> { documentId }
const publish = () => chrome.runtime.sendMessage({ type: 'TARGET_UPDATED' }).catch(() => {});

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('没有可用的网页标签。');
  return tab;
}

async function connect(tabId) {
  const tab = tabId ? await chrome.tabs.get(tabId) : await activeTab();
  if (!tab.id || !/^https?:\/\//.test(tab.url || '')) throw new Error('请在招聘网页点击工具栏的口袋简历图标；浏览器内部页与商店页不支持填表。');
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['bridge/content.js'] });
  } catch {
    throw new Error('还没有当前网页的访问权限：请在此网页再次点击工具栏图标完成授权。');
  }
  chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['bridge/content.js'] }).catch(() => {});
  return { tabId: tab.id, origin: new URL(tab.url).origin, target: targets.get(tab.id) || null };
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  connect(tab.id).catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => { storageReady.catch(() => {}); });
chrome.tabs.onRemoved.addListener((id) => { targets.delete(id); undos.delete(id); publish(); });
chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'loading') { targets.delete(id); undos.delete(id); publish(); } });
chrome.tabs.onActivated.addListener(() => publish());

chrome.runtime.onMessage.addListener((request, sender, respond) => {
  if (!request || typeof request.type !== 'string') return false;

  // 来自网页桥接脚本：更新「当前填写目标」
  if (request.type === 'FOCUS') {
    if (sender.id !== chrome.runtime.id || !sender.tab?.id || !sender.documentId || !/^https?:\/\//.test(sender.url || '')) return false;
    const id = sender.tab.id;
    if (typeof request.token === 'string' && request.token.length <= 80 && typeof request.label === 'string' && request.label.length <= 120) {
      targets.set(id, {
        tabId: id,
        frameId: sender.frameId || 0,
        documentId: sender.documentId,
        token: request.token,
        label: request.label,
        kind: String(request.kind || '').slice(0, 20),
        inputType: String(request.inputType || '').slice(0, 20),
        origin: new URL(sender.url).origin,
      });
    } else if (targets.get(id)?.documentId === sender.documentId) {
      targets.delete(id);
    }
    publish();
    respond({ ok: true });
    return false;
  }

  if (!trusted(sender)) {
    if (request.type !== 'TARGET_UPDATED') respond({ ok: false, error: '不允许此来源访问资料。', code: 'FORBIDDEN' });
    return false;
  }

  const run = async () => {
    switch (request.type) {
      case 'LOAD': return serialize(() => store.load());
      case 'SAVE': return serialize(() => store.save(request.profile, request.rev, request.checkpoint, request.epoch));
      case 'REPLACE': return serialize(() => store.replaceAll(request.profile, request.checkpoint));
      case 'HISTORY': return serialize(() => store.history());
      case 'ERASE': return serialize(() => store.erase());
      case 'AI_CHAT': return aiChat(request);
      case 'CONNECT': return connect();
      case 'STATUS': {
        const tab = await activeTab();
        return {
          tabId: tab.id,
          origin: /^https?:\/\//.test(tab.url || '') ? new URL(tab.url).origin : '',
          target: targets.get(tab.id) || null,
          undoAvailable: undos.has(tab.id),
        };
      }
      case 'FILL': {
        const tab = await activeTab();
        const target = targets.get(tab.id);
        if (!target || request.tabId !== tab.id || request.token !== target.token) throw new Error('当前页面或输入框已变化，请在网页重新点选。');
        if (typeof request.value !== 'string' || !request.value || request.value.length > 32767) throw new Error('待填内容无效。');
        const result = await chrome.tabs.sendMessage(tab.id, { type: 'WRITE_FIELD', token: target.token, value: request.value }, { documentId: target.documentId });
        if (!result?.ok) throw new Error(result?.error || '网页没有响应，请重新点选输入框。');
        undos.set(tab.id, { documentId: target.documentId });
        publish();
        return result.data;
      }
      case 'UNDO_FILL': {
        const tab = await activeTab();
        const undo = undos.get(tab.id);
        if (!undo) throw new Error('当前页面没有可撤回的填写。');
        const result = await chrome.tabs.sendMessage(tab.id, { type: 'UNDO_FIELD' }, { documentId: undo.documentId });
        if (!result?.ok) throw new Error(result?.error || '不能撤回，请核对网页。');
        undos.delete(tab.id);
        publish();
        return result.data;
      }
      default: throw new Error('不支持此操作。');
    }
  };
  run().then(
    (data) => respond({ ok: true, data }),
    (error) => respond({ ok: false, error: error.message || '操作失败。', code: error.code || 'ERROR' }),
  );
  return true;
});

// ===== AI 接口转发（OpenAI 兼容 /chat/completions）=====
async function aiChat(request) {
  const { baseUrl, apiKey, model, messages } = request;
  if (!Array.isArray(messages) || !messages.length || messages.some((m) => typeof m?.content !== 'string')) throw new Error('AI 请求内容无效。');
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('请先在「AI 设置」里填写 API Key。');
  if (typeof baseUrl !== 'string' || !/^https:\/\/[\w.-]+/.test(baseUrl)) throw new Error('接口地址无效，必须是 https:// 开头的地址。');
  const endpoint = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey.trim() },
        body: JSON.stringify({ model: (typeof model === 'string' && model.trim()) || 'deepseek-chat', messages, temperature: 0.4 }),
      });
    } catch (networkError) {
      if (networkError?.name === 'AbortError') throw new Error('请求超时（120 秒），请稍后重试。');
      throw new Error('无法连接接口（' + (networkError?.message || '网络错误') + '）。请确认接口地址正确，且域名在扩展网络权限内。');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`接口返回 ${res.status}${text ? `：${text.slice(0, 300)}` : ''}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('接口没有返回有效内容，请检查模型名是否正确。');
    return { content: content.trim() };
  } finally {
    clearTimeout(timer);
  }
}
