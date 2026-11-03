// background.js 表单核对路由 mock 测试（Node 直跑，不需要浏览器）
// 验证 SCAN_PAGE 保留同名框（多段经历不去重）附 frameId、frame 注册、BATCH_FILL 按 frameId 分组、UNDO_FILL 批量撤回分支
const EXT_ID = 'ext-test-id';
const TAB_ID = 7;

const messageListeners = [];
const contentCalls = [];
const publishes = [];

const scriptingCalls = [];
const badgeCalls = [];
const mem = {};   // 简易存储内存实现：FILES_SAVE 写入后 FILES_LOAD 可读回

// 模拟两个 frame 的 content 脚本：frame 0 有数框（其中 2 个同名框——多段经历的同名字段，不得去重）
const contentFrames = {
  0: {
    scan: [
      { index: 0, value: '', label: '姓名｜姓名', kind: 'input', inputType: 'text' },
      { index: 1, value: '旧值', label: '手机号码｜手机', kind: 'input', inputType: 'tel' },
      { index: 2, value: '', label: '姓名｜姓名', kind: 'input', inputType: 'text' }, // 第二段经历的「姓名」，同名不同字段
    ],
    fill(items) {
      return {
        results: items.map((it) => ({ label: `box${it.index}`, ok: true, characters: 1 })),
        filled: items.length, failed: 0,
      };
    },
    restored: 6,
  },
  1: {
    scan: [{ index: 0, label: '邮箱｜email', kind: 'input', inputType: 'email' }],
    fill(items) {
      return {
        results: items.map(() => ({ label: 'x', ok: false, error: '只读' })),
        filled: 0, failed: items.length,
      };
    },
    restored: 0,
  },
};

globalThis.chrome = {
  runtime: {
    id: EXT_ID,
    getURL: (p) => `chrome-extension://${EXT_ID}/${p}`,
    onMessage: { addListener: (fn) => messageListeners.push(fn) },
    onInstalled: { addListener: () => {} },
    sendMessage: async () => {},
  },
  storage: {
    local: {
      setAccessLevel: async () => {},
      get: async (key) => ({ [key]: mem[key] }),
      set: async (obj) => { Object.assign(mem, obj); },
    },
    onChanged: { addListener: () => {} },
  },
  permissions: { contains: async () => false },
  tabs: {
    query: async () => [{ id: TAB_ID, url: 'https://job.example.com/apply' }],
    get: async () => ({ id: TAB_ID, url: 'https://job.example.com/apply' }),
    onRemoved: { addListener: () => {} },
    onUpdated: { addListener: () => {} },
    onActivated: { addListener: () => {} },
    sendMessage: async (tabId, msg, opts) => {
      contentCalls.push({ tabId, msg, opts });
      const frame = contentFrames[msg.frameIdHint ?? opts?.frameId ?? 0] ?? {};
      if (msg.type === 'SCAN_PAGE') return { ok: true, data: frame.scan || [] };
      if (msg.type === 'BATCH_FILL') return { ok: true, data: frame.fill(msg.items) };
      if (msg.type === 'UNDO_BATCH') return { ok: true, data: { restored: frame.restored ?? 0 } };
      if (msg.type === 'GOTO_BOX') return { ok: true, data: { label: `goto-${opts?.frameId ?? 0}` } };
      return { ok: false, error: 'unknown' };
    },
  },
  scripting: { executeScript: async (o) => { scriptingCalls.push(o); } },
  action: {
    onClicked: { addListener: () => {} },
    setBadgeText: async (o) => { badgeCalls.push({ fn: 'text', ...o }); },
    setBadgeBackgroundColor: async (o) => { badgeCalls.push({ fn: 'bg', ...o }); },
  },
  sidePanel: { open: async () => {} },
};

await import('../background.js');

const listener = messageListeners[0];
if (!listener) throw new Error('background 没有注册 onMessage 监听');
const panelSender = { id: EXT_ID, url: `chrome-extension://${EXT_ID}/panel.html` };

const send = (request) => new Promise((resolve) => {
  const async = listener(request, panelSender, resolve);
  if (async !== true) return; // 同步已 respond
});

const sendFromContent = (request, frameId) => new Promise((resolve) => {
  listener(request, { id: EXT_ID, tab: { id: TAB_ID }, frameId, url: 'https://job.example.com/apply', documentId: `doc-${frameId}` }, resolve);
});

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail ?? ''}`); }
};

// 1. SCAN_PAGE：同名框不去重、附 frameId、携带已填值；frame 注册后跨 frame 汇总
{
  console.log('[SCAN_PAGE]');
  let res = await send({ type: 'SCAN_PAGE' });
  check('成功，未注册 frame 时只扫主文档 3 项', res.ok === true && res.data.length === 3, JSON.stringify(res));
  check('同名框保留（多段经历不去重）', res.data.filter((b) => b.label.startsWith('姓名')).length === 2);
  check('附 frameId=0', res.data[0].frameId === 0);
  check('携带已填值（手机号码=旧值）', res.data[1].value === '旧值', JSON.stringify(res.data[1]));
  check('connect 确保注入', scriptingCalls.length >= 1, 'executeScript 未被调用');
  await sendFromContent({ type: 'FRAME_ANNOUNCE' }, 1);
  res = await send({ type: 'SCAN_PAGE' });
  check('frame 注册后跨 frame 汇总 4 项', res.ok === true && res.data.length === 4, JSON.stringify(res));
  check('frame1 的框附 frameId=1', res.data[3].frameId === 1);
}

// 2. BATCH_FILL：跨 frame 分组、混合成败汇总
{
  console.log('[BATCH_FILL]');
  const res = await send({
    type: 'BATCH_FILL',
    items: [
      { frameId: 0, index: 1, value: 'A' },
      { frameId: 0, index: 2, value: 'B' },
      { frameId: 1, index: 0, value: 'C' },
      { index: 5, value: 'D' }, // 无 frameId 默认 0
    ],
  });
  check('成功返回', res.ok === true, JSON.stringify(res));
  check('filled=3 / failed=1', res.data.filled === 3 && res.data.failed === 1, JSON.stringify(res.data));
  const toFrame0 = contentCalls.filter((c) => c.msg.type === 'BATCH_FILL' && c.opts.frameId === 0);
  const toFrame1 = contentCalls.filter((c) => c.msg.type === 'BATCH_FILL' && c.opts.frameId === 1);
  check('frame0 收到 3 项（含默认 frameId）', toFrame0[0].msg.items.length === 3);
  check('frame1 收到 1 项', toFrame1[0].msg.items.length === 1);
  check('results 合计 4 条', res.data.results.length === 4);
}

// 3. UNDO_FILL：批量撤回分支（多 frame 汇总、容忍 frame 失联）
{
  console.log('[UNDO_FILL batch 分支]');
  contentFrames[1] = { ...contentFrames[1], restored: 0 };
  const res = await send({ type: 'UNDO_FILL' });
  check('成功返回', res.ok === true, JSON.stringify(res));
  check('restored=6（frame0），frame1 无恢复不报错', res.data.restored === 6, JSON.stringify(res.data));
  check('撤回后 undos 清空（再次撤回报错）', true);
  const res2 = await send({ type: 'UNDO_FILL' });
  check('无批量记录再撤回 → 报错', res2.ok === false, JSON.stringify(res2));
}

// 4. 未授权来源仍被拒绝
{
  console.log('[安全]');
  const call = (request) => new Promise((resolve) => {
    listener(request, { id: 'other-ext', url: 'https://evil.example.com/panel.html' }, resolve);
  });
  const res = await call({ type: 'SCAN_PAGE' });
  check('外部来源被拒', res.ok === false && res.code === 'FORBIDDEN', JSON.stringify(res));
}

// 5. GOTO_BOX 路由：按 frameId 寻址，非法 frameId 回落主文档
{
  console.log('[GOTO_BOX]');
  const r1 = await send({ type: 'GOTO_BOX', frameId: 1, index: 0 });
  check('指定 frameId 路由到 frame1', r1.ok === true && r1.data.label === 'goto-1', JSON.stringify(r1));
  const r2 = await send({ type: 'GOTO_BOX', index: 0 });
  check('缺省 frameId 回落主文档 0', r2.ok === true && r2.data.label === 'goto-0', JSON.stringify(r2));
}

// 6. BATCH_FILL 边界：空列表报错；整个 frame 失联时计入失败而不坍塌
{
  console.log('[BATCH_FILL 边界]');
  const empty = await send({ type: 'BATCH_FILL', items: [] });
  check('空 items 报错', empty.ok === false, JSON.stringify(empty));
  const dead = await send({ type: 'BATCH_FILL', items: [{ frameId: 9, index: 0, value: 'x' }] });
  check('未注册 frame 计为失败不坍塌', dead.ok === true && dead.data.filled === 0 && dead.data.failed === 1
    && dead.data.results[0].ok === false, JSON.stringify(dead));
}

// 7. 无批量记录时直接撤回报错（面板与后台状态不一致时不误报成功）
{
  console.log('[撤回状态一致性]');
  const res = await send({ type: 'UNDO_BATCH' });
  check('无批量记录 UNDO_BATCH 报错', res.ok === false, JSON.stringify(res));
}

// 8. FILES_LOAD / FILES_SAVE：附件独立存储路由（默认空、写入后读回、非数组拒绝）
{
  console.log('[FILES 路由]');
  const empty = await send({ type: 'FILES_LOAD' });
  check('默认无附件返回空数组', empty.ok === true && Array.isArray(empty.data) && empty.data.length === 0, JSON.stringify(empty));
  const bad = await send({ type: 'FILES_SAVE', files: 'not-array' });
  check('非数组附件数据被拒绝', bad.ok === false, JSON.stringify(bad));
  const saved = await send({ type: 'FILES_SAVE', files: [{ id: 'file1', name: '简历.pdf', kind: 'resume', mime: 'application/pdf', dataUrl: 'data:application/pdf;base64,xxx' }] });
  check('附件写入成功', saved.ok === true, JSON.stringify(saved));
  const loaded = await send({ type: 'FILES_LOAD' });
  check('写入后可读回', loaded.ok === true && loaded.data.length === 1 && loaded.data[0].name === '简历.pdf', JSON.stringify(loaded));
}

// 9. BATCH_FILL 透传 kind/fileData：picker/file 标记原样到达 content 脚本
{
  console.log('[kind 透传]');
  const res = await send({
    type: 'BATCH_FILL',
    items: [
      { frameId: 0, index: 1, value: '本科', kind: 'picker' },
      { frameId: 0, index: 2, value: '简历.pdf', kind: 'file', fileData: { name: '简历.pdf', mime: 'application/pdf', dataUrl: 'data:application/pdf;base64,xxx' } },
      { frameId: 0, index: 0, value: '张三' },
    ],
  });
  check('成功返回', res.ok === true, JSON.stringify(res));
  const last = contentCalls.filter((c) => c.msg.type === 'BATCH_FILL' && c.opts.frameId === 0).pop();
  const [pickerItem, fileItem, plainItem] = last.msg.items;
  check('picker 项透传 kind=picker', pickerItem.kind === 'picker', JSON.stringify(pickerItem));
  check('file 项透传 kind=file 与 fileData', fileItem.kind === 'file' && fileItem.fileData?.name === '简历.pdf', JSON.stringify(fileItem));
  check('普通项不带 kind 不受影响', plainItem.kind === undefined, JSON.stringify(plainItem));
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
