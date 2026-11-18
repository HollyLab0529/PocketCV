// alignStarterPack 用友对齐迁移测试（Node 直跑）
import { makeField, makeEntry, makeModule, alignStarterPack, starterProfile } from '../src/domain/model.js';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail ?? ''}`); }
};

const fieldOf = (e, label) => e.fields.find((f) => f.label === label);
const val = (e, label) => fieldOf(e, label)?.value;
const profileWith = (mods) => ({ version: 1, id: 'p', name: 'x', revision: 0, updatedAt: '', modules: mods });

// 旧版结构：合并时间字段 + 缺新字段/新模块
function legacyProfile() {
  const basic = makeModule('基本信息');
  basic.entries.push(makeEntry('基本资料', [
    makeField('姓名', '', 'text'), makeField('出生日期', '', 'date'), makeField('现居住城市', '', 'text'), makeField('户口所在地', '', 'text'),
  ]));
  const edu = makeModule('教育经历');
  const eduE = makeEntry('最高学历', [
    makeField('学校', '', 'text'), makeField('学历', '', 'text'),
  ]);
  const schTime = makeField('在校时间', '', 'text');
  schTime.value = '2023.09 – 2027.06';
  eduE.fields.push(schTime);
  edu.entries.push(eduE);
  const intern = makeModule('实习经历');
  const it = makeEntry('美团 · 全栈', [
    makeField('单位名称', '', 'text'), makeField('岗位', '', 'text'),
  ]);
  const itTime = makeField('起止时间', '', 'text');
  itTime.value = '2024年3月 至 2024年9月';
  it.fields.push(itTime);
  intern.entries.push(it);
  const skill = makeModule('专业技能');
  const sk = makeEntry('技能清单');
  const f1 = makeField('技能名称', 'SQL', 'text'); f1.group = 'SQL';
  const f2 = makeField('掌握程度', '熟练', 'text'); f2.group = 'SQL';
  const f3 = makeField('技能详情', '日常开发', 'text'); f3.group = 'SQL';
  sk.fields.push(f1, f2, f3);
  skill.entries.push(sk);
  return profileWith([basic, edu, intern, skill]);
}

console.log('[alignStarterPack 迁移]');
{
  const p = legacyProfile();
  const changed = alignStarterPack(p);
  check('有改动返回 true', changed === true);
  const eduE = p.modules.find((m) => m.name === '教育经历').entries[0];
  check('在校时间拆成 开始/结束（值正确拆开）', val(eduE, '开始时间') === '2023.09' && val(eduE, '结束时间') === '2027.06' && !fieldOf(eduE, '在校时间'), JSON.stringify(eduE.fields.map((f) => f.label)));
  check('教育补 是否全日制/是否统招/是否挂科', !!fieldOf(eduE, '是否全日制') && !!fieldOf(eduE, '是否统招') && !!fieldOf(eduE, '是否挂科'));
  const it = p.modules.find((m) => m.name === '实习经历').entries[0];
  check('起止时间中文写法也能拆', val(it, '开始时间') === '2024年3月' && val(it, '结束时间') === '2024年9月', JSON.stringify(it.fields.map((f) => f.label)));
  check('实习补 所在部门', !!fieldOf(it, '所在部门'));
  const basicE = p.modules.find((m) => m.name === '基本信息').entries[0];
  check('基本补 婚姻状况/通信地址/是否有海外留学经历', !!fieldOf(basicE, '婚姻状况') && !!fieldOf(basicE, '通信地址') && !!fieldOf(basicE, '是否有海外留学经历'));
  const names = new Set(p.modules.map((m) => m.name));
  check('新增 家庭关系/证书/工作经历 三个模块', names.has('家庭关系') && names.has('证书') && names.has('工作经历'), JSON.stringify([...names]));
  const famE = p.modules.find((m) => m.name === '家庭关系').entries[0];
  check('家庭成员字段齐（姓名/关系/工作单位/职位）', !!fieldOf(famE, '姓名') && !!fieldOf(famE, '关系') && !!fieldOf(famE, '工作单位') && !!fieldOf(famE, '职位'));
  const sk = p.modules.find((m) => m.name === '专业技能').entries[0];
  check('技能卡补 使用时间（归组正确）', fieldOf(sk, '使用时间')?.group === 'SQL', JSON.stringify(sk.fields.map((f) => `${f.label}|${f.group}`)));
}
{
  const p = legacyProfile();
  alignStarterPack(p);
  check('幂等：再跑返回 false 且不新增字段', alignStarterPack(p) === false && p.modules.length === 7);
}
{
  // 拆不动的值：保留原字段，拆分字段留空
  const edu = makeModule('教育经历');
  const e = makeEntry('最高学历');
  const t = makeField('在校时间', '', 'text'); t.value = '本科在读';
  e.fields.push(t);
  edu.entries.push(e);
  const p = profileWith([edu]);
  alignStarterPack(p);
  check('拆不动 → 保留原字段 + 空拆分字段', val(e, '在校时间') === '本科在读' && fieldOf(e, '开始时间')?.value === '' && fieldOf(e, '结束时间')?.value === '');
}
{
  // 「至今」侧无法解析：同样保留
  const intern = makeModule('实习经历');
  const e = makeEntry('实习');
  const t = makeField('起止时间', '', 'text'); t.value = '2024.03 – 至今';
  e.fields.push(t);
  intern.entries.push(e);
  const p = profileWith([intern]);
  alignStarterPack(p);
  check('含至今 → 保留原字段', val(e, '起止时间') === '2024.03 – 至今');
}
{
  // 空资料 / 缺失模块：不报错，只补新模块
  const p = profileWith([]);
  check('空资料 → 补三个新模块', alignStarterPack(p) === true && p.modules.length === 3);
  check('空资料再跑 → 无改动', alignStarterPack(p) === false);
  check('空入参安全', alignStarterPack(null) === false);
}
{
  const s = starterProfile();
  check('新资料本身就是对齐后的 → 迁移无改动', alignStarterPack(s) === false, JSON.stringify(s.modules.map((m) => m.name)));
  const eduE = s.modules.find((m) => m.name === '教育经历').entries[0];
  check('新资料教育模块字段齐备', !!fieldOf(eduE, '开始时间') && !!fieldOf(eduE, '是否全日制') && !!fieldOf(eduE, '是否挂科'));
  const certE = s.modules.find((m) => m.name === '证书').entries[0];
  check('新资料证书模块字段齐备', !!fieldOf(certE, '证书名称') && !!fieldOf(certE, '获得时间') && !!fieldOf(certE, '说明'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
