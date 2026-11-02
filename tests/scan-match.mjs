// scan-match.js 匹配器测试（Node 直跑）：同名框按出现次序消耗、picker 跳过、同义词
import { matchBoxes, matchDateComponents, parseDateRange, norm, sameValue } from '../src/ui/scan-match.js';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail ?? ''}`); }
};

const field = (id, label, value) => ({ id, label, value });
const box = (label, extra = {}) => ({ label, value: '', kind: 'input', inputType: 'text', ...extra });

const profile = {
  modules: [{
    id: 'm1', name: '经历', tier: '常用',
    entries: [
      { id: 'e1', title: '经历一', fields: [field('f1', '单位名称', '公司A'), field('f2', '岗位', '实习一'), field('f3', '工作描述', '描述一')] },
      { id: 'e2', title: '经历二', fields: [field('f4', '单位名称', '公司B'), field('f5', '岗位', '实习二'), field('f6', '工作描述', '描述二')] },
    ],
  }],
};

// 1. 同名框按出现次序消耗：两段经历的公司/岗位分别对应
{
  console.log('[同名框按次序消耗]');
  const boxes = [box('公司名称'), box('职位名称'), box('公司名称'), box('职位名称')];
  const ms = matchBoxes(boxes, profile);
  check('4 个框全部命中', ms.length === 4, JSON.stringify(ms.map((m) => m.box.label)));
  const byBox = ms.map((m) => m.field.value);
  check('第 1 个公司框 → 公司A，第 2 个 → 公司B', byBox[0] === '公司A' && byBox[2] === '公司B', JSON.stringify(byBox));
  check('第 1 个职位框 → 实习一，第 2 个 → 实习二', byBox[1] === '实习一' && byBox[3] === '实习二', JSON.stringify(byBox));
}

// 2. 同名框多于资料记录：多余的框不匹配（避免把第一段写进所有段）
{
  console.log('[同名框多于记录]');
  const boxes = [box('公司名称'), box('公司名称'), box('公司名称')];
  const ms = matchBoxes(boxes, profile);
  check('只匹配 2 个（资料只有 2 条记录）', ms.length === 2, JSON.stringify(ms.map((m) => m.field.value)));
}

// 3. picker（请选择类自定义下拉）跳过，不自动填
{
  console.log('[picker 跳过]');
  const boxes = [box('请选择', { picker: true }), box('学历', { picker: false })];
  const ms = matchBoxes(boxes, { modules: [{ id: 'm', name: 'x', tier: '常用', entries: [{ id: 'e', title: 't', fields: [field('g1', '学历', '本科')] }] }] });
  check('picker 框不参与自动匹配', ms.length === 1 && ms[0].box.label === '学历', JSON.stringify(ms));
}

// 4. 名称不一致但共享词根：获奖经历 ↔ 获奖说明 / 获奖清单 ↔ 奖项名称
{
  console.log('[词根宽容匹配]');
  const p = { modules: [{ id: 'm', name: 'x', tier: '扩展', entries: [{ id: 'e', title: 't', fields: [field('a1', '获奖说明', '省级一等奖'), field('a2', '奖项名称', '数学竞赛')] }] }] };
  const ms = matchBoxes([box('获奖经历'), box('获奖清单')], p);
  check('两个框都能对上获奖类字段', ms.length === 2, JSON.stringify(ms.map((m) => m.field.label)));
  const labels = ms.map((m) => m.field.label).sort().join(',');
  check('获奖经历→奖项名称，获奖清单被占用后降级→获奖说明', labels === '奖项名称,获奖说明', labels);
}

// 5. 泛义词头不宽容：只有「期望」词根相同时不互相猜
{
  console.log('[泛义词头不宽容]');
  const ms = matchBoxes([box('期望城市')], {
    modules: [{ id: 'm', name: 'x', tier: '常用', entries: [{ id: 'e', title: 't', fields: [field('x1', '期望薪资', '20k')] }] }],
  });
  check('期望城市不会错配到期望薪资', ms.length === 0, JSON.stringify(ms));
}

// 6. 同义词与置信度不变
{
  console.log('[同义词]');
  const ms = matchBoxes([box('请输入手机号'), box('身份证号码')], {
    modules: [{ id: 'm', name: 'x', tier: '常用', entries: [{ id: 'e', title: 't', fields: [field('s1', '手机', '13800000000'), field('s2', '证件号码', '110101200301011234')] }] }],
  });
  check('手机号命中同义词', ms.some((m) => m.field.label === '手机'), JSON.stringify(ms.map((m) => m.field.label)));
  check('身份证命中同义词', ms.some((m) => m.field.label === '证件号码'));
}

// 6. 泛义词头黑名单扩充：只共享「工作」词根的两个不同维度字段不互猜
{
  console.log('[误匹配修复]');
  const ms = matchBoxes([box('工作地点')], {
    modules: [{ id: 'm', name: 'x', tier: '常用', entries: [{ id: 'e', title: 't', fields: [field('w1', '工作描述', '负责…')] }] }],
  });
  check('工作描述不会错配到工作地点', ms.length === 0, JSON.stringify(ms));
}

// 7. 日期分框：年/月 拆分框按锚点记录对应开始/结束
{
  console.log('[日期分框]');
  const profile = {
    modules: [{
      id: 'm', name: '实习', tier: '常用',
      entries: [{ id: 'e1', title: '实习一', fields: [field('j1', '单位名称', '美团'), field('j2', '起止时间', '2023.06 – 2024.03')] }],
    }],
  };
  const boxes = [box('单位名称'), box('年'), box('月'), box('年'), box('月')];
  const ms = matchBoxes(boxes, profile);
  const dates = matchDateComponents(boxes, ms, profile);
  check('4 个日期框全部给出建议', dates.length === 4, JSON.stringify(dates));
  check('第 1 个年框 = 2023、第 2 个 = 2024', dates[0].value === '2023' && dates[2].value === '2024', JSON.stringify(dates.map((d) => d.value)));
  check('月份保留原格式 06 / 03', dates[1].value === '06' && dates[3].value === '03', JSON.stringify(dates.map((d) => d.value)));
  check('hint 标明 开始/结束', dates[0].hint.includes('开始') && dates[2].hint.includes('结束'));
}

// 8. 「年月」整体框 + 出生上下文排除
{
  console.log('[年月整体框与排除]');
  const profile = {
    modules: [{
      id: 'm', name: '教育', tier: '常用',
      entries: [{ id: 'e1', title: '教育一', fields: [field('s1', '学校', '天津师范大学'), field('s2', '起止时间', '2023年9月 至 2027年6月')] }],
    }],
  };
  const boxes = [box('学校'), box('年月'), box('年月'), box('出生年月｜年'), box('出生年月｜月')];
  const ms = matchBoxes(boxes, profile);
  const dates = matchDateComponents(boxes, ms, profile);
  check('年月整体框填原始写法', dates[0]?.value === '2023年9月' && dates[1]?.value === '2027年6月', JSON.stringify(dates));
  check('出生相关框不参与', dates.length === 2, JSON.stringify(dates.map((d) => d.box.label)));
}

// 9. parseDateRange 多格式
{
  console.log('[日期解析]');
  check('点分格式', (() => { const s = parseDateRange('2023.06 – 2024.03'); return s[0].year === '2023' && s[0].month === '06' && s[1].year === '2024'; })());
  check('中文格式', (() => { const s = parseDateRange('2023年9月 至 2027年6月'); return s[0].month === '9' && s[1].month === '6'; })());
  check('斜杠格式', (() => { const s = parseDateRange('2023/06~2024/03'); return s[0].year === '2023' && s[1].month === '03'; })());
  check('单边时间', (() => { const s = parseDateRange('2024.11'); return s.length === 1 && s[0].year === '2024'; })());
}

// 10. 基础工具函数
check('norm 去空白与标点', norm('请 输入：手机号*') === '请输入手机号');
check('sameValue 空值视为一致', sameValue('', 'x') === true && sameValue('a', 'a') === true && sameValue('a', 'b') === false);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
