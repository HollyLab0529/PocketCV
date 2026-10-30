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
  // 基本信息（对齐同类插件：证件/民族/户口等网申常见固定字段）
  const basic = makeModule('基本信息');
  basic.entries.push(makeEntry('基本资料', [
    makeField('姓名', '', 'text'),
    makeField('性别', '', 'text'),
    makeField('出生日期', '', 'date'),
    makeField('证件类型', '', 'text'),
    makeField('证件号码', '', 'text', true),
    makeField('手机', '', 'tel', true),
    makeField('邮箱', '', 'email'),
    makeField('民族', '', 'text'),
    makeField('政治面貌', '', 'text'),
    makeField('现居住城市', '', 'text'),
    makeField('户口所在地', '', 'text'),
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
    makeField('在校时间', '', 'text'),
    makeField('绩点', '', 'text'),
    makeField('排名', '', 'text'),
    makeField('英语等级', '', 'text'),
    makeField('英语分数', '', 'text'),
    makeField('主修课程', '', 'multiline'),
  ]));
  // 实习经历
  const intern = makeModule('实习经历');
  intern.entries.push(makeEntry('示例公司 · 岗位', [
    makeField('单位名称', '', 'text'),
    makeField('岗位', '', 'text'),
    makeField('所在城市', '', 'text'),
    makeField('起止时间', '', 'text'),
    makeField('工作描述', '', 'multiline'),
    makeField('主要成果', '', 'multiline'),
  ]));
  // 项目经历
  const proj = makeModule('项目经历');
  proj.entries.push(makeEntry('项目名称', [
    makeField('担任角色', '', 'text'),
    makeField('项目链接', '', 'url'),
    makeField('起止时间', '', 'text'),
    makeField('项目描述', '', 'multiline'),
    makeField('技术栈 / 方法', '', 'text'),
    makeField('成果与数据', '', 'multiline'),
  ]));
  // 校园经历
  const campus = makeModule('校园经历', '扩展');
  campus.entries.push(makeEntry('学生工作 / 社团', [
    makeField('组织名称', '', 'text'),
    makeField('担任角色', '', 'text'),
    makeField('起止时间', '', 'text'),
    makeField('职责与成果', '', 'multiline'),
  ]));
  // 专业技能
  const skill = makeModule('专业技能', '扩展');
  skill.entries.push(makeEntry('技能清单', [
    makeField('专业技能', '', 'multiline'),
    makeField('办公 / 设计工具', '', 'text'),
    makeField('语言能力', '', 'text'),
    makeField('证书', '', 'text'),
  ]));
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
  p.modules.push(intent, basic, edu, intern, proj, campus, skill, award, self, other);
  return p;
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
