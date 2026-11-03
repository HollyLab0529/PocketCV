// splitSkillField / splitImportField 技能字段合并写法检测测试（Node 直跑）
import { makeField, splitSkillField, splitImportField } from '../src/domain/model.js';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail ?? ''}`); }
};

const f = (label, value) => { const x = makeField(label, '', 'text'); x.value = value; return x; };

check('熟练：详情 → 熟练 + 详情', (() => {
  const r = splitSkillField(f('C/C++', '熟练：专业课程基础'));
  return r && r.level === '熟练' && r.detail === '专业课程基础';
})());
check('精通（全角冒号）', (() => {
  const r = splitSkillField(f('Java', '精通：Spring Boot / MyBatis'));
  return r && r.level === '精通' && r.detail === 'Spring Boot / MyBatis';
})());
check('半角冒号', (() => {
  const r = splitSkillField(f('SQL', '熟悉: MySQL 调优'));
  return r && r.level === '熟悉' && r.detail === 'MySQL 调优';
})());
check('认证前缀（证书类字段）', (() => {
  const r = splitSkillField(f('帆软 FCP/FCA', '认证：商业数据分析（初级）'));
  return r && r.level === '认证' && r.detail === '商业数据分析（初级）';
})());
check('详情含换行完整保留', (() => {
  const r = splitSkillField(f('微信小程序', '熟练：原生开发，独立上线\n曾负责校园二手交易平台'));
  return r && r.level === '熟练' && r.detail === '原生开发，独立上线\n曾负责校园二手交易平台';
})());
check('只有程度没有详情', (() => {
  const r = splitSkillField(f('Python', '精通：'));
  return r && r.level === '精通' && r.detail === '';
})());
check('纯值无前缀 → null', splitSkillField(f('SQL', 'SQL 调优经验')) === null);
check('只有程度词无冒号 → null', splitSkillField(f('SQL', '熟练')) === null);
check('空值 → null', splitSkillField(f('SQL', '')) === null);
check('冒号在中间不算前缀 → null', splitSkillField(f('SQL', '日常熟练：使用')) === null);

// splitImportField：AI 导入兑底拆分
console.log('[splitImportField]');
check('合并写法 → 三段导入', (() => {
  const r = splitImportField({ label: 'SQL', value: '熟练：日常开发' });
  return r && r.length === 3
    && r[0].label === 'SQL' && r[0].value === 'SQL'
    && r[1].label === '掌握程度' && r[1].value === '熟练'
    && r[2].label === '技能详情' && r[2].value === '日常开发';
})());
check('只有程度 → 两段导入', (() => {
  const r = splitImportField({ label: 'Python', value: '精通：' });
  return r && r.length === 2 && r[0].value === 'Python' && r[1].value === '精通';
})());
check('普通值 → null（走普通导入）', splitImportField({ label: '姓名', value: '张三' }) === null);
check('空 label → null', splitImportField({ label: '  ', value: '熟练：x' }) === null);
check('非字符串 value → null', splitImportField({ label: 'SQL' }) === null);
check('认证前缀 → 证书名 + 认证 + 详情', (() => {
  const r = splitImportField({ label: '帆软 FCP/FCA', value: '认证：商业数据分析（初级）' });
  return r && r.length === 3 && r[0].value === '帆软 FCP/FCA' && r[1].value === '认证' && r[2].value === '商业数据分析（初级）';
})());

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
