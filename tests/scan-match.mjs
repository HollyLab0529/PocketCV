// scan-match.js 匹配器测试（Node 直跑）：同名框按出现次序消耗、picker 跳过、同义词
import { matchBoxes, norm, sameValue } from '../src/ui/scan-match.js';

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

// 4. 同义词与置信度不变
{
  console.log('[同义词]');
  const ms = matchBoxes([box('请输入手机号'), box('身份证号码')], {
    modules: [{ id: 'm', name: 'x', tier: '常用', entries: [{ id: 'e', title: 't', fields: [field('s1', '手机', '13800000000'), field('s2', '证件号码', '110101200301011234')] }] }],
  });
  check('手机号命中同义词', ms.some((m) => m.field.label === '手机'), JSON.stringify(ms.map((m) => m.field.label)));
  check('身份证命中同义词', ms.some((m) => m.field.label === '证件号码'));
}

// 5. 基础工具函数
check('norm 去空白与标点', norm('请 输入：手机号*') === '请输入手机号');
check('sameValue 空值视为一致', sameValue('', 'x') === true && sameValue('a', 'a') === true && sameValue('a', 'b') === false);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
