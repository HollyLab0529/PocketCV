// 口袋简历 PocketCV · 数据模型与校验
// 自有实现。字段类型与结构为功能所需的基础设计。

export const VERSION = 1;
export const TYPES = ['text', 'multiline', 'date', 'month', 'email', 'tel', 'url', 'number'];
export const TYPE_NAMES = { text: '单行文本', multiline: '多行文本', date: '日期', month: '年月', email: '邮箱', tel: '电话', url: '链接', number: '数字' };
export const TIERS = ['常用', '扩展', '备用'];
export const LIMITS = Object.freeze({
  fileBytes: 8 * 1024 * 1024,
  profileBytes: 2 * 1024 * 1024,
  modules: 60,
  entries: 600,
  fields: 6000,
  value: 32767,
  label: 120,
});

let seq = 0;
export function uid(prefix = 'id') {
  seq = (seq + 1) % 46656;
  const rand = Math.floor(Math.random() * 2176782336).toString(36);
  return `${prefix}_${Date.now().toString(36)}${rand}${seq.toString(36).padStart(3, '0')}`;
}

export function makeModule(name, tier = '常用') {
  return { id: uid('m'), name: String(name).slice(0, LIMITS.label), tier, entries: [] };
}
export function makeEntry(title, fields = []) {
  return { id: uid('e'), title: String(title).slice(0, LIMITS.label), fields };
}
export function makeField(label, group = '', type = 'text', sensitive = false) {
  return { id: uid('f'), label: String(label).slice(0, LIMITS.label), group: String(group).slice(0, LIMITS.label), type, value: '', sensitive: !!sensitive };
}

// 「程度：详情」合并写法检测：技能类字段常把熟练度和详情写在一个值里（如「熟练：Spring Boot / MyBatis…」），
// 而网站上的技能名称、掌握程度是分开的输入框。返回 { level, detail } 供一键拆分；不是合并写法返回 null。
const SKILL_LEVEL_RE = /^(熟练|精通|掌握|熟悉|了解|入门|一般|初级|中级|高级|认证|证书)[：:]\s*/;

export function splitSkillField(f) {
  const m = String(f?.value || '').match(SKILL_LEVEL_RE);
  if (!m) return null;
  return { level: m[1], detail: f.value.slice(m[0].length).trim() };
}

// AI 导入兜底：合并写法字段默认拆成 技能名称/掌握程度/使用时间/技能详情 段，用 group=技能名 归组成卡片；
// 不是合并写法返回 null，走普通字段导入
export function splitImportField(f) {
  const label = String(f?.label || '').trim();
  const parts = splitSkillField(f);
  if (!label || !parts) return null;
  const out = [
    { label: '技能名称', value: label, group: label },
    { label: '掌握程度', value: parts.level, group: label },
    { label: '使用时间', value: '', group: label },
  ];
  if (parts.detail) out.push({ label: '技能详情', value: parts.detail, group: label });
  return out;
}

// 技能三段归组（幂等自愈）：填写面板按 group=技能名 渲染「技能名卡片头 + 程度/详情行」，
// 但数据来源多样——AI 按提示词输出的拆分字段不带 group、手工录入/历史数据也可能缺——
// 缺了就退化成普通字段行。把相邻的 技能名称/掌握程度/技能详情 统一归组，返回是否有改动。
// 兼容旧格式：label=技能名、value=技能名、后一项是「掌握程度」的字段，先标准化成「技能名称」。
export function regroupSkills(modules) {
  const TAIL = new Set(['掌握程度', '技能详情', '使用时间']);
  let changed = false;
  for (const m of modules || []) {
    for (const e of m.entries || []) {
      const fs = e.fields;
      for (let i = 0; i < fs.length; i++) {
        const f = fs[i];
        let g = '';
        if (f.label === '技能名称' && f.value.trim()) g = f.value.trim();
        else if (f.value.trim() && f.value.trim() === f.label.trim() && fs[i + 1] && fs[i + 1].label === '掌握程度') {
          f.label = '技能名称';
          g = f.value.trim();
          changed = true;
        }
        if (!g) continue;
        if (f.group !== g) { f.group = g; changed = true; }
        for (let k = i + 1; k <= Math.min(i + 3, fs.length - 1); k++) {
          if (fs[k].label === '技能名称') break;   // 下一个技能开始，不再归入本组
          if (TAIL.has(fs[k].label) && fs[k].group !== g) { fs[k].group = g; changed = true; }
        }
      }
    }
  }
  return changed;
}

export function emptyProfile() {
  return { version: VERSION, id: uid('p'), name: '我的求职资料', revision: 0, updatedAt: new Date().toISOString(), modules: [] };
}

export function starterProfile() {
  const p = emptyProfile();
  p.name = '我的口袋简历';
  // 求职意向
  const intent = makeModule('求职意向');
  intent.entries.push(makeEntry('求职意向', [
    makeField('期望岗位', '', 'text'),
    makeField('期望城市', '', 'text'),
    makeField('期望薪资', '', 'text'),
    makeField('求职类型', '', 'text'),
    makeField('到岗时间', '', 'text'),
  ]));
  // 基本信息（对齐同类插件：证件/民族/户口/婚姻/通信地址等网申常见固定字段）
  const basic = makeModule('基本信息');
  basic.entries.push(makeEntry('基本资料', [
    makeField('姓名', '', 'text'),
    makeField('性别', '', 'text'),
    makeField('出生日期', '', 'date'),
    makeField('婚姻状况', '', 'text'),
    makeField('证件类型', '', 'text'),
    makeField('证件号码', '', 'text', true),
    makeField('手机', '', 'tel', true),
    makeField('邮箱', '', 'email'),
    makeField('民族', '', 'text'),
    makeField('政治面貌', '', 'text'),
    makeField('现居住城市', '', 'text'),
    makeField('通信地址', '', 'text'),
    makeField('户口所在地', '', 'text'),
    makeField('是否有海外留学经历', '', 'text'),
    makeField('个人主页', '', 'url'),
    makeField('作品集链接', '', 'url'),
  ]));
  // 教育经历
  const edu = makeModule('教育经历');
  edu.entries.push(makeEntry('最高学历', [
    makeField('学校', '', 'text'),
    makeField('学院', '', 'text'),
    makeField('专业', '', 'text'),
    makeField('学历', '', 'text'),
    makeField('学位', '', 'text'),
    makeField('开始时间', '', 'month'),
    makeField('结束时间', '', 'month'),
    makeField('是否全日制', '', 'text'),
    makeField('是否统招', '', 'text'),
    makeField('是否挂科', '', 'text'),
    makeField('绩点', '', 'text'),
    makeField('排名', '', 'text'),
    makeField('英语等级', '', 'text'),
    makeField('英语分数', '', 'text'),
    makeField('主修课程', '', 'multiline'),
  ]));
  edu.entries.push(makeEntry('第一学历（如与最高学历不同）', [
    makeField('学校', '', 'text'),
    makeField('专业', '', 'text'),
    makeField('学历', '', 'text'),
    makeField('学位', '', 'text'),
    makeField('开始时间', '', 'month'),
    makeField('结束时间', '', 'month'),
    makeField('是否全日制', '', 'text'),
    makeField('是否统招', '', 'text'),
    makeField('是否挂科', '', 'text'),
  ]));
  // 实习经历
  const intern = makeModule('实习经历');
  intern.entries.push(makeEntry('示例公司 · 岗位', [
    makeField('单位名称', '', 'text'),
    makeField('岗位', '', 'text'),
    makeField('所在部门', '', 'text'),
    makeField('所在城市', '', 'text'),
    makeField('开始时间', '', 'month'),
    makeField('结束时间', '', 'month'),
    makeField('工作描述', '', 'multiline'),
    makeField('主要成果', '', 'multiline'),
  ]));
  // 项目经历
  const proj = makeModule('项目经历');
  proj.entries.push(makeEntry('项目名称', [
    makeField('项目名称', '', 'text'),
    makeField('担任角色', '', 'text'),
    makeField('项目链接', '', 'url'),
    makeField('开始时间', '', 'month'),
    makeField('结束时间', '', 'month'),
    makeField('项目描述', '', 'multiline'),
    makeField('项目职责', '', 'multiline'),
    makeField('技术栈 / 方法', '', 'text'),
    makeField('成果与数据', '', 'multiline'),
  ]));
  // 校园经历
  const campus = makeModule('校园经历', '扩展');
  campus.entries.push(makeEntry('学生工作 / 社团', [
    makeField('组织名称', '', 'text'),
    makeField('担任角色', '', 'text'),
    makeField('开始时间', '', 'month'),
    makeField('结束时间', '', 'month'),
    makeField('职责与成果', '', 'multiline'),
  ]));
  // 专业技能
  const skill = makeModule('专业技能', '扩展');
  skill.entries.push(makeEntry('技能清单', [
    makeField('专业技能', '', 'multiline'),
    makeField('办公 / 设计工具', '', 'text'),
    makeField('语言能力', '', 'text'),
  ]));
  // 证书
  const cert = certModule();
  // 家庭关系
  const family = familyModule();
  // 获奖荣誉
  const award = makeModule('获奖荣誉', '扩展');
  award.entries.push(makeEntry('荣誉记录', [
    makeField('奖项名称', '', 'text'),
    makeField('获奖时间', '', 'month'),
    makeField('奖项级别', '', 'text'),
    makeField('获奖说明', '', 'text'),
  ]));
  // 自我评价
  const self = makeModule('自我评价', '扩展');
  self.entries.push(makeEntry('自我评价', [
    makeField('优势总结', '', 'multiline'),
  ]));
  // 其他资料（备用）
  const other = makeModule('其他资料', '备用');
  other.entries.push(makeEntry('补充信息', [
    makeField('紧急联系人', '', 'text'),
    makeField('紧急联系人电话', '', 'tel', true),
    makeField('其他补充', '', 'multiline'),
  ]));
  // 工作经历（全职，实习之外的经历）
  const work = workModule();
  p.modules.push(intent, basic, edu, intern, proj, campus, skill, cert, family, award, self, work, other);
  return p;
}

function familyModule() {
  const m = makeModule('家庭关系');
  m.entries.push(makeEntry('家庭成员', [
    makeField('姓名', '', 'text'),
    makeField('关系', '', 'text'),
    makeField('工作单位', '', 'text'),
    makeField('职位', '', 'text'),
  ]));
  return m;
}

function certModule() {
  const m = makeModule('证书');
  m.entries.push(makeEntry('证书', [
    makeField('证书名称', '', 'text'),
    makeField('获得时间', '', 'month'),
    makeField('说明', '', 'text'),
  ]));
  return m;
}

function workModule() {
  const m = makeModule('工作经历', '扩展');
  m.entries.push(makeEntry('示例公司 · 岗位', [
    makeField('单位名称', '', 'text'),
    makeField('岗位', '', 'text'),
    makeField('所在部门', '', 'text'),
    makeField('所在城市', '', 'text'),
    makeField('开始时间', '', 'month'),
    makeField('结束时间', '', 'month'),
    makeField('工作描述', '', 'multiline'),
  ]));
  return m;
}

// 用友在线简历对齐迁移（alignPackV1，一次性）：给存量资料补上新增模块/字段、把「在校时间/起止时间」
// 拆成 开始时间/结束时间、技能卡补「使用时间」。幂等：改动返回 true，已是新版返回 false。
const TIME_SPLIT_RE = /\s*(?:–|—|~|～|至|到|到|-)\s*/;

export function alignStarterPack(profile) {
  if (!profile || !Array.isArray(profile.modules)) return false;
  let changed = false;
  const mod = (name) => profile.modules.find(m => m.name === name);
  const fld = (e, label) => e.fields.find(f => f.label === label);
  const ensureField = (e, label, type, afterLabel) => {
    if (fld(e, label)) return;
    const idx = afterLabel && afterLabel.length > 0 ? e.fields.findIndex(f => f.label === afterLabel) : -1;
    const nf = makeField(label, '', type);
    if (idx >= 0) e.fields.splice(idx + 1, 0, nf); else e.fields.push(nf);
    changed = true;
  };
  const splitTimeField = (e, oldLabel) => {
    const old = fld(e, oldLabel);
    if (!old || fld(e, '开始时间') || fld(e, '结束时间')) return;   // 已拆过或没有可拆的
    const norm = String(old.value || '').replace(/(\d{4})\s*-\s*(?=\d{1,2}(?!\d))/g, '$1.');
    const halves = norm.split(TIME_SPLIT_RE).map(s => s.trim()).filter(Boolean);
    const ok = halves.length >= 2 && /\d/.test(halves[0]) && /\d/.test(halves[1]);
    const idx = e.fields.indexOf(old);
    const start = makeField('开始时间', '', 'month');
    const end = makeField('结束时间', '', 'month');
    if (ok) { start.value = halves[0]; end.value = halves[1]; e.fields.splice(idx, 1, start, end); }
    else e.fields.splice(idx, 0, start, end);   // 拆不动：保留原字段，拆分字段留空
    changed = true;
  };
  const basic = mod('基本信息');
  if (basic) for (const e of basic.entries || []) {
    ensureField(e, '婚姻状况', 'text', '出生日期');
    ensureField(e, '通信地址', 'text', '现居住城市');
    ensureField(e, '是否有海外留学经历', 'text', '户口所在地');
  }
  const edu = mod('教育经历');
  if (edu) for (const e of edu.entries || []) {
    splitTimeField(e, '在校时间');
    ensureField(e, '是否全日制', 'text', '结束时间');
    ensureField(e, '是否统招', 'text', '是否全日制');
    ensureField(e, '是否挂科', 'text', '是否统招');
  }
  const intern = mod('实习经历');
  if (intern) for (const e of intern.entries || []) {
    splitTimeField(e, '起止时间');
    ensureField(e, '所在部门', 'text', '岗位');
  }
  const proj = mod('项目经历');
  if (proj) for (const e of proj.entries || []) {
    splitTimeField(e, '起止时间');
    ensureField(e, '项目职责', 'multiline', '项目描述');
    // 补「项目名称」字段：网申表单普遍有这个框，之前名称只存在记录标题里，
    // 一键核对对不上、填写面板也没得复制。迁移时用记录标题填值（仅创建时，之后尊重用户修改）。
    if (!fld(e, '项目名称')) {
      const nf = makeField('项目名称', '', 'text');
      if (e.title) nf.value = e.title;
      e.fields.unshift(nf);
      changed = true;
    }
  }
  const campus = mod('校园经历');
  if (campus) for (const e of campus.entries || []) splitTimeField(e, '起止时间');
  const skill = mod('专业技能');
  if (skill) for (const e of skill.entries || []) {
    const fs = e.fields;
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      if (f.label !== '技能名称' || !f.group) continue;
      if (fs.some(x => x.group === f.group && x.label === '使用时间')) continue;
      const lvlIdx = fs.findIndex(x => x.group === f.group && x.label === '掌握程度');
      fs.splice(lvlIdx >= 0 ? lvlIdx + 1 : i + 1, 0, makeField('使用时间', f.group, 'text'));
      changed = true;
      i++;
    }
  }
  const names = new Set(profile.modules.map(m => m.name));
  if (!names.has('家庭关系')) { profile.modules.push(familyModule()); changed = true; }
  if (!names.has('证书')) { profile.modules.push(certModule()); changed = true; }
  if (!names.has('工作经历')) { profile.modules.push(workModule()); changed = true; }
  return changed;
}

/** 下载模板用的推荐结构：分类/记录/字段齐备但内容留空。
 * 用户可直接填写，或连同简历原文交给任意 AI 填写后导回。与侧栏默认分类保持一致。 */
export function templateProfile() {
  return starterProfile();
}

function checkId(v, path, used) {
  if (typeof v !== 'string' || !v || v.length > 80 || !/^[-\w]+$/.test(v)) throw new Error(`${path} 的 ID 无效。`);
  if (used.has(v)) throw new Error(`${path} 的 ID 重复。`);
  used.add(v);
  return v;
}
function checkText(v, path, max, required = false) {
  if (typeof v !== 'string' || v.length > max) throw new Error(`${path} 必须是不超过 ${max} 字的文本。`);
  if (required && !v.trim()) throw new Error(`${path} 不能为空。`);
  return v;
}

export function byteLength(obj) { return new TextEncoder().encode(JSON.stringify(obj)).length; }

export function validateProfile(raw) {
  const fail = (msg) => { throw new Error(msg); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('资料格式不正确。');
  if (raw.version !== VERSION) fail(`不支持的资料版本 ${String(raw.version)}。`);
  if (byteLength(raw) > LIMITS.profileBytes) fail('资料超过 2 MB，请精简内容。');
  const used = new Set();
  checkId(raw.id, '资料', used);
  if (!Number.isSafeInteger(raw.revision) || raw.revision < 0) fail('资料版本号无效。');
  if (typeof raw.updatedAt !== 'string' || !Number.isFinite(Date.parse(raw.updatedAt))) fail('资料更新时间无效。');
  if (!Array.isArray(raw.modules) || raw.modules.length > LIMITS.modules) fail('分类数量无效。');
  const out = { version: VERSION, id: raw.id, name: checkText(raw.name, '资料名称', LIMITS.label, true), revision: raw.revision, updatedAt: raw.updatedAt, modules: [] };
  let entries = 0, fields = 0;
  for (const m of raw.modules) {
    if (!m || !Array.isArray(m.entries)) fail('分类结构无效。');
    entries += m.entries.length;
    if (entries > LIMITS.entries) fail('总记录数超过上限。');
    out.modules.push({
      id: checkId(m.id, '分类', used),
      name: checkText(m.name, '分类名称', LIMITS.label, true),
      tier: TIERS.includes(m.tier) ? m.tier : '常用',
      entries: m.entries.map((e) => {
        if (!e || !Array.isArray(e.fields)) fail('记录结构无效。');
        fields += e.fields.length;
        if (fields > LIMITS.fields) fail('总字段数超过上限。');
        return {
          id: checkId(e.id, '记录', used),
          title: checkText(e.title, '记录名称', LIMITS.label, true),
          fields: e.fields.map((f) => {
            if (!f || !TYPES.includes(f.type) || typeof f.sensitive !== 'boolean') fail('字段类型或敏感标记无效。');
            return {
              id: checkId(f.id, '字段', used),
              label: checkText(f.label, '字段名称', LIMITS.label, true),
              group: checkText(f.group ?? '', '字段分组', LIMITS.label),
              type: f.type,
              value: checkText(f.value ?? '', `字段「${f.label}」内容`, LIMITS.value),
              sensitive: f.sensitive,
            };
          }),
        };
      }),
    });
  }
  return out;
}

export function stats(profile) {
  let modules = 0, entries = 0, filled = 0, sensitive = 0;
  for (const m of profile.modules) { modules++; for (const e of m.entries) { entries++; for (const f of e.fields) { if (f.value !== '') filled++; if (f.sensitive && f.value !== '') sensitive++; } } }
  return { modules, entries, filled, sensitive };
}

export function mask(value) { if (!value) return ''; return value.length <= 2 ? '＊'.repeat(value.length) : value[0] + '＊'.repeat(Math.max(1, value.length - 2)) + value[value.length - 1]; }
export function summary(entry) { const parts = entry.fields.filter((f) => f.value).map((f) => f.value.split('\n')[0]); const text = parts.join(' · '); return text.length > 60 ? text.slice(0, 60) + '…' : text; }
export function searchable(field, entry, module, query) {
  const q = query.toLowerCase();
  if (field.sensitive) return field.label.toLowerCase().includes(q);
  return [field.label, field.group, field.value, entry.title, module.name].join('\n').toLowerCase().includes(q);
}
export function getEntry(profile, entryId) {
  for (const m of profile.modules) { const e = m.entries.find((x) => x.id === entryId); if (e) return { module: m, entry: e }; }
  return null;
}
export function clone(value) { return structuredClone(value); }
export function moveItem(list, id, offset) {
  const i = list.findIndex((x) => x.id === id); const j = i + offset;
  if (i < 0 || j < 0 || j >= list.length) return;
  const [item] = list.splice(i, 1); list.splice(j, 0, item);
}
