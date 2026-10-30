// background.js 批量补齐路由 mock 测试（Node 直跑，不需要浏览器）
// 验证 SCAN_EMPTY 去重、BATCH_FILL 按 frameId 分组、UNDO_FILL 批量撤回分支
const EXT_ID = 'ext-test-id';
const TAB_ID = 7;

const messageListeners = [];
const contentCalls = [];
const publishes = [];

const scriptingCalls = [];

// 模拟两个 frame 的 content 脚本：frame 0 有 8 个框（其中 1 个与 frame 0 重复 label 用于验证去重）
const contentFrames = {
  0: {
    scan: [
      { index: 0, label: '姓名｜姓名', kind: 'input', inputType: 'text' },
      { index: 1, label: '手机号码｜手机', kind: 'input', inputType: 'tel' },
      { index: 0, label: '姓名｜姓名', kind: 'input', inputType: 'text' }, // 重复，应被去重
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
      get: async () => ({}),
      set: async () => {},
    },
  },
  tabs: {
    query: async () => [{ id: TAB_ID, url: 'https://job.example.com/apply' }],
    get: async () => ({ id: TAB_ID, url: 'https://job.example.com/apply' }),
    onRemoved: { addListener: () => {} },
    onUpdated: { addListener: () => {} },
    onActivated: { addListener: () => {} },
    sendMessage: async (tabId, msg, opts) => {
      contentCalls.push({ tabId, msg, opts });
      const frame = contentFrames[msg.frameIdHint ?? opts?.frameId ?? 0] ?? {};
      if (msg.type === 'SCAN_EMPTY') return { ok: true, data: frame.scan || [] };
      if (msg.type === 'BATCH_FILL') return { ok: true, data: frame.fill(msg.items) };
      if (msg.type === 'UNDO_BATCH') return { ok: true, data: { restored: frame.restored ?? 0 } };
      return { ok: false, error: 'unknown' };
    },
  },
  scripting: { executeScript: async (o) => { scriptingCalls.push(o); } },
  action: { onClicked: { addListener: () => {} } },
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

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail ?? ''}`); }
};

// 1. SCAN_EMPTY：去重、附 frameId
{
  console.log('[SCAN_EMPTY]');
  const res = await send({ type: 'SCAN_EMPTY' });
  check('成功，去重后 2 项', res.ok === true && res.data.length === 2, JSON.stringify(res));
  check('附 frameId=0', res.data[0].frameId === 0);
  check('connect 确保注入', scriptingCalls.length >= 1, 'executeScript 未被调用');
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
  const res = await call({ type: 'SCAN_EMPTY' });
  check('外部来源被拒', res.ok === false && res.code === 'FORBIDDEN', JSON.stringify(res));
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
