// 口袋简历 PocketCV · 应用入口
// 第 2 期：分类分层导航 + 记录/字段完整管理 + 全局搜索 + 敏感遮挡 + 主题切换
import { validateProfile, stats, starterProfile, templateProfile, makeModule, makeEntry, makeField, getEntry, clone, emptyProfile, LIMITS, TIERS, TYPES, TYPE_NAMES, moveItem, summary, searchable, mask, uid } from '../domain/model.js';
import { createRepository, isExtension, message } from '../infra/repository.js';
import { encryptProfile, decryptProfile } from '../infra/vault.js';
import { exportProfileWorkbook, importProfileWorkbook } from '../infra/xlsx.js';
import { h, icon, button, inputLabel, saveFile, modal, confirmAction } from './kit.js';

const panel = document.body.dataset.view === 'panel';
// ?debug=fill ：非扩展环境预览填写模式（本地页面/联调用；扩展内无副作用）
const panelDebug = panel && new URLSearchParams(location.search).has('debug');
const fillMode = panel && (isExtension() || panelDebug);   // 面板 + 扩展环境：网页填写模式
const repo = await createRepository();
const root = document.getElementById('app');
const toastRoot = document.getElementById('toast-region');

let profile = null;
let revision = 0;
let epoch = 0;
let dirty = false;
let saving = false;
let saveTimer = null;
let saveError = '';
let historyInfo = null;
let toastTimer = null;

let selected = '';            // 当前分类 id
let query = '';               // 搜索关键词
const collapsed = new Set();   // 收起的记录 id
const revealed = new Set();    // 已点开显示的敏感字段 id

// ===== 填写模式状态 =====
const PREFS_KEY = 'pocketcv.prefs.v1';
let prefs = (() => {
  try { const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); return { hideEmpty: raw.hideEmpty === true }; }
  catch { return { hideEmpty: false }; }
})();
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* 仅本次会话生效 */ } };
let target = null;             // 当前网页填写目标 { tabId, token, label, kind, inputType, origin }
let undoAvailable = false;     // 当前网页是否有可撤回的填写
let bannerNode = null;
const sessionTrusted = new Set(); // 本次会话内已确认过的网站 origin

const toast = (text, error = false) => {
  clearTimeout(toastTimer);
  toastRoot.replaceChildren(h('div', { class: `toast${error ? ' error' : ''}`, text }));
  toastTimer = setTimeout(() => toastRoot.replaceChildren(), error ? 9000 : 4200);
};
const errorMessage = (e) => (e instanceof Error ? e.message : String(e));
const currentModule = () => profile.modules.find((m) => m.id === selected) || profile.modules[0];

/** 清洗外部数据里的垃圾文本（如别的工具导出的 "nullnull"），只处理可空字段 */
function sanitizeDirtyText(p) {
  const dirty = (v) => typeof v === 'string' && /^null+$/i.test(v.trim());
  for (const m of p.modules) {
    if (dirty(m.name)) m.name = '未命名分类';
    for (const e of m.entries) {
      if (dirty(e.title)) e.title = '未命名记录';
      for (const f of e.fields) {
        if (dirty(f.group)) f.group = '';
        if (dirty(f.label)) f.label = '未命名字段';
      }
    }
  }
  return p;
}

function updateStatus() {
  const s = stats(profile);
  const node = document.getElementById('save-state');
  if (!node) return;
  node.dataset.error = String(!!saveError);
  node.replaceChildren(
    h('span', { class: 'save-dot' }),
    h('span', { text: saveError ? '保存失败' : saving ? '保存中…' : dirty ? '待保存' : '已保存' }),
    h('span', { text: ` · ${s.modules} 分类 · ${s.entries} 记录 · ${s.filled} 项已填` }),
  );
}

function markDirty() {
  dirty = true;
  saveError = '';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flush(), 550);
  updateStatus();
}

async function flush() {
  clearTimeout(saveTimer);
  if (!dirty || !profile) return true;
  if (saving) return true;
  saving = true;
  dirty = false;
  updateStatus();
  try {
    const validated = validateProfile(profile);
    const result = await repo.save(validated, revision, '', epoch);
    // 只回写标量字段、保留原树引用：输入框闭包仍指向这棵树，避免第二次编辑丢失。
    profile.updatedAt = result.profile.updatedAt;
    profile.revision = result.profile.revision;
    return true;
  } catch (error) {
    dirty = true;
    saveError = errorMessage(error);
    updateStatus();
    return false;
  } finally {
    saving = false;
    updateStatus();
  }
}

function commit(mutator, checkpoint = '') {
  const before = clone(profile);
  try {
    mutator(profile);
    profile = validateProfile(profile);
  } catch (error) {
    profile = before;
    toast(errorMessage(error), true);
    return false;
  }
  if (checkpoint) historyInfo = { label: checkpoint, profile: before };
  markDirty();
  render();
  return true;
}

async function flushWithHistory() {
  if (historyInfo && !dirty) {
    try {
      await repo.replaceAll(profile, historyInfo.label);
      historyInfo = null;
      return true;
    } catch (error) {
      toast(errorMessage(error), true);
      return false;
    }
  }
  return flush();
}

// ===== 主题（莫兰迪色板） =====
const THEMES = [
  { id: 'haze', name: '雾霾蓝', dot: '#7d93a8', tag: '默认 · 安静专注' },
  { id: 'sage', name: '灰豆绿', dot: '#7f9483', tag: '温和清新' },
  { id: 'oat', name: '燕麦杏', dot: '#ab8d6f', tag: '暖调 · 燕麦拿铁' },
  { id: 'lilac', name: '灰藤紫', dot: '#8f81a1', tag: '柔和优雅' },
  { id: 'rose', name: '豆沙粉', dot: '#ad7f7f', tag: '低饱和暖粉' },
];
const THEME_KEY = 'pocketcv.theme.v1';
function loadTheme() {
  try {
    const id = localStorage.getItem(THEME_KEY);
    return THEMES.some((t) => t.id === id) ? id : THEMES[0].id;
  } catch { return THEMES[0].id; }
}
function applyTheme(id) {
  if (!THEMES.some((t) => t.id === id)) id = THEMES[0].id;
  document.documentElement.dataset.theme = id;
  try { localStorage.setItem(THEME_KEY, id); } catch { /* 无存储时仅本次会话生效 */ }
  return id;
}
let themeId = applyTheme(loadTheme());
let themeBtn = null;
const themeName = () => THEMES.find((t) => t.id === themeId)?.name || '';

async function themeDialog() {
  await modal('界面配色', ({ body, foot, finish }) => {
    body.append(h('p', { class: 'modal-description', text: '莫兰迪色系，点选立即生效，偏好保存在本机。' }));
    const list = h('div', { class: 'theme-list' });
    const paint = () => [...list.children].forEach((row, i) => {
      row.dataset.active = String(THEMES[i].id === themeId);
      row.querySelector('.theme-check')?.remove();
      if (THEMES[i].id === themeId) row.append(h('span', { class: 'theme-check', text: '✓' }));
    });
    for (const t of THEMES) {
      list.append(h('button', {
        type: 'button', class: 'theme-row', 'data-active': String(t.id === themeId),
        on: { click: () => {
          themeId = applyTheme(t.id);
          if (themeBtn) themeBtn.replaceChildren(icon('settings'), h('span', { text: `主题 · ${themeName()}` }));
          paint();
        } },
      },
      h('span', { class: 'theme-dot', style: `background:${t.dot}` }),
      h('span', { text: t.name }),
      h('span', { class: 'theme-tag', text: t.tag }),
      h('span', { class: 'spacer' }),
      t.id === themeId ? h('span', { class: 'theme-check', text: '✓' }) : null));
    }
    body.append(list);
    foot.append(h('span', { class: 'spacer' }), button('完成', () => finish(null), { kind: 'primary' }));
  });
}

// ===== 填写模式：连接网页、填入、撤回 =====
async function refreshTarget() {
  if (!fillMode) return;
  try {
    const status = await message('STATUS');
    target = status?.target || null;
    undoAvailable = !!status?.undoAvailable;
  } catch {
    target = null;
    undoAvailable = false;
  }
  renderBanner();
}

async function connectPage() {
  try {
    await message('CONNECT');
    await refreshTarget();
  } catch (error) {
    toast(errorMessage(error), true);
  }
}

function renderBanner() {
  if (!bannerNode) return;
  bannerNode.replaceChildren();
  if (target && target.token) {
    bannerNode.append(
      icon('target', 15),
      h('span', { class: 'banner-text' },
        h('span', { class: 'banner-label', text: '目标输入框' }),
        h('span', { class: 'banner-target', text: target.label, title: target.label }),
        h('span', { class: 'banner-origin', text: target.origin })),
      h('span', { class: 'spacer' }),
      button('撤销填写', undoFill, { kind: 'quiet', symbol: 'undo', disabled: !undoAvailable }),
      button('重新连接', connectPage, { kind: 'quiet', symbol: 'target' }));
  } else {
    bannerNode.append(
      icon('target', 15),
      h('span', { class: 'banner-text' },
        h('span', { class: 'banner-label', text: '未连接网页' }),
        h('span', { class: 'banner-hint', text: '先在招聘网页点一下要填的输入框，再回来点「填入」。', title: '先在招聘网页点一下要填的输入框，再回来点「填入」。' })),
      h('span', { class: 'spacer' }),
      button('连接当前网页', connectPage, { kind: 'primary', symbol: 'target' }));
  }
}

async function sensitiveConsent(field) {
  if (!field.sensitive) return true;
  if (target && sessionTrusted.has(target.origin)) return true;
  const trust = await modal('确认填写敏感信息', ({ body, foot, finish }) => {
    const again = h('input', { type: 'checkbox' });
    body.append(
      h('p', { class: 'modal-description', text: `「${field.label}」是敏感字段，将写入网页 ${target ? target.origin : ''}。请确认这是正规招聘网站且输入框用途正确。` }),
      h('label', { class: 'check-row' }, again, h('span', { text: '本次会话内，此站点不再询问' })));
    foot.append(h('span', { class: 'spacer' }),
      button('取消', () => finish(null), { kind: 'quiet' }),
      button('确认', () => finish({ ok: true, trust: again.checked }), { kind: 'primary' }));
  });
  if (!trust) return false;
  if (trust.trust && target) sessionTrusted.add(target.origin);
  return true;
}

async function fillField(field) {
  if (!field.value) { toast('该字段还没有内容，先去资料页填写。', true); return; }
  if (!target?.token) {
    await connectPage();
    if (!target?.token) { toast('请先在网页点选要填的输入框。', true); return; }
  }
  if (!await sensitiveConsent(field)) return;
  try {
    const result = await message('FILL', { tabId: target.tabId, token: target.token, value: field.value });
    undoAvailable = true;
    renderBanner();
    toast(`已填入「${field.label}」（${result?.characters ?? field.value.length} 字符），请在网页核对。`);
  } catch (error) {
    await refreshTarget();
    toast(errorMessage(error), true);
  }
}

async function copyField(field) {
  if (!field.value) { toast('该字段还没有内容。', true); return; }
  if (!await sensitiveConsent(field)) return;
  try {
    await navigator.clipboard.writeText(field.value);
    toast(`已复制「${field.label}」，敏感内容请粘贴后及时核对并清空剪贴板。`);
  } catch {
    viewField(field, '无法访问剪贴板');
  }
}

async function viewField(field, note = '') {
  await modal(field.label, ({ body, foot, finish }) => {
    if (note) body.append(h('p', { class: 'modal-description', text: note }));
    body.append(h('pre', { class: 'field-fulltext', text: field.value }));
    foot.append(h('span', { class: 'spacer' }),
      button('复制', () => navigator.clipboard.writeText(field.value).catch(() => {}), { kind: 'quiet', symbol: 'copy' }),
      button('关闭', () => finish(null), { kind: 'primary' }));
  });
}

async function undoFill() {
  try {
    const result = await message('UNDO_FILL');
    toast(`已撤回${result?.label ? `「${result.label}」` : ''}的填写。`);
  } catch (error) {
    toast(errorMessage(error), true);
  } finally {
    refreshTarget();
  }
}

// ===== 填写模式：字段行（高密度：点行即填，对齐小师弟） =====
function renderFillField(e, f) {
  const empty = !f.value;
  const showValue = f.sensitive && !revealed.has(f.id) ? mask(f.value) : (f.value.split('\n')[0] || '未填写');
  const row = h('div', { class: `fill-field${empty ? ' empty' : ''}`, role: 'button', tabindex: empty ? '-1' : '0',
    'aria-label': `填入${f.label}`, title: empty ? `${f.label}：还未填写` : `点击填入${f.label}` },
    h('span', { class: 'fill-name', text: f.label, title: f.label + (f.group ? ` · ${f.group}` : '') }),
    f.sensitive ? h('span', { class: 'fill-lock', 'aria-hidden': 'true' }, icon('lock', 12)) : null,
    h('span', { class: 'fill-value', text: showValue, title: empty ? '' : f.value.split('\n')[0] }),
    h('span', { class: 'fill-actions', on: { click: (ev) => ev.stopPropagation() } },
      f.sensitive ? button('', () => { if (revealed.has(f.id)) revealed.delete(f.id); else revealed.add(f.id); render(); }, { kind: 'quiet icon-only', symbol: 'eye', title: (revealed.has(f.id) ? '隐藏' : '查看') + f.label }) : null,
      !f.sensitive && !empty ? button('', () => aiFieldDialog(f), { kind: 'quiet icon-only', symbol: 'spark', title: `AI 按 JD 改写${f.label}` }) : null,
      button('', () => copyField(f), { kind: 'quiet icon-only', symbol: 'copy', title: '复制' + f.label, disabled: empty })));
  // h() 会过滤 null 子节点；切勿改回 row.append(..., 条件 ? x : null, ...)（原生 append 会把字面 null 画成 'null' 文本）
  if (!empty) {
    row.addEventListener('click', () => fillField(f));
    row.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); fillField(f); } });
  }
  return row;
}

/** 首次使用 AI 时引导配置；返回配置或 null */
async function ensureAiConfig(purpose) {
  let config = loadAiConfig();
  if (config) return config;
  const go = await modal(purpose, ({ body, foot, finish }) => {
    body.append(h('p', { class: 'modal-description', text: `${purpose}需要先配置一个 OpenAI 兼容接口（DeepSeek、通义、智谱、Kimi 等均可）。API Key 只保存在本机。` }));
    foot.append(h('span', { class: 'spacer' }),
      button('取消', () => finish(null), { kind: 'quiet' }),
      button('打开 AI 设置', () => finish(true), { kind: 'primary' }));
  });
  if (!go) return null;
  return aiSettingsDialog();
}

/** 单字段 AI 改写：JD 记住上次输入；预览后采纳或复制 */
async function aiFieldDialog(field) {
  const config = await ensureAiConfig(`用 AI 按 JD 改写「${field.label}」`);
  if (!config) return;
  const JD_KEY = 'pocketcv.ai.jd.v1';
  let lastJd = '';
  try { lastJd = localStorage.getItem(JD_KEY) || ''; } catch { /* 忽略 */ }
  const jd = h('textarea', { class: 'ai-jd', rows: 6, placeholder: '粘贴目标岗位 JD（记住上次输入）…', 'aria-label': '目标岗位 JD' });
  jd.value = lastJd;
  const orig = h('div', { class: 'ai-orig', text: `原：${field.value.split('\n')[0]}${field.value.includes('\n') ? '…' : ''}`, title: field.value });
  const status = h('p', { class: 'ai-status', 'data-error': 'true', hidden: true });
  const action = await modal(`AI 改写 · ${field.label}`, ({ body, foot, finish }) => {
    const build = () => {
      body.replaceChildren(
        inputLabel('目标岗位 JD', jd),
        orig, status,
        h('p', { class: 'ai-status', text: 'AI 只基于现有内容改写，不编造；确认前不会写入资料。' }));
      foot.replaceChildren(h('span', { class: 'spacer' }),
        button('取消', () => finish(null), { kind: 'quiet' }),
        button('生成建议', generate, { kind: 'primary' }));
    };
    const generate = async () => {
      const jdText = jd.value.trim();
      if (jdText.length < 20) { status.hidden = false; status.textContent = '请粘贴更完整的 JD（至少 20 字）。'; return; }
      try { localStorage.setItem(JD_KEY, jdText); } catch { /* 忽略 */ }
      body.replaceChildren(h('p', { class: 'modal-description', text: '正在生成建议，最长约 2 分钟…' }));
      foot.replaceChildren(h('span', { class: 'spacer' }), button('取消', () => finish(null), { kind: 'quiet' }));
      const system = [
        '你是求职资料编辑助手。根据目标岗位 JD 改写用户的一条简历字段内容：',
        '1. 只基于原内容改写，突出与 JD 匹配的关键词；严禁新增、编造任何事实。',
        '2. 保持原语言与换行结构，不超过原文长度的 1.5 倍。',
        '3. 输出严格 JSON：{"content":"改写后的内容"}，不要任何解释或代码块。',
      ].join('\n');
      let reply;
      try {
        reply = await message('AI_CHAT', { baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: `目标 JD：\n${jdText}\n\n字段「${field.label}」原内容：\n${field.value}\n\n只输出 JSON。` }] });
      } catch (error) {
        build();
        status.hidden = false; status.textContent = errorMessage(error);
        return;
      }
      // 解析单字段建议
      const text = String(reply?.content || '').replace(/```(?:json)?/gi, '').trim();
      const s = text.indexOf('{'); const e2 = text.lastIndexOf('}');
      let content2 = '';
      if (s >= 0 && e2 > s) { try { const d = JSON.parse(text.slice(s, e2 + 1)); if (typeof d.content === 'string') content2 = d.content; } catch { /* 下方统一提示 */ } }
      if (!content2.trim() || content2.length > LIMITS.value) {
        build();
        status.hidden = false; status.textContent = 'AI 返回中没有可用建议，请重试或换模型。';
        return;
      }
      const box = h('textarea', { class: 'ai-suggest', rows: Math.min(6, Math.max(2, content2.split('\n').length + 1)), value: content2 });
      body.replaceChildren(
        h('p', { class: 'modal-description', text: '检查并编辑建议后采纳（写入资料）或复制（不写入）。' }),
        orig, box);
      foot.replaceChildren(h('span', { class: 'spacer' }),
        button('重试', () => { build(); }, { kind: 'quiet' }),
        button('复制建议', async () => {
          try { await navigator.clipboard.writeText(box.value.trim()); toast('已复制建议，未写入资料。'); finish(null); } catch (error) { toast(errorMessage(error), true); }
        }, { kind: 'quiet' }),
        button('采纳', () => finish(box.value.trim()), { kind: 'primary' }));
    };
    build();
  });
  if (!action) return;
  if (!await flush()) { toast('有修改尚未保存成功，已取消。', true); return; }
  const mutated = clone(profile);
  for (const m of mutated.modules) for (const e of m.entries) for (const f of e.fields) {
    if (f.id === field.id) f.value = action;
  }
  try {
    const next = await repo.replaceAll(validateProfile(mutated), 'AI 单字段采纳前');
    profile = next.profile;
    revision = profile.revision;
    epoch = next.epoch;
    historyInfo = null;
    dirty = false;
    render();
    toast(`「${field.label}」已更新（采纳前版本已存入历史）。`);
  } catch (error) {
    toast(errorMessage(error), true);
  }
}

/** AI 一键识别：粘贴简历原文，AI 抽取为分类字段，预览后「覆盖」或「合并」导入 */
async function aiImportDialog() {
  const config = await ensureAiConfig('AI 一键识别简历');
  if (!config) return;
  const RESUME_MAX = 16000;
  const ta = h('textarea', { class: 'ai-jd', rows: 12, placeholder: '把整份简历原文粘贴到这里（PDF / Word 里全选复制文字即可）…', 'aria-label': '简历原文' });
  const status = h('p', { class: 'ai-status', 'data-error': 'true', hidden: true });
  const apply = await modal('AI 一键识别简历', ({ body, foot, finish }) => {
    const buildInput = () => {
      body.replaceChildren(
        h('p', { class: 'modal-description', text: '粘贴简历原文，AI 只提取原文中明确出现的信息（不编造），抽取为分类字段后先预览再导入。' }),
        inputLabel('简历原文', ta), status);
      foot.replaceChildren(h('span', { class: 'spacer' }),
        button('取消', () => finish(null), { kind: 'quiet' }),
        button('开始识别', generate, { kind: 'primary' }));
    };
    const generate = async () => {
      const text = ta.value.trim();
      if (text.length < 30) { status.hidden = false; status.textContent = '内容太短，请粘贴完整的简历原文（至少 30 字）。'; return; }
      if (text.length > RESUME_MAX) { status.hidden = false; status.textContent = `简历超过 ${RESUME_MAX} 字，请删减后重试。`; return; }
      body.replaceChildren(h('p', { class: 'modal-description', text: '正在识别简历内容，最长约 2 分钟…' }));
      foot.replaceChildren(h('span', { class: 'spacer' }), button('取消', () => finish(null), { kind: 'quiet' }));
      const system = [
        '你是简历信息抽取助手。从用户粘贴的简历原文中抽取结构化求职资料：',
        '1. 只提取原文中明确出现的事实，严禁编造、推测或改写；原文没有的信息省略该字段。',
        '2. 按内容组织分类 name（常用：求职意向/基本信息/教育经历/实习经历/项目经历/校园经历/专业技能/获奖荣誉/自我评价/其他资料），每条记录有 title（如公司·岗位、学校）。',
        '3. 字段 type 只能取：text/multiline/date/month/email/tel/url/number；身份证号、手机号等设 sensitive 为 true。',
        '4. value 保持原文表述，多行内容用 \\n 分隔，每条不超过 500 字。',
        '5. 输出严格 JSON，不要解释、不要代码块：',
        '{"modules":[{"name":"分类名","tier":"常用","entries":[{"title":"记录名","fields":[{"label":"字段名","value":"内容","type":"text","sensitive":false}]}]}]}',
      ].join('\n');
      let reply;
      try {
        reply = await message('AI_CHAT', { baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: `简历原文：\n${text}\n\n只输出 JSON。` }] });
      } catch (error) {
        buildInput();
        status.hidden = false; status.textContent = errorMessage(error);
        return;
      }
      const parsed = parseAiImport(String(reply?.content || ''));
      if (!parsed.modules.length) {
        buildInput();
        status.hidden = false; status.textContent = 'AI 没有识别出可用字段，请重试或换模型。';
        return;
      }
      showPreview(parsed);
    };
    const showPreview = (parsed) => {
      const total = parsed.modules.reduce((n, m2) => n + m2.entries.reduce((k, e2) => k + e2.fields.length, 0), 0);
      const list = h('div', { class: 'ai-import-list' });
      for (const m2 of parsed.modules) {
        list.append(h('p', { class: 'ai-import-module', text: `${m2.name}（${m2.tier}）` }));
        for (const e2 of m2.entries) for (const f of e2.fields) {
          const v = f.value.replace(/\s+/g, ' ').slice(0, 60);
          list.append(h('p', { class: 'ai-import-field', text: `${f.label}：${v}${f.value.length > 60 ? '…' : ''}` }));
        }
      }
      body.replaceChildren(
        h('p', { class: 'modal-description', text: `识别出 ${parsed.modules.length} 个分类、${total} 个字段。选择导入方式：` }),
        list);
      foot.replaceChildren(h('span', { class: 'spacer' }),
        button('重试', () => { buildInput(); }, { kind: 'quiet' }),
        button('合并导入（只填空字段）', () => finish({ mode: 'merge', parsed }), { kind: 'quiet' }),
        button('覆盖导入', () => finish({ mode: 'replace', parsed }), { kind: 'primary' }));
    };
    buildInput();
  });
  if (!apply) return;
  if (!await flush()) { toast('有修改尚未保存成功，已取消导入。', true); return; }
  const { mode, parsed } = apply;
  const mutated = mode === 'merge' ? mergeImport(clone(profile), parsed) : replaceImport(parsed, profile.name);
  try {
    const next = await repo.replaceAll(validateProfile(mutated), 'AI 导入前');
    profile = next.profile;
    revision = profile.revision;
    epoch = next.epoch;
    historyInfo = null;
    dirty = false;
    selected = profile.modules[0] ? profile.modules[0].id : selected;
    query = '';
    if (searchInput) searchInput.value = '';
    render();
    toast(mode === 'merge' ? '已合并导入（导入前版本已存入历史）。' : '已覆盖导入（导入前版本已存入历史）。');
  } catch (error) {
    toast(errorMessage(error), true);
  }
}

/** 解析 AI 一键识别返回：剥围栏 → 截取 JSON → 宽松校验为 {modules:[...]} */
function parseAiImport(content) {
  const text = content.replace(/```(?:json)?/gi, '').trim();
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  const out = { modules: [] };
  if (s < 0 || e <= s) return out;
  let data;
  try { data = JSON.parse(text.slice(s, e + 1)); } catch { return out; }
  const raw = Array.isArray(data?.modules) ? data.modules : [];
  for (const m of raw.slice(0, LIMITS.modules)) {
    if (!m || typeof m.name !== 'string' || !m.name.trim()) continue;
    const mod = makeModule(m.name.trim().slice(0, LIMITS.label), TIERS.includes(m.tier) ? m.tier : '常用');
    const entries = Array.isArray(m.entries) ? m.entries.slice(0, 20) : [];
    for (const en of entries) {
      if (!en || typeof en.title !== 'string' || !en.title.trim()) continue;
      const entry = makeEntry(en.title.trim().slice(0, LIMITS.label));
      const fields = Array.isArray(en.fields) ? en.fields.slice(0, 40) : [];
      for (const f of fields) {
        if (!f || typeof f.label !== 'string' || !f.label.trim()) continue;
        if (typeof f.value !== 'string' || !f.value.trim()) continue;   // 空值字段没有导入意义
        const field = makeField(f.label.trim().slice(0, LIMITS.label), typeof f.group === 'string' ? f.group.slice(0, LIMITS.label) : '',
          TYPES.includes(f.type) ? f.type : 'text', f.sensitive === true);
        field.value = f.value.slice(0, LIMITS.value);
        entry.fields.push(field);
      }
      if (entry.fields.length) mod.entries.push(entry);
    }
    if (mod.entries.length) out.modules.push(mod);
  }
  return out;
}

/** 合并导入：同名分类内，同名字段只填空值；没有的追加；新分类整体追加 */
function mergeImport(base, parsed) {
  for (const m of parsed.modules) {
    const existing = base.modules.find((x) => x.name === m.name);
    if (!existing) { base.modules.push(m); continue; }
    const known = new Set();
    for (const e of existing.entries) for (const f of e.fields) known.add(f.label);
    for (const e of m.entries) {
      const target = existing.entries.find((x) => x.title === e.title) || existing.entries[0];
      if (!target) { existing.entries.push(e); continue; }
      for (const f of e.fields) {
        const hit = target.fields.find((x) => x.label === f.label);
        if (hit) { if (!hit.value.trim()) hit.value = f.value; continue; }
        if (known.has(f.label)) continue;
        known.add(f.label);
        target.fields.push(f);
      }
    }
  }
  return base;
}

/** 覆盖导入：用识别结果重建整个资料（保留资料名） */
function replaceImport(parsed, name) {
  const p = emptyProfile();
  p.name = name || '我的口袋简历';
  p.modules = parsed.modules;
  return p;
}

// ===== 布局 =====
let navNode = null;
let headNode = null;
let listNode = null;
let searchInput = null;

function buildShell() {
  searchInput = h('input', {
    class: 'search-input', type: 'search', placeholder: panel ? '搜索全部资料' : '搜索全部资料（Ctrl K）',
    value: query, 'aria-label': '搜索全部资料', autocomplete: 'off',
  });
  searchInput.addEventListener('input', () => { query = searchInput.value.trim(); render(); });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { searchInput.value = ''; query = ''; render(); }
  });

  // 填写模式：顶栏只留高频动作，管理动作收进「更多」菜单（对齐小师弟的极简顶栏）
  const topbar = fillMode
    ? h('header', { class: 'topbar panel-topbar' },
        h('div', { class: 'brand' },
          h('span', { class: 'brand-glyph', text: '袋' }),
          h('span', { text: '口袋简历' })),
        h('div', { class: 'search-box', role: 'search' }, icon('search', 14), searchInput),
        h('div', { class: 'topbar-actions' },
          (themeBtn = button('主题', themeDialog, { kind: 'quiet icon-only', symbol: 'settings', title: `主题 · ${themeName()}` })),
          button('更多', moreMenu, { kind: 'quiet icon-only', symbol: 'menu', title: '导出 / 导入 / 历史 / AI 定制' })))
    : h('header', { class: 'topbar' },
        h('div', { class: 'brand' },
          h('span', { class: 'brand-glyph', text: '袋' }),
          h('span', { text: '口袋简历' }),
          h('span', { class: 'brand-en', text: 'PocketCV' })),
        h('div', { class: 'search-box', role: 'search' }, icon('search', 14), searchInput),
        h('div', { class: 'topbar-actions' },
          (themeBtn = button(`主题 · ${themeName()}`, themeDialog, { kind: 'quiet', symbol: 'settings' })),
          button('导出', exportDialog, { kind: 'quiet', symbol: 'download' }),
          button('导入', importDialog, { kind: 'quiet', symbol: 'upload' }),
          button('AI 导入', aiImportDialog, { kind: 'quiet', symbol: 'scan' }),
          button('AI 定制', aiDialog, { kind: 'quiet', symbol: 'spark' }),
          button('历史', historyDialog, { kind: 'quiet', symbol: 'history' })));

  navNode = h('nav', { class: 'module-nav', 'aria-label': '资料分类' });
  const navBottom = h('div', { class: 'nav-bottom' },
    fillMode
      ? button('编辑资料', () => window.open(chrome?.runtime?.getURL ? chrome.runtime.getURL('manager.html') : 'manager.html', '_blank'), { kind: 'quiet', symbol: 'edit' })
      : button('添加分类', addModule, { kind: 'quiet', symbol: 'plus' }));
  const sidebar = h('aside', { class: 'sidebar' }, navNode, navBottom);
  headNode = h('div', { class: 'workspace-head' });
  listNode = h('div', { class: 'record-list' });
  const workspace = h('main', { class: 'workspace' }, headNode, listNode);
  const shell = h('div', { class: 'shell' }, sidebar, workspace);

  const bottom = h('footer', { class: 'bottom-bar' },
    h('span', { class: 'save-state', id: 'save-state', role: 'status' }, h('span', { class: 'save-dot' }), h('span', { text: '就绪' })),
    h('span', { class: 'spacer' }),
    h('span', { class: 'local-note', text: isExtension() ? '资料保存在本机浏览器' : '独立页面：资料保存在本页浏览器存储' }),
    fillMode ? null : button('清除全部资料', eraseAll, { kind: 'quiet danger' }));
  if (fillMode) bannerNode = h('div', { class: 'banner', role: 'status' });
  root.replaceChildren(topbar, ...(fillMode && bannerNode ? [bannerNode] : []), shell, bottom);
}

/** 填写模式的「更多」菜单：低频管理动作集中于此 */
async function moreMenu() {
  const action = await modal('更多操作', ({ body, foot, finish }) => {
    body.append(h('p', { class: 'modal-description', text: '填写时用不到的管理动作都收在这里。' }));
    for (const [label, handler, symbol] of [
      ['AI 一键识别简历', aiImportDialog, 'scan'],
      ['AI 按 JD 定制', aiDialog, 'spark'],
      ['导出资料 / 空白模板', exportDialog, 'download'],
      ['导入资料', importDialog, 'upload'],
      ['本地历史', historyDialog, 'history'],
    ]) body.append(button(label, () => finish(handler), { kind: 'quiet', symbol }));
    body.append(h('div', { class: 'menu-gap' }), button('清除全部资料', () => finish('erase'), { kind: 'quiet danger', symbol: 'trash' }));
    foot.append(h('span', { class: 'spacer' }), button('关闭', () => finish(null), { kind: 'quiet' }));
  });
  if (!action) return;
  if (action === 'erase') await eraseAll();
  else await action();
}

function render() {
  if (!profile) return;
  if (!profile.modules.some((m) => m.id === selected)) selected = profile.modules[0]?.id || '';
  renderNav();
  renderHead();
  if (query) renderSearch();
  else renderModule();
  if (fillMode) renderBanner();
  updateStatus();
}

function renderNav() {
  navNode.replaceChildren();
  for (const tier of TIERS) {
    const mods = profile.modules.filter((m) => m.tier === tier);
    if (!mods.length) continue;
    if (tier !== '常用') navNode.append(h('div', { class: 'tier-label', text: tier }));
    for (const m of mods) {
      navNode.append(h('button', {
        type: 'button', class: `nav-item${m.id === selected && !query ? ' active' : ''}`,
        title: m.name, on: { click: () => { selected = m.id; query = ''; if (searchInput) searchInput.value = ''; render(); } },
      },
      h('span', { class: 'nav-glyph', text: m.name.slice(0, 2) }),
      h('span', { class: 'nav-label', text: m.name }),
      m.entries.length ? h('span', { class: 'nav-count', text: String(m.entries.length) }) : null));
    }
  }
  if (!profile.modules.length) navNode.append(h('p', { class: 'nav-empty', text: '还没有分类' }));
}

function renderHead() {
  headNode.replaceChildren();
  if (query) {
    const n = countMatches();
    headNode.append(h('h1', { class: 'head-title', text: `搜索「${query}」` }),
      h('span', { class: 'head-meta', text: `${n} 项匹配 · 点击结果跳到所在分类` }),
      h('span', { class: 'spacer' }),
      button('退出搜索', () => { query = ''; if (searchInput) searchInput.value = ''; render(); }, { kind: 'quiet', symbol: 'close' }));
    return;
  }
  const m = currentModule();
  if (!m) { headNode.append(h('h1', { class: 'head-title', text: '我的资料' })); return; }
  const filled = m.entries.reduce((n, e) => n + e.fields.filter((f) => f.value !== '').length, 0);
headNode.append(...[  // 注意：append(字面 null) 会渲染成 'null' 文本，必须先过滤
  h('h1', { class: 'head-title', text: m.name }),
  h('span', { class: 'module-tier', text: m.tier }),
  h('span', { class: 'head-meta', text: `${m.entries.length} 记录 · ${filled} 项已填` }),
  h('span', { class: 'spacer' }),
  fillMode ? button(prefs.hideEmpty ? '显示全部' : '只看已填', () => { prefs.hideEmpty = !prefs.hideEmpty; savePrefs(); render(); }, { kind: 'quiet' }) : null,
  fillMode ? null : button('分类设置', () => moduleSettings(m.id), { kind: 'quiet', symbol: 'settings' }),
  fillMode ? null : button('添加记录', () => addEntry(m.id), { kind: 'quiet', symbol: 'plus' })].filter(Boolean));
}

function countMatches() {
  let n = 0;
  for (const m of profile.modules) for (const e of m.entries) for (const f of e.fields) if (searchable(f, e, m, query)) n++;
  return n;
}

// ===== 搜索结果 =====
function renderSearch() {
  listNode.replaceChildren();
  if (!query) return;
  let shown = 0;
  for (const m of profile.modules) {
    for (const e of m.entries) {
      const hits = e.fields.filter((f) => searchable(f, e, m, query));
      if (!hits.length) continue;
      for (const f of hits) {
        shown++;
        const valueText = f.sensitive ? mask(f.value) : (f.value || '（未填写）').split('\n')[0];
        listNode.append(h('button', {
          type: 'button', class: 'search-hit',
          on: { click: () => { selected = m.id; query = ''; if (searchInput) searchInput.value = ''; collapsed.delete(e.id); render(); } },
        },
        h('span', { class: 'search-path', text: `${m.name} / ${e.title}` }),
        h('span', { class: 'search-line' },
          h('span', { class: 'search-label', text: f.label }),
          f.sensitive ? h('span', { class: 'lock', text: '🔒' }) : null,
          h('span', { class: 'search-value', text: valueText }))));
      }
    }
  }
  if (!shown) listNode.append(h('div', { class: 'empty-state' },
    h('p', { class: 'modal-description', text: '没有匹配的资料。搜索包含字段名、分组、内容、记录与分类名；敏感字段只按名称匹配。' })));
}

// ===== 分类视图 =====
function renderModule() {
  listNode.replaceChildren();
  const m = currentModule();
  if (!m) {
    listNode.append(h('div', { class: 'empty-state' },
      h('p', { class: 'modal-description', text: '从添加第一个分类开始整理你的求职资料。' }),
      button('添加分类', addModule, { kind: 'primary', symbol: 'plus' })));
    return;
  }
  // 填写模式下资料全空：紧凑提示条（字段行照常显示，方便核对固定字段；面板内不可编辑，给出编辑入口）
  if (fillMode && stats(profile).filled === 0) {
    listNode.append(h('div', { class: 'empty-hint' },
      h('span', { class: 'empty-hint-text', text: '资料还是空的——内容要在「编辑资料」里填，或让 AI 识别简历代填。' }),
      button('AI 一键识别', aiImportDialog, { kind: 'primary', symbol: 'scan' }),
      button('编辑资料', () => window.open(chrome?.runtime?.getURL ? chrome.runtime.getURL('manager.html') : 'manager.html', '_blank'), { kind: 'quiet', symbol: 'edit' })));
  }
  if (!m.entries.length) {
    listNode.append(h('div', { class: 'empty-state' },
      h('p', { class: 'modal-description', text: `「${m.name}」还没有记录，例如一段经历、一项技能。` }),
      button('添加记录', () => addEntry(m.id), { kind: 'primary', symbol: 'plus' })));
    return;
  }
  m.entries.forEach((e, i) => listNode.append(renderEntry(m, e, i)));
}

function renderEntry(m, e, index) {
  const open = !collapsed.has(e.id);
  const card = h('section', { class: 'record', 'data-open': String(open) });
  const toggle = h('button', {
    type: 'button', class: 'record-toggle', 'aria-expanded': String(open),
    on: { click: () => { if (collapsed.has(e.id)) collapsed.delete(e.id); else collapsed.add(e.id); render(); } },
  },
  h('span', { class: 'record-index', text: String(index + 1).padStart(2, '0') }),
  h('span', { class: 'record-title', text: e.title }),
  h('span', { class: 'record-summary', text: summary(e), title: summary(e) }),
  h('span', { class: 'chevron', 'aria-hidden': 'true' }, icon('menu', 12)));
  const bar = h('div', { class: 'record-top' }, toggle,
    fillMode ? null : button('记录操作', () => entryMenu(m.id, e.id), { kind: 'quiet icon-only', symbol: 'edit', title: '记录操作：' + e.title }));
  card.append(bar);

  if (open) {
    const groups = [...new Set(e.fields.map((f) => f.group))];
    for (const group of groups) {
      const gf = e.fields.filter((f) => f.group === group);
      const shown = fillMode && prefs.hideEmpty ? gf.filter((f) => f.value !== '') : gf;
      if (!shown.length) continue;
      if (group) card.append(h('div', { class: 'group-label', text: group }));
      card.append(fillMode
        ? h('div', { class: 'fill-list' }, shown.map((f) => renderFillField(e, f)))
        : h('div', { class: 'field-grid' }, shown.map((f) => renderField(e, f))));
    }
    if (!fillMode) card.append(h('div', { class: 'record-bottom' },
      button('添加字段', () => addField(e.id), { kind: 'small quiet', symbol: 'plus' })));
  }
  return card;
}

function renderField(e, f) {
  const id = 'f-' + f.id;
  let maskedNode = null;
  const isSecret = f.sensitive && !revealed.has(f.id);
  const control = f.type === 'multiline'
    ? h('textarea', { id, value: f.value, spellcheck: 'false' })
    : h('input', { id, type: isSecret ? 'password' : inputType(f.type), value: f.value, autocomplete: 'off' });
  control.addEventListener('input', () => { f.value = control.value; if (maskedNode) maskedNode.textContent = mask(f.value); markDirty(); updateStatus(); });
  control.addEventListener('blur', () => { if (dirty) flush(); });

  const labelRow = h('div', { class: 'field-label' },
    h('label', { for: id, text: f.label, title: f.label + (f.group ? ` · ${f.group}` : '') }),
    f.sensitive ? button('', () => {
      if (revealed.has(f.id)) revealed.delete(f.id); else revealed.add(f.id);
      render();
    }, { kind: 'quiet icon-only', symbol: 'lock', title: revealed.has(f.id) ? '隐藏内容' : '显示内容', }) : null,
    f.sensitive && !revealed.has(f.id) ? (maskedNode = h('span', { class: 'field-masked', text: mask(f.value) })) : null,
    h('span', { class: 'spacer' }),
    h('span', { class: 'field-type', text: f.sensitive ? '敏感' : TYPE_NAMES[f.type] || '' }),
    button('编辑字段 ' + f.label, () => editField(e.id, f.id), { kind: 'quiet icon-only', symbol: 'edit', title: '编辑字段：' + f.label }));
  return h('div', { class: 'field' }, labelRow, control);
}

const inputType = (type) => ({ email: 'email', tel: 'tel', number: 'text', date: 'text', month: 'text', url: 'url' }[type] || 'text');

// ===== 分类操作 =====
async function addModule() {
  const result = await moduleForm('新增分类', { name: '', tier: '常用' });
  if (!result) return;
  commit((p) => p.modules.push(makeModule(result.name, result.tier)), '新增分类前');
  selected = profile.modules[profile.modules.length - 1]?.id || selected;
  render();
  toast('已添加分类。');
}

async function moduleSettings(moduleId) {
  const m = profile.modules.find((x) => x.id === moduleId);
  if (!m) return;
  const index = profile.modules.indexOf(m);
  await modal(`分类设置 · ${m.name}`, ({ body, foot, finish }) => {
    const rename = async () => {
      const name = await askText('重命名分类', '分类名称', m.name);
      if (!name || name === m.name) return;
      commit((p) => { p.modules.find((x) => x.id === moduleId).name = name; }, '重命名分类前');
      finish(null);
    };
    const setTier = (tier) => {
      commit((p) => { p.modules.find((x) => x.id === moduleId).tier = tier; }, '调整分类层级前');
      finish(null);
    };
    const shift = (offset) => {
      commit((p) => moveItem(p.modules, moduleId, offset), '调整分类顺序前');
      finish(null);
    };
    const remove = async () => {
      if (!await confirmAction('删除分类', `「${m.name}」及其 ${m.entries.length} 条记录将被删除。建议先导出备份。`, '删除分类', { danger: true })) return;
      commit((p) => { p.modules = p.modules.filter((x) => x.id !== moduleId); }, '删除分类前');
      finish(null);
    };
    body.append(
      button('重命名分类', rename, { kind: 'quiet' }),
      h('div', { class: 'menu-row' },
        h('span', { class: 'menu-caption', text: '层级' }),
        TIERS.map((t) => button(t, () => setTier(t), { kind: m.tier === t ? 'primary' : 'quiet' }))),
      h('div', { class: 'menu-row' },
        button('上移', () => shift(-1), { kind: 'quiet', disabled: index === 0 }),
        button('下移', () => shift(1), { kind: 'quiet', disabled: index === profile.modules.length - 1 })),
    );
    foot.append(button('删除分类…', remove, { kind: 'danger' }), h('span', { class: 'spacer' }), button('关闭', () => finish(null), { kind: 'quiet' }));
  });
  render();
}

async function moduleForm(title, initial) {
  return modal(title, ({ body, foot, finish }) => {
    const name = h('input', { type: 'text', required: true, maxlength: LIMITS.label, value: initial.name, placeholder: '例如：项目经历、获奖荣誉、技能证书' });
    const tier = h('select', {}, TIERS.map((t) => h('option', { value: t, selected: t === initial.tier ? '' : null, text: t })));
    body.append(inputLabel('分类名称', name), inputLabel('层级', tier, '常用排在最前，备用放在最后。'));
    foot.append(h('span', { class: 'spacer' }),
      button('取消', () => finish(null), { kind: 'quiet' }),
      button('保存', () => { if (name.reportValidity() && name.value.trim()) finish({ name: name.value.trim(), tier: tier.value }); }, { kind: 'primary' }));
  });
}

// ===== 记录操作 =====
async function addEntry(moduleId) {
  const m = profile.modules.find((x) => x.id === moduleId);
  if (!m) return;
  const title = await askText('新增记录', '记录标题', '', '例如：示例公司 · 产品经理、某段项目经历');
  if (!title) return;
  const template = m.entries[0]?.fields?.map((f) => ({ label: f.label, group: f.group, type: f.type, sensitive: f.sensitive }))
    || [{ label: '内容', group: '', type: 'multiline', sensitive: false }];
  commit((p) => {
    p.modules.find((x) => x.id === moduleId).entries.push(makeEntry(title, template.map((t) => makeField(t.label, t.group, t.type, t.sensitive))));
  }, '新增记录前');
  collapsed.delete(profile.modules.find((x) => x.id === moduleId).entries.at(-1).id);
  render();
}

async function entryMenu(moduleId, entryId) {
  const m = profile.modules.find((x) => x.id === moduleId);
  const e = m?.entries.find((x) => x.id === entryId);
  if (!e) return;
  const index = m.entries.indexOf(e);
  await modal(`记录操作 · ${e.title}`, ({ body, foot, finish }) => {
    const rename = async () => {
      const title = await askText('重命名记录', '记录标题', e.title);
      if (!title || title === e.title) return;
      commit((p) => { getEntry(p, entryId).entry.title = title; }, '重命名记录前');
      finish(null);
    };
    const duplicate = () => {
      commit((p) => {
        const source = getEntry(p, entryId).entry;
        const copy = makeEntry(source.title + '（副本）', source.fields.map((f) => {
          const nf = makeField(f.label, f.group, f.type, f.sensitive);
          nf.value = f.value;
          return nf;
        }));
        const target = p.modules.find((x) => x.id === moduleId);
        target.entries.splice(target.entries.indexOf(source) + 1, 0, copy);
      }, '复制记录前');
      finish(null);
    };
    const shift = (offset) => {
      commit((p) => { const mm = p.modules.find((x) => x.id === moduleId); moveItem(mm.entries, entryId, offset); }, '调整记录顺序前');
      finish(null);
    };
    const remove = async () => {
      if (!await confirmAction('删除记录', `「${e.title}」及其 ${e.fields.length} 个字段将被删除。`, '删除记录', { danger: true })) return;
      commit((p) => { const mm = p.modules.find((x) => x.id === moduleId); mm.entries = mm.entries.filter((x) => x.id !== entryId); }, '删除记录前');
      finish(null);
    };
    body.append(
      button('重命名记录', rename, { kind: 'quiet' }),
      button('复制一份', duplicate, { kind: 'quiet' }),
      h('div', { class: 'menu-row' },
        button('上移', () => shift(-1), { kind: 'quiet', disabled: index === 0 }),
        button('下移', () => shift(1), { kind: 'quiet', disabled: index === m.entries.length - 1 })),
    );
    foot.append(button('删除记录…', remove, { kind: 'danger' }), h('span', { class: 'spacer' }), button('关闭', () => finish(null), { kind: 'quiet' }));
  });
  render();
}

// ===== 字段操作 =====
async function addField(entryId) {
  const found = getEntry(profile, entryId);
  if (!found) return;
  const result = await fieldForm('添加字段', { label: '', group: '', type: 'text', sensitive: false });
  if (!result) return;
  commit((p) => {
    getEntry(p, entryId).entry.fields.push(makeField(result.label, result.group, result.type, result.sensitive));
  });
}

async function editField(entryId, fieldId) {
  const found = getEntry(profile, entryId);
  const f = found?.entry.fields.find((x) => x.id === fieldId);
  if (!f) return;
  const index = found.entry.fields.indexOf(f);
  const result = await fieldForm(`编辑字段 · ${f.label}`, f, async ({ finish }) => {
    if (!await confirmAction('移除字段', `「${f.label}」及其内容将被移除。`, '移除', { danger: true })) return;
    commit((p) => {
      const e = getEntry(p, entryId).entry;
      e.fields = e.fields.filter((x) => x.id !== fieldId);
    }, '移除字段前');
    finish('removed');
  }, {
    up: () => { commit((p) => { moveItem(getEntry(p, entryId).entry.fields, fieldId, -1); }, '调整字段顺序前'); },
    down: () => { commit((p) => { moveItem(getEntry(p, entryId).entry.fields, fieldId, 1); }, '调整字段顺序前'); },
    canUp: index > 0,
    canDown: index < found.entry.fields.length - 1,
  });
  if (!result) return;
  if (result === 'removed') return; // commit 已渲染
  commit((p) => {
    const target = getEntry(p, entryId).entry.fields.find((x) => x.id === fieldId);
    if (target) Object.assign(target, { label: result.label, group: result.group, type: result.type, sensitive: result.sensitive });
  }, '修改字段前');
}

async function fieldForm(title, initial, onRemove, order = null) {
  return modal(title, ({ body, foot, finish }) => {
    const label = h('input', { type: 'text', required: true, maxlength: LIMITS.label, value: initial.label, placeholder: '例如：GPA、项目角色、作品链接' });
    const group = h('input', { type: 'text', maxlength: LIMITS.label, value: initial.group || '', placeholder: '可留空；相同分组的字段会归在一起' });
    const type = h('select', {}, TYPES.map((t) => h('option', { value: t, selected: t === initial.type ? '' : null, text: TYPE_NAMES[t] })));
    const sensitive = h('input', { type: 'checkbox' });
    sensitive.checked = !!initial.sensitive;
    body.append(
      inputLabel('字段名称', label),
      inputLabel('分组', group),
      inputLabel('内容类型', type, '多行文本适合长描述；敏感内容在本机以掩码显示。'),
      h('label', { class: 'check-row' }, sensitive, h('span', { text: '敏感信息（填写时默认遮挡）' })));
    const footLeft = h('div', { class: 'modal-foot-left' });
    if (onRemove) footLeft.append(button('移除…', () => onRemove({ finish }), { kind: 'danger' }));
    if (order) footLeft.append(
      button('上移', order.up, { kind: 'quiet', disabled: !order.canUp }),
      button('下移', order.down, { kind: 'quiet', disabled: !order.canDown }));
    foot.append(footLeft, h('span', { class: 'spacer' }),
      button('取消', () => finish(null), { kind: 'quiet' }),
      button('保存', () => {
        if (!label.reportValidity() || !label.value.trim()) return;
        finish({ label: label.value.trim(), group: group.value.trim(), type: type.value, sensitive: sensitive.checked });
      }, { kind: 'primary' }));
  });
}

// ===== 导入导出/历史/清除（沿用第 1 期） =====
async function exportDialog() {
  if (!await flushWithHistory()) return;
  const action = await modal('导出资料', ({ body, foot, finish }) => {
    const s = stats(profile);
    body.append(h('p', { class: 'modal-description', text: `当前：${s.modules} 个分类 · ${s.entries} 段记录 · ${s.filled} 项已填（含 ${s.sensitive} 项敏感）。导出为明文文件，请妥善保管。` }));
    foot.append(h('span', { class: 'spacer' }),
      button('空白模板', () => finish('template'), { kind: 'quiet', symbol: 'plus' }),
      button('Excel 资料表', () => finish('xlsx'), { kind: 'quiet', symbol: 'download' }),
      button('JSON 备份', () => finish('json'), { kind: 'quiet' }),
      button('加密备份', () => finish('vault'), { kind: 'primary' }));
  });
  if (!action) return;
  try {
    const data = validateProfile(profile);
    const date = new Date().toISOString().slice(0, 10);
    if (action === 'json') {
      saveFile(`PocketCV-资料-${date}.json`, JSON.stringify(data, null, 2), 'application/json');
    } else if (action === 'template') {
      // 空白模板：分类/记录/字段结构齐备，交给用户自己的 AI 填写后导回
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().replace(/^#/, '');
      const bytes = exportProfileWorkbook(templateProfile(), { accent, themeId });
      saveFile('PocketCV-资料表-模板.xlsx', new Blob([bytes]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } else if (action === 'xlsx') {
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().replace(/^#/, '');
      const bytes = exportProfileWorkbook(data, { accent, themeId });
      saveFile(`PocketCV-资料表-${date}.xlsx`, new Blob([bytes]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } else {
      const password = await askPassword('设置加密备份口令', true);
      if (!password) return;
      saveFile(`PocketCV-备份-${date}.pocketcv`, await encryptProfile(data, password), 'application/json');
    }
    toast('导出完成。');
  } catch (error) {
    toast(errorMessage(error), true);
  }
}

async function importDialog() {
  const input = h('input', { type: 'file', accept: '.json,.pocketcv,.xlsx', hidden: true });
  document.body.append(input);
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    try {
      if (file.size > LIMITS.fileBytes) throw new Error('文件超过 8 MB。');
      let incoming;
      let source = 'json';
      if (file.name.endsWith('.xlsx')) {
        const result = await importProfileWorkbook(new Uint8Array(await file.arrayBuffer()));
        incoming = result.profile;
        source = result.source; // 'pocketcv' | 'xiaoshidi'
      } else if (file.name.endsWith('.pocketcv')) {
        const password = await askPassword('解密备份');
        if (!password) return;
        incoming = await decryptProfile(await file.text(), password);
      } else {
        incoming = JSON.parse(await file.text());
      }
      const validated = validateProfile(incoming);
      const s = stats(validated);
      const sourceText = source === 'xiaoshidi' ? '（迁移自小师弟求职，层级「少用」已归为「备用」）' : source === 'pocketcv' ? '（Excel 资料表）' : '';
      const ok = await modal('导入预览', ({ body, foot, finish }) => {
        body.append(h('p', { class: 'modal-description', text: `${validated.name} · ${s.modules} 个分类 · ${s.entries} 段记录 · ${s.filled} 项已填。${sourceText}` }),
          h('p', { class: 'modal-description', text: '确认后将替换当前全部资料（当前资料会先存入历史）。' }));
        foot.append(h('span', { class: 'spacer' }),
          button('取消', () => finish(false), { kind: 'quiet' }),
          button('确认替换', () => finish(true), { kind: 'primary' }));
      });
      if (!ok) return;
      sanitizeDirtyText(validated);   // 拒脏文本于入库之前
      const result = await repo.replaceAll(validated, '导入前');
      profile = result.profile;
      revision = profile.revision;
      epoch = result.epoch;
      dirty = false;
      saveError = '';
      selected = '';
      collapsed.clear();
      revealed.clear();
      render();
      toast('导入完成。');
    } catch (error) {
      const hint = file.name.endsWith('.xlsx')
        ? ' 提示：插件只认「口袋简历 Excel 资料表」结构；可先从「导出」下载空白模板，连同简历一起发给任意 AI 按「填写内容」列填写，再导入。'
        : '';
      toast(errorMessage(error) + hint, true);
    }
  }, { once: true });
  input.click();
}

// ===== AI 按 JD 定制（第 5 期） =====
// 思路：插件不做「任意 Excel 智能识别」——批量导入靠「空白模板 + 用户自有 AI 填写」；
// 逐字段定制由本对话内置 AI 完成：只发送所选范围内已填的非敏感字段，防编造，采纳前可逐条改。
const AI_KEY = 'pocketcv.ai.v1';
const AI_PRESETS = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'dashscope', name: '阿里云百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { id: 'bigmodel', name: '智谱开放平台', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-air' },
  { id: 'moonshot', name: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { id: 'siliconflow', name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'custom', name: '自定义（OpenAI 兼容）', baseUrl: '', model: '' },
];

function loadAiConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(AI_KEY) || 'null');
    if (!raw || typeof raw.baseUrl !== 'string' || typeof raw.apiKey !== 'string') return null;
    if (!/^https:\/\//.test(raw.baseUrl) || !raw.apiKey.trim()) return null;
    return { baseUrl: raw.baseUrl, apiKey: raw.apiKey, model: typeof raw.model === 'string' && raw.model.trim() ? raw.model : 'deepseek-chat' };
  } catch { return null; }
}

async function aiSettingsDialog() {
  const saved = loadAiConfig();
  const preset = h('select', { 'aria-label': '服务商' });
  for (const p of AI_PRESETS) preset.append(h('option', { value: p.id, text: p.name }));
  const baseUrl = h('input', { type: 'url', required: true, placeholder: 'https://api.deepseek.com/v1', value: saved?.baseUrl || AI_PRESETS[0].baseUrl });
  const apiKey = h('input', { type: 'password', required: true, placeholder: 'sk-…', autocomplete: 'new-password', value: saved?.apiKey || '' });
  const model = h('input', { type: 'text', required: true, placeholder: 'deepseek-chat', value: saved?.model || AI_PRESETS[0].model });
  preset.addEventListener('change', () => {
    const p = AI_PRESETS.find((x) => x.id === preset.value);
    if (p && p.id !== 'custom') { baseUrl.value = p.baseUrl; model.value = p.model; }
  });
  return modal('AI 设置', ({ body, foot, finish }) => {
    const match = AI_PRESETS.find((x) => x.baseUrl && saved?.baseUrl?.startsWith(x.baseUrl));
    preset.value = saved ? (match?.id || 'custom') : AI_PRESETS[0].id;
    body.append(
      inputLabel('服务商', preset, '选择后自动填入默认接口与模型；也可以手动修改。'),
      inputLabel('接口地址（OpenAI 兼容）', baseUrl, 'https:// 开头，不要带 /chat/completions。'),
      inputLabel('API Key', apiKey, '仅保存在本机 localStorage，随清除浏览器数据一起消失；不会上传到任何服务器。'),
      inputLabel('模型名称', model),
      h('p', { class: 'ai-status', text: '对话请求由扩展后台直接发往你填写的接口；需要域名在扩展网络权限内（DeepSeek / 阿里云 / 智谱 / Kimi / 硅基流动 / OpenAI 已预置）。' }));
    const save = () => {
      if (!baseUrl.reportValidity() || !apiKey.reportValidity() || !model.reportValidity()) return;
      const cfg = { baseUrl: baseUrl.value.trim().replace(/\/+$/, ''), apiKey: apiKey.value.trim(), model: model.value.trim() };
      localStorage.setItem(AI_KEY, JSON.stringify(cfg));
      finish(cfg);
    };
    foot.append(h('span', { class: 'spacer' }),
      button('取消', () => finish(null), { kind: 'quiet' }),
      button('保存', save, { kind: 'primary' }));
  });
}

/** 从 AI 回复中解析建议：只接受本次发送过的字段 id，长度限制同字段上限。 */
function parseAiSuggestions(content, sentItems) {
  const text = String(content || '').replace(/```(?:json)?/gi, '').trim();
  const starts = [text.indexOf('{'), text.indexOf('[')].filter((i) => i >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (start < 0 || end <= start || end - start > 2 * 1024 * 1024) return null;
  let data;
  try { data = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  const list = Array.isArray(data) ? data : Array.isArray(data?.suggestions) ? data.suggestions : null;
  if (!list) return null;
  const byId = new Map(sentItems.map((it) => [it.id, it]));
  const result = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '');
    const content2 = item.content;
    if (!byId.has(id) || typeof content2 !== 'string' || !content2.trim()) continue;
    if (content2.length > LIMITS.value) continue; // 异常超长建议直接丢弃
    result.push({ id, field: byId.get(id), content: content2 });
  }
  return result;
}

async function aiDialog() {
  if (!isExtension()) {
    toast('AI 定制需要在浏览器的扩展面板或管理页中使用（导出的 Excel 模板同样可以交给任意 AI 离线填写）。', true);
    return;
  }
  let config = loadAiConfig();
  const result = await modal('AI 按 JD 定制', ({ body, foot, finish }) => {
    if (!config) {
      body.append(
        h('p', { class: 'modal-description', text: '把目标岗位 JD 贴进来，AI 会按 JD 逐条改写你已填写的非敏感字段，并给出对比预览，你逐条采纳。' }),
        h('p', { class: 'modal-description', text: '首次使用需要配置一个 OpenAI 兼容接口（DeepSeek、通义、智谱、Kimi、硅基流动、OpenAI 均可）。API Key 只保存在本机。' }));
      foot.append(h('span', { class: 'spacer' }),
        button('取消', () => finish(null), { kind: 'quiet' }),
        button('打开 AI 设置', () => finish('settings'), { kind: 'primary' }));
      return;
    }

    const jd = h('textarea', { class: 'ai-jd', rows: 8, placeholder: '粘贴目标岗位的 JD（职位描述），或写几个岗位关键词…', 'aria-label': '目标岗位 JD' });
    const scope = h('select', { 'aria-label': '优化范围' });
    scope.append(h('option', { value: '*', text: '全部分类' }));
    for (const m of profile.modules) {
      const n = m.entries.reduce((acc, e) => acc + e.fields.filter((f) => f.value.trim() && !f.sensitive).length, 0);
      if (n) scope.append(h('option', { value: m.id, text: `${m.name}（${n} 项）` }));
    }
    if (scope.options.length === 1) scope.disabled = true;
    const hint = h('p', { class: 'ai-status', text: '只处理已填写的非敏感字段：敏感字段不会发送；空字段保持空，AI 不代填。采纳前当前资料会自动存入历史。' });
    body.append(
      h('p', { class: 'modal-description', text: 'AI 按目标 JD 改写你的资料字段，只改写、不编造；每条建议采纳前都可以再编辑。' }),
      inputLabel('目标岗位 JD', jd),
      inputLabel('优化范围', scope),
      hint);

    const busy = (text) => {
      body.replaceChildren(h('p', { class: 'modal-description', text }), h('div', { class: 'ai-loading', 'aria-role': 'progress' }, '生成中，最长约 2 分钟…'));
      foot.replaceChildren(h('span', { class: 'spacer' }), button('取消', () => finish(null), { kind: 'quiet' }));
    };
    const generate = async () => {
      const jdText = jd.value.trim();
      if (jdText.length < 20) { toast('请粘贴更完整的 JD（至少 20 字）。', true); return; }
      const modules = scope.value === '*' ? profile.modules : profile.modules.filter((m) => m.id === scope.value);
      const items = [];
      let skippedSensitive = 0;
      for (const m of modules) for (const e of m.entries) for (const f of e.fields) {
        const value = f.value.trim();
        if (!value) continue;
        if (f.sensitive) { skippedSensitive++; continue; }
        items.push({ id: f.id, cat: m.name, entry: e.title, label: f.label, content: value });
      }
      if (!items.length) { toast('所选范围内没有已填写的非敏感字段。', true); return; }
      if (items.length > 40) { toast('范围太大（最多 40 个字段），请选择单个分类分批处理。', true); return; }
      busy(`已发送 ${items.length} 个字段${skippedSensitive ? `（跳过 ${skippedSensitive} 个敏感字段）` : ''}，正在生成建议…`);
      const system = [
        '你是求职资料编辑助手。用户给出目标岗位 JD 和若干条简历字段内容，请逐条改写：',
        '1. 只基于每个字段现有内容改写：突出与 JD 匹配的关键词、压缩套话、保留量化表达。',
        '2. 严禁新增、编造任何事实（学校、公司、时间、数据、技能、职位）。没有可匹配点时保持原意、仅做润色。',
        '3. 保持字段原有语言，不超过原文长度的 1.5 倍，保留原有换行结构；单个字段不超过 1500 字。',
        '4. 输出严格 JSON，形如 {"suggestions":[{"id":"字段ID","content":"改写后的内容"}]}，只输出 JSON 本身，不要任何解释或代码块。',
      ].join('\n');
      const user = `目标岗位 JD：\n${jdText}\n\n需要改写的字段：\n${JSON.stringify(items)}\n\n只输出 JSON。`;
      let reply;
      try {
        reply = await message('AI_CHAT', { baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] });
      } catch (error) {
        toast(errorMessage(error), true);
        finish(null);
        return;
      }
      const parsed = parseAiSuggestions(reply?.content, items);
      if (!parsed || !parsed.length) {
        toast('AI 返回中没有可用的建议，请重试或换一个模型。', true);
        finish(null);
        return;
      }
      renderResults(parsed);
    };

    const renderResults = (parsed) => {
      body.replaceChildren(h('p', { class: 'modal-description', text: `收到 ${parsed.length} 条建议。勾选要采纳的条目（可在文本框里再编辑），点击「采纳所选」。` }));
      const rows = [];
      for (const item of parsed) {
        const check = h('input', { type: 'checkbox', checked: true, 'aria-label': `采纳 ${item.field.label}` });
        const text = h('textarea', { class: 'ai-suggest', rows: Math.min(6, Math.max(2, item.content.split('\n').length + 1)), value: item.content });
        body.append(h('div', { class: 'ai-item' },
          h('label', { class: 'ai-item-head' }, check,
            h('span', { class: 'ai-item-name', text: `${item.field.cat} · ${item.field.entry} · ${item.field.label}` })),
          h('div', { class: 'ai-orig', title: item.field.content, text: `原：${item.field.content}` }),
          text));
        rows.push({ id: item.id, check, text });
      }
      const collect = () => rows.filter((r) => r.check.checked && r.text.value.trim())
        .map((r) => ({ id: r.id, content: r.text.value.trim() }));
      foot.replaceChildren(h('span', { class: 'spacer' }),
        button('返回重写', () => finish('restart'), { kind: 'quiet' }),
        button('采纳所选', () => finish({ apply: collect() }), { kind: 'primary' }));
    };

    foot.append(h('span', { class: 'spacer' }),
      button('AI 设置', async () => { finish('settings'); }, { kind: 'quiet', symbol: 'settings' }),
      button('取消', () => finish(null), { kind: 'quiet' }),
      button('生成建议', generate, { kind: 'primary' }));
  });

  if (!result) return;
  if (result === 'settings') {
    const cfg = await aiSettingsDialog();
    if (cfg) { await aiDialog(); } // 配置完成后重新打开
    return;
  }
  if (result === 'restart') { await aiDialog(); return; }
  if (result.apply?.length) {
    if (!await flush()) { toast('有修改尚未保存成功，已取消采纳。', true); return; }
    const mutated = clone(profile);
    const byId = new Map(result.apply.map((r) => [r.id, r.content]));
    for (const m of mutated.modules) for (const e of m.entries) for (const f of e.fields) {
      if (byId.has(f.id)) f.value = byId.get(f.id);
    }
    try {
      const next = await repo.replaceAll(validateProfile(mutated), 'AI 采纳前');
      profile = next.profile;
      revision = profile.revision;
      epoch = next.epoch;
      historyInfo = null;
      dirty = false;
      render();
      toast(`已采纳 ${result.apply.length} 条 AI 建议（采纳前版本已存入历史）。`);
    } catch (error) {
      toast(errorMessage(error), true);
    }
  }
}

async function historyDialog() {
  try {
    const snapshots = await repo.history();
    const chosen = await modal('本地历史', ({ body, foot, finish }) => {
      body.append(h('p', { class: 'modal-description', text: '在删除、导入等操作前自动保留，最多 3 份。不是云备份。' }));
      if (!snapshots.length) body.append(h('p', { class: 'modal-description', text: '暂无历史版本。' }));
      snapshots.forEach((s, i) => body.append(button(`${s.label || '快照'} · ${new Date(s.at).toLocaleString()}`, () => finish(i), { kind: 'quiet' })));
      foot.append(h('span', { class: 'spacer' }), button('关闭', () => finish(null), { kind: 'quiet' }));
    });
    if (chosen === null || !snapshots[chosen]) return;
    if (!await confirmAction('恢复历史', '当前资料将先存入历史，再恢复所选版本。', '恢复')) return;
    const result = await repo.replaceAll(snapshots[chosen].profile, '恢复历史前');
    profile = result.profile;
    revision = profile.revision;
    epoch = result.epoch;
    selected = '';
    collapsed.clear();
    render();
    toast('已恢复历史版本。');
  } catch (error) {
    toast(errorMessage(error), true);
  }
}

async function eraseAll() {
  const input = h('input', { type: 'text', placeholder: '输入「删除」确认' });
  const confirmed = await modal('清除本机全部资料', ({ body, foot, finish }) => {
    body.append(h('p', { class: 'modal-description', text: '将清除本机资料与历史版本，不可恢复。不影响已导出的文件。' }), inputLabel('确认操作', input));
    foot.append(h('span', { class: 'spacer' }), button('取消', () => finish(null), { kind: 'quiet' }), button('永久清除', () => finish(input.value), { kind: 'danger' }));
  });
  if (confirmed !== '删除') {
    if (confirmed) toast('确认文字不匹配，未清除。', true);
    return;
  }
  const result = await repo.erase();
  profile = starterProfile();
  profile.revision = 0;
  epoch = result.epoch;
  revision = 0;
  await repo.save(profile, 0, '', epoch);
  selected = '';
  collapsed.clear();
  revealed.clear();
  render();
  toast('已清除，并重置为空白示例资料。');
}

function askPassword(title, confirmPassword = false) {
  return modal(title, ({ body, foot, finish }) => {
    const pass = h('input', { type: 'password', minlength: 12, required: true, autocomplete: 'new-password' });
    const repeat = confirmPassword ? h('input', { type: 'password', minlength: 12, autocomplete: 'new-password' }) : null;
    const error = h('p', { class: 'ai-status', 'data-error': 'true', hidden: true });
    body.append(inputLabel('口令（至少 12 个字符）', pass, '遗失后无法找回，请妥善保存。'));
    if (repeat) body.append(inputLabel('再次输入口令', repeat));
    body.append(error);
    const submit = () => {
      if (!pass.reportValidity()) return;
      if (repeat && pass.value !== repeat.value) { error.hidden = false; error.textContent = '两次输入的口令不一致。'; return; }
      finish(pass.value);
    };
    foot.append(h('span', { class: 'spacer' }), button('取消', () => finish(null), { kind: 'quiet' }), button('确认', submit, { kind: 'primary' }));
  });
}

function askText(title, label, value = '', hint = '') {
  return modal(title, ({ body, foot, finish }) => {
    const input = h('input', { type: 'text', required: true, maxlength: LIMITS.label, value, placeholder: hint });
    body.append(inputLabel(label, input, hint));
    const submit = () => { if (input.reportValidity() && input.value.trim()) finish(input.value.trim()); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    foot.append(h('span', { class: 'spacer' }), button('取消', () => finish(null), { kind: 'quiet' }), button('保存', submit, { kind: 'primary' }));
  });
}

// ===== 启动 =====
async function main() {
  buildShell();
  const result = await repo.load();
  if (!result.profile) {
    profile = starterProfile();
    epoch = result.epoch;
    await repo.save(profile, 0, '', epoch);
    revision = profile.revision;
  } else {
    profile = result.profile;
    revision = profile.revision;
    epoch = result.epoch;
    sanitizeDirtyText(profile);   // 清洗历史导入可能带进的 "nullnull" 之类脏文本
    // 旧版默认模板（3 分类）且仍全空：自动升级为完整分类模板
    const OLD_STARTER = ['基本信息', '教育经历', '实习经历'];
    if (stats(profile).filled === 0 && profile.modules.length <= OLD_STARTER.length
      && profile.modules.every((m) => OLD_STARTER.includes(m.name))) {
      try {
        const upgraded = await repo.replaceAll(starterProfile(), '升级默认分类');
        profile = upgraded.profile;
        revision = profile.revision;
        epoch = upgraded.epoch;
      } catch { /* 升级失败则保留原样 */ }
    }
  }
  render();
  repo.subscribe((state) => {
    if (!state?.profile) return;
    if (!dirty && saving !== true && state.profile.revision !== revision) {
      profile = state.profile;
      revision = profile.revision;
      render();
    }
  });
  if (fillMode) {
    refreshTarget();
    chrome?.runtime?.onMessage?.addListener?.((request) => {
      if (request?.type === 'TARGET_UPDATED') refreshTarget();
    });
  }
  window.addEventListener('beforeunload', (event) => {
    if (dirty || saving) { event.preventDefault(); event.returnValue = ''; }
  });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault();
      flush().then((ok) => { if (ok) toast('已保存到本机。'); });
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
      event.preventDefault();
      searchInput?.focus();
    }
  });
}

main().catch((error) => {
  root.replaceChildren(h('div', { class: 'workspace' },
    h('section', { class: 'module' },
      h('div', { class: 'module-title', text: '资料暂时无法打开' }),
      h('p', { class: 'modal-description', text: errorMessage(error) }))));
});
