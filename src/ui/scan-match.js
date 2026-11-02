// 口袋简历 PocketCV · 表单匹配器：把网页扫描到的输入框与资料字段对应起来
// 置信度：exact（完全同名）> synonym（同义词表命中）> fuzzy（包含关系）；未匹配的框留给用户逐个点填

const SYNONYMS = {
  '姓名': ['名字', '真实姓名', '考生姓名', '申请人姓名'],
  '性别': [],
  '出生日期': ['生日', '出生年月', '出生年月日'],
  '证件类型': ['身份证件类型', '证件'],
  '证件号码': ['身份证号', '身份证号码', '证件号', '身份证'],
  '手机': ['手机号', '手机号码', '电话', '联系电话', '联系方式', '移动电话', '手机号码（紧急）'],
  '邮箱': ['电子邮箱', '电子邮件', 'email', 'e-mail', '邮箱地址', '联系邮箱'],
  '民族': [],
  '政治面貌': ['政治状态', '党团关系'],
  '现居住城市': ['居住城市', '所在地', '现居地', '居住地', '所在城市'],
  '户口所在地': ['籍贯', '户口', '户籍所在地', '户籍', '户口所在城市'],
  '个人主页': ['个人网站', '个人网址', '主页链接', 'github', 'gitee'],
  '作品集链接': ['作品集', '作品链接', 'portfolio'],
  '学校': ['毕业院校', '院校', '学校名称', '毕业学校', '就读院校'],
  '学院': ['院系', '学院名称', '系'],
  '专业': ['所学专业', '专业名称', '主修专业'],
  '学历': ['最高学历', '学历层次', '学历程度', '教育程度'],
  '学位': ['学位类型', '获得学位'],
  '在校时间': ['在校起止时间', '就读时间', '教育经历时间', '在校年份'],
  '绩点': ['gpa', '平均绩点'],
  '排名': ['专业排名', '年级排名', '名次'],
  '英语等级': ['英语水平', '外语等级', '英语能力', '外语水平'],
  '英语分数': ['英语成绩', '外语成绩', '四六级成绩'],
  '主修课程': ['主要课程', '核心课程', '所学课程'],
  '单位名称': ['公司名称', '实习单位', '公司', '企业名称', '实习公司'],
  '岗位': ['实习岗位', '职位', '职位名称', '担任职位', '工作岗位'],
  '所在城市': ['实习城市', '工作城市', '工作地点'],
  '起止时间': ['实习时间', '工作时间', '起止日期', '实习起止时间', '项目时间', '任职时间'],
  '工作描述': ['实习描述', '工作内容', '工作职责', '职责描述', '实习内容', '项目中职责', '项目职责', '职责', '主要职责', '职责与成果'],
  '主要成果': ['实习成果', '工作成果', '主要业绩'],
  '担任角色': ['项目角色', '角色', '承担角色'],
  '项目链接': ['项目地址', '项目网址', 'demo 链接'],
  '项目描述': ['项目简介', '项目介绍', '项目内容', '项目说明'],
  '技术栈 / 方法': ['技术栈', '使用技术', '技术方案', '技术选型'],
  '成果与数据': ['项目成果', '项目业绩', '项目产出'],
  '组织名称': ['社团名称', '组织', '社团', '学生组织'],
  '职责与成果': ['工作职责与成果', '职责成果'],
  '专业技能': ['专业技能描述', '技能特长', '技能'],
  '办公 / 设计工具': ['熟练工具', '常用工具', '软件技能'],
  '语言能力': ['外语能力', '语言水平'],
  '证书': ['资格证书', '证书名称', '持有哪些证书'],
  '奖项名称': ['荣誉名称', '获奖名称', '获奖情况', '奖项', '获奖经历', '获奖清单', '获奖记录', '荣誉经历', '奖项经历', '荣誉清单'],
  '奖项级别': ['获奖级别', '奖项等级', '获奖等级'],
  '获奖说明': ['备注', '获奖备注'],
  '期望岗位': ['期望职位', '应聘岗位', '意向岗位', '应聘职位', '求职意向', '意向职位'],
  '期望城市': ['意向城市', '工作城市意向', '期望工作城市', '意向工作城市', '期望工作地点'],
  '期望薪资': ['期望月薪', '期望工资', '薪资期望', '薪资待遇', '期望薪酬', '意向薪资'],
  '求职类型': ['就业类型', '工作类型', '应聘类型'],
  '到岗时间': ['入职时间', '可到岗时间', '到岗日期', '最早到岗时间', '可入职时间'],
  '自我评价': ['自我介绍', '个人评价', '个人简介', '自我描述'],
  '紧急联系人': ['紧急联系人姓名', '紧急联系人及关系'],
  '与本人关系': ['紧急联系人关系', '联系人关系'],
  '紧急联系人电话': ['紧急联系方式', '紧急联系电话'],
};

export const norm = (s) => String(s || '')
  .replace(/\（|\）/g, () => '')
  .replace(/[\s*＊:：、，,．.·|｜\-—_()（）?？]/g, '')
  .toLowerCase();

// 网站已填值与资料值是否一致（归一后等值；前后缀差异算不一致，交给用户判断）
export const sameValue = (a, b) => {
  const x = norm(a), y = norm(b);
  return !x || !y ? true : x === y;
};

// 最长公共子串：网站字段名与资料字段名不一致但共享词根时（如「获奖经历」↔「获奖说明」）也能对上
const lcs = (a, b) => {
  let best = '';
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (a[i] !== b[j]) continue;
      let k = 1;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > best.length) best = a.slice(i, i + k);
    }
  }
  return best;
};
// 泛义修饰词头：只共享这类词头的两个字段多半是不同字段，不宽容匹配
// （如「工作描述」↔「工作地点」只差维度词、「期望城市」↔「期望薪资」只共享「期望」）
const GENERIC_HEADS = new Set([
  '期望', '意向', '紧急', '其他', '主要', '最高', '首选', '相关', '基本',
  '工作', '项目', '经历', '内容', '信息', '情况', '名称', '时间', '描述', '说明',
  '类型', '类别', '状态', '要求', '地点', '城市', '性质', '日期', '方式',
]);

// 把页面框的 label 拆成候选关键词：取「｜」前后两段分别参与匹配
const labelParts = (label) => String(label || '').split(/[｜|]/).flatMap((part) => part.split(/[\s/·]+/)).map(norm).filter(Boolean);

export function matchBoxes(boxes, profile) {
  // 同名字段按资料顺序建组：多段经历的「公司名称」等同名框按出现次序逐个消耗，
  // 避免把第一段经历的公司写进所有段。
  const fieldsByLabel = new Map();   // normLabel -> { label, fields: [...] }
  for (const m of profile.modules) {
    for (const e of m.entries) {
      for (const f of e.fields) {
        if (typeof f.value !== 'string' || !f.value.trim()) continue;
        const nl = norm(f.label);
        if (!fieldsByLabel.has(nl)) fieldsByLabel.set(nl, { label: f.label, fields: [] });
        fieldsByLabel.get(nl).fields.push(f);
      }
    }
  }
  const used = new Set();   // 高置信命中只允许一个框占用一个字段，避免多框抢同值
  const matches = [];
  for (const box of boxes) {
    if (box.picker) continue;   // 自定义下拉写入是假成功，留给用户手动选
    const parts = labelParts(box.label);
    const scored = [];
    for (const [nl, group] of fieldsByLabel) {
      const fl = nl;
      let score = 0;
      for (const part of parts) {
        if (!part) continue;
        if (part === fl) { score = Math.max(score, 3); break; }
        const syn = SYNONYMS[group.label] || [];
        if (syn.some((s) => norm(s) === part)) { score = Math.max(score, 2.5); break; }
        if ((part.length >= 2 && fl.length >= 2) && (part.includes(fl) || fl.includes(part))) score = Math.max(score, 1.5);
        else if (part.length >= 3 && fl.length >= 3) {
          // 宽容匹配：共享 ≥2 字词根且覆盖较短一方近半，视为同义（预览确认兜底，不怕猜错）
          const common = lcs(part, fl);
          if (common.length >= 2 && !GENERIC_HEADS.has(common) && common.length >= Math.min(part.length, fl.length) * 0.4) {
            score = Math.max(score, 1.5);
          }
        }
      }
      if (score) scored.push({ group, score });
    }
    scored.sort((a, b) => b.score - a.score);
    // 按置信度从高到低尝试：高置信字段被同名框占用时降级到次高候选（如「获奖清单」被「奖项名称」
    // 占用后改对「获奖说明」），而不是整框落空
    for (const cand of scored) {
      if (cand.score < 1.5) break;
      const exclusive = cand.score >= 2.5;
      let field = null;
      if (exclusive) {
        // 同名字段按出现次序消耗：第 N 个同名框 → 第 N 条记录的同名字段；用完后降级
        field = cand.group.fields.find((f) => !used.has(f.id)) || null;
        if (field) used.add(field.id);
      } else {
        field = cand.group.fields[0];
      }
      if (field) {
        matches.push({ box, field, confidence: cand.score >= 2.5 ? 'high' : 'medium' });
        break;
      }
    }
  }
  return matches.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'high' ? -1 : 1));
}

// ===== 日期分框匹配 =====
// 网申网站的起止时间是 年/月/日 独立小框或「年月」整体框，无法按字段名对上资料。
// 策略：以最近一条命中的记录（教育/实习/项目）为锚，解析该记录的「起止时间」类字段，
// 同一段内的日期分框按出现次序对应 开始(第1个)→结束(第2个)。
const DATE_PART = /^(年|月|日|年份|月份|年月)$/;
const DATE_FIELD = /起止|时间段|在校|任职|期间|起止时间|时间/;
const DATE_EXCLUDE = /出生|生日|身份证|证件/;

// 解析「2023.06 – 2024.03」「2023年6月-2024年3月」「2023/06~2024/03」等写法
export function parseDateRange(text) {
  const halves = String(text).split(/\s*[–—~～\-]+\s*|\s*至\s*|\s*到\s*/).filter(Boolean);
  const parseSide = (raw) => {
    const nums = raw.match(/\d+/g) || [];
    const year = nums.find((n) => n.length === 4) || '';
    const rest = nums.filter((n) => n !== year);
    const month = rest.length && Number(rest[0]) >= 1 && Number(rest[0]) <= 12 ? rest[0] : '';
    const day = rest.length > 1 && Number(rest[1]) >= 1 && Number(rest[1]) <= 31 ? rest[1] : '';
    return { text: raw.trim(), year, month, day };
  };
  if (!halves.length) return null;
  const sides = [parseSide(halves[0])];
  if (halves.length > 1) sides.push(parseSide(halves[1]));
  return sides;
}

// 返回 [{ box, value, hint }]：hint 说明「开始/结束·年份/月份」及来源字段，UI 默认不勾选由用户确认
export function matchDateComponents(boxes, matches, profile) {
  const entryOfField = new Map();
  for (const mod of profile.modules) {
    for (const e of mod.entries) {
      for (const f of e.fields) entryOfField.set(f.id, e);
    }
  }
  const matchByBox = new Map(matches.map((m) => [m.box, m]));
  const picks = [];
  let sides = null;         // 当前记录的 [开始, 结束]
  let sourceLabel = '';
  let count = { 年: 0, 月: 0, 日: 0, 年月: 0 };
  for (const box of boxes) {
    if (DATE_EXCLUDE.test(box.label)) continue;
    const m = matchByBox.get(box);
    if (m) {
      // 新记录锚点：命中了另一条记录的字段时重置日期上下文
      const e = entryOfField.get(m.field.id);
      if (e) {
        const df = (e.fields || []).find((f) => DATE_FIELD.test(f.label) && typeof f.value === 'string' && f.value.trim());
        sides = df ? parseDateRange(df.value) : null;
        sourceLabel = df ? df.label : '';
        count = { 年: 0, 月: 0, 日: 0, 年月: 0 };
      }
      continue;
    }
    if (!sides || box.value) continue;
    const part = labelParts(box.label).find((p) => DATE_PART.test(p));
    if (!part) continue;
    const comp = part === '年份' ? '年' : part === '月份' ? '月' : part;
    const idx = count[comp]++;
    if (idx > 1) continue;                        // 一段记录最多 开始+结束 两轮
    const side = sides[idx];
    if (!side) continue;
    const value = comp === '年' ? side.year : comp === '月' ? side.month : comp === '日' ? side.day : side.text;
    if (!value) continue;
    picks.push({ box, value, hint: `${idx ? '结束' : '开始'}·${comp} ← 资料「${sourceLabel}」${side.text}` });
  }
  return picks;
}
