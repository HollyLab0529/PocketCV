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

// 11. 连字符年月范围：不许把一段日期拆成多段（真实资料常见「2023-06 ~ 2024-03」写法）
{
  console.log('[连字符年月解析]');
  const a = parseDateRange('2023-06 ~ 2024-03');
  check('波浪号 + 连字符年月', a.length === 2 && a[0].year === '2023' && a[0].month === '06' && a[1].year === '2024' && a[1].month === '03', JSON.stringify(a));
  const b = parseDateRange('2023-06 至 2024-03');
  check('「至」+ 连字符年月', b.length === 2 && b[0].month === '06' && b[1].month === '03', JSON.stringify(b));
  const c = parseDateRange('2023-2024');
  check('纯年份段不误拆', c.length === 2 && c[0].year === '2023' && c[1].year === '2024', JSON.stringify(c));
  const d = parseDateRange('2023.06-至今');
  check('「至今」侧被过滤（不产生结束建议）', d.length === 1 && d[0].year === '2023', JSON.stringify(d));
}

// 12. 宽容匹配去重：多个模糊框对多条同名记录各取一条，不重复填第一条
{
  console.log('[宽容匹配去重]');
  const p = { modules: [{ id: 'm', name: 'x', tier: '常用', entries: [{ id: 'e', title: 't', fields: [field('a', '证书', '证书一'), field('b', '证书', '证书二')] }] }] };
  const ms = matchBoxes([box('技能证书'), box('其他证书')], p);
  const vals = ms.map((m) => m.field.value);
  check('两个模糊框各取一条记录', vals.join(',') === '证书一,证书二', JSON.stringify(vals));
}

// 13. 高置信优先：模糊框在 DOM 前面也不能抢走高置信框该用的字段
{
  console.log('[高置信优先于模糊]');
  const p = { modules: [{ id: 'm', name: 'x', tier: '常用', entries: [{ id: 'e', title: 't', fields: [field('a', '证书', '证书一'), field('b', '证书', '证书二')] }] }] };
  const ms = matchBoxes([box('技能证书'), box('证书名称')], p);
  const byBox = Object.fromEntries(ms.map((m) => [m.box.label, m.field.value]));
  check('同义词框拿到第一条', byBox['证书名称'] === '证书一', JSON.stringify(byBox));
  check('模糊框补位到第二条', byBox['技能证书'] === '证书二', JSON.stringify(byBox));
}

// 14. 确认邮箱式回退：资料只有一条时，模糊框仍允许重复填同一值（确认邮箱=邮箱）
{
  console.log('[确认邮箱式回退]');
  const p = { modules: [{ id: 'm', name: 'x', tier: '常用', entries: [{ id: 'e', title: 't', fields: [field('a', '邮箱', 'a@x.com')] }] }] };
  const ms = matchBoxes([box('确认邮箱'), box('电子邮箱')], p);
  check('单字段组两个框都填同一值', ms.length === 2 && ms.every((m) => m.field.value === 'a@x.com'), JSON.stringify(ms.map((m) => [m.box.label, m.field.value])));
}

// 15. 上下文标签优先：紧急联系人姓名不会错配到姓名（labelParts 两段各自参评，取更高分）
{
  console.log('[上下文标签优先]');
  const p = { modules: [{ id: 'm', name: 'x', tier: '常用', entries: [{ id: 'e', title: 't', fields: [field('a', '姓名', '徐笑晗'), field('b', '紧急联系人', '张三')] }] }] };
  const ms = matchBoxes([box('紧急联系人姓名｜emergencyName'), box('姓名')], p);
  const byBox = Object.fromEntries(ms.map((m) => [m.box.label, m.field.label]));
  check('紧急联系人姓名 → 紧急联系人字段', byBox['紧急联系人姓名｜emergencyName'] === '紧急联系人', JSON.stringify(byBox));
  check('姓名 → 姓名字段', byBox['姓名'] === '姓名', JSON.stringify(byBox));
}

// 16. 日期分框连排布局（年年月月）与方向词（开始年份/结束年份）
{
  console.log('[连排布局与方向词]');
  const profile = {
    modules: [{ id: 'm', name: '实习', tier: '常用', entries: [{ id: 'e1', title: 't', fields: [field('j1', '单位名称', '美团'), field('j2', '起止时间', '2023.06 – 2024.03')] }] }],
  };
  const boxes1 = [box('单位名称'), box('年'), box('年'), box('月'), box('月')];
  const dates1 = matchDateComponents(boxes1, matchBoxes(boxes1, profile), profile);
  check('连排布局按 开始,开始,结束,结束 对应', dates1.map((d) => d.value).join(',') === '2023,2024,06,03', JSON.stringify(dates1.map((d) => d.value)));
  const boxes2 = [box('单位名称'), box('开始年份'), box('结束年份')];
  const dates2 = matchDateComponents(boxes2, matchBoxes(boxes2, profile), profile);
  check('方向词直接定轮', dates2.map((d) => d.value).join(',') === '2023,2024', JSON.stringify(dates2.map((d) => d.value)));
}

// 17. 两段经历锚点切换：第二组日期分框对应第二段记录的起止时间
{
  console.log('[多段经历锚点切换]');
  const profile = {
    modules: [{
      id: 'm', name: '教育', tier: '常用',
      entries: [
        { id: 'e1', title: '本科', fields: [field('s1', '学校', '甲大学'), field('s2', '起止时间', '2020.09 – 2024.06')] },
        { id: 'e2', title: '硕士', fields: [field('s3', '学校', '乙大学'), field('s4', '起止时间', '2024.09 – 2027.06')] },
      ],
    }],
  };
  const boxes = [box('学校'), box('年'), box('月'), box('年'), box('月'), box('学校'), box('年'), box('月'), box('年'), box('月')];
  const dates = matchDateComponents(boxes, matchBoxes(boxes, profile), profile);
  check('8 个日期框全部给出建议', dates.length === 8, JSON.stringify(dates.map((d) => d.value)));
  check('第一段 2020/09/2024/06', dates.slice(0, 4).map((d) => d.value).join(',') === '2020,09,2024,06', JSON.stringify(dates.map((d) => d.value)));
  check('第二段切锚 2024/09/2027/06', dates.slice(4).map((d) => d.value).join(',') === '2024,09,2027,06', JSON.stringify(dates.map((d) => d.value)));
}

// 18. 「至今」结束侧：结束框不产生自动建议（避免把「今」字填进日期框）
{
  console.log('[至今结束侧]');
  const profile = {
    modules: [{ id: 'm', name: '实习', tier: '常用', entries: [{ id: 'e1', title: 't', fields: [field('j1', '单位名称', '美团'), field('j2', '起止时间', '2023.06-至今')] }] }],
  };
  const boxes = [box('单位名称'), box('年'), box('月'), box('年')];
  const dates = matchDateComponents(boxes, matchBoxes(boxes, profile), profile);
  check('只有开始侧 2 个建议，结束年框留空', dates.length === 2 && dates[0].value === '2023' && dates[1].value === '06', JSON.stringify(dates.map((d) => d.value)));
}

// 19. 拆分后的技能字段匹配：技能名称/掌握程度/技能详情 各自独立命中，且不误配到「技能类别」类框
{
  console.log('[拆分技能字段匹配]');
  const p = {
    modules: [{
      id: 'm', name: '技能', tier: '常用',
      entries: [{ id: 'e', title: '技能清单', fields: [field('k1', '技能名称', 'SQL'), field('k2', '掌握程度', '熟练'), field('k3', '技能详情', '日常开发与评测分析')] }],
    }],
  };
  const ms = matchBoxes([box('技能名称'), box('熟练程度'), box('技能类别')], p);
  const byBox = Object.fromEntries(ms.map((m) => [m.box.label, m.field.label]));
  check('技能名称框 → 技能名称字段', byBox['技能名称'] === '技能名称', JSON.stringify(byBox));
  check('熟练程度框 → 掌握程度字段（同义词）', byBox['熟练程度'] === '掌握程度', JSON.stringify(byBox));
  check('技能类别框不误配（「技能」「详情」是泛义词头）', byBox['技能类别'] === undefined, JSON.stringify(byBox));
}

// 20. picker 严格模式：开启 opts.pickers 后精确/同义词命中才点选，模糊宁可不点
{
  console.log('[picker 严格模式]');
  const p = {
    modules: [{
      id: 'm', name: '技能', tier: '常用',
      entries: [{ id: 'e', title: '技能清单', fields: [field('p1', '掌握程度', '熟练'), field('p2', '期望城市', '北京')] }],
    }],
  };
  // 精确命中：开启 pickers 后参与匹配
  const exact = matchBoxes([box('掌握程度', { picker: true })], p, { pickers: true });
  check('开启 pickers：精确命中的 picker 框参与匹配', exact.length === 1 && exact[0].field.value === '熟练', JSON.stringify(exact));
  // 模糊不命中：'期望城市意向' 与 期望城市 是包含关系（1.5 分），严格模式下必须跳过
  const fuzzy = matchBoxes([box('期望城市意向', { picker: true })], p, { pickers: true });
  check('开启 pickers：模糊命中的 picker 框仍不点（宁可不填）', fuzzy.length === 0, JSON.stringify(fuzzy));
  // 默认关闭：不传 opts 时 picker 桓一律不参与
  const off = matchBoxes([box('掌握程度', { picker: true })], p);
  check('默认不开启 pickers：picker 框不参与匹配', off.length === 0, JSON.stringify(off));
  // 同义词命中：'熟练程度' → 掌握程度（2.5 分）允许点选
  const syn = matchBoxes([box('熟练程度', { picker: true })], p, { pickers: true });
  check('开启 pickers：同义词命中的 picker 框参与匹配', syn.length === 1 && syn[0].field.label === '掌握程度', JSON.stringify(syn));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
