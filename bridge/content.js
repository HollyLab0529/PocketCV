// 口袋简历 PocketCV · 网页桥接脚本（通过 chrome.scripting 注入招聘网页，隔离世界运行）
// 职责：跟踪用户在网页里点选的输入框；接收指令把资料写入该输入框；支持撤回。
(() => {
  if (window.__pocketcvBridge) return;
  const bridge = {};
  window.__pocketcvBridge = bridge;

  const FORBIDDEN = new Set(['password', 'file', 'hidden', 'checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'range', 'color']);
  const RICH = '.ProseMirror,.ql-editor,.ck-editor__editable,[data-lexical-editor],[data-slate-editor]';
  let current = null;   // { el, token }
  let undoState = null; // { el, before, nodes, selection, after }

  const token = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  const activeEl = () => { let a = document.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; return a; };

  const editable = (el) => {
    if (!(el instanceof HTMLElement) || !el.isConnected || el.closest('[inert]') || !el.getClientRects().length) return false;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || el.matches(':disabled') || el.getAttribute('aria-readonly') === 'true') return false;
    if (el instanceof HTMLInputElement) return !FORBIDDEN.has(el.type) && !el.disabled && !el.readOnly;
    if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
    if (el instanceof HTMLSelectElement) return !el.disabled && !el.multiple;
    return el.isContentEditable && !el.closest(RICH) && el.getAttribute('aria-readonly') !== 'true';
  };

  const rootEditable = (el) => {
    if (!(el instanceof HTMLElement)) return null;
    if (el.isContentEditable) while (el.parentElement?.isContentEditable) el = el.parentElement;
    return el;
  };

  const labelOf = (el) => {
    const parts = [];
    if (el.labels?.length) for (const l of el.labels) parts.push(l.textContent || '');
    if (el.getAttribute('aria-label')) parts.push(el.getAttribute('aria-label'));
    for (const id of (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)) parts.push(el.getRootNode().getElementById?.(id)?.textContent || '');
    if (el.getAttribute('placeholder')) parts.push(el.getAttribute('placeholder'));
    if (el.getAttribute('name')) parts.push(el.getAttribute('name'));
    return (parts.map((t) => t.trim()).filter(Boolean).join(' ') || '未命名输入框').slice(0, 120);
  };

  const report = () => {
    const msg = current
      ? { type: 'FOCUS', token: current.token, label: labelOf(current.el), kind: current.el.tagName.toLowerCase(), inputType: current.el.type || 'text' }
      : { type: 'FOCUS' };
    try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch { /* 扩展已重载等场景 */ }
  };

  const pick = (el) => {
    el = rootEditable(el);
    if (el && editable(el)) current = { el, token: token() };
    else current = null;
    report();
  };

  document.addEventListener('focusin', (e) => pick(e.composedPath()[0]), true);
  document.addEventListener('pointerdown', (e) => pick(e.composedPath()[0]), true);
  window.addEventListener('blur', () => queueMicrotask(() => {
    if (document.activeElement?.tagName === 'IFRAME') { current = null; report(); }
  }), true);
  if (editable(rootEditable(activeEl()))) pick(activeEl());

  const nativeValue = (el) => (el.isContentEditable ? el.innerText : el.value);
  const assignValue = (el, value) => {
    if (el.isContentEditable) { el.innerText = value; return; }
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (!setter) throw new Error('此控件不支持程序写入。');
    setter.call(el, value);
  };
  const fire = (el, inputType, data) => {
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType, data }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  // 核心写入（无焦点依赖）：单框填写与批量补齐共用；返回写入前后的快照信息。
  async function writeEl(el, content) {
    if (!editable(el)) throw new Error('输入框已失效。');
    if (typeof content !== 'string' || !content.length) throw new Error('空内容不会写入，避免清空网页已有内容。');
    if (content.length > 32767) throw new Error('内容超过 32767 字符，未写入。');
    let actual = content;
    if (el instanceof HTMLSelectElement) {
      const options = Array.from(el.options).filter((o) => !o.disabled && !o.hidden && !(o.parentElement?.disabled));
      const norm = (s) => String(s).replace(/\s+/g, '').toLowerCase();
      // 两级匹配：精确（value 或文本等值）可多个取第一个（同文本选项对用户无差异）；
      // 宽容（包含关系）必须唯一，否则歧义拒绝，避免猜错。
      const exact = options.filter((o) => o.value === content || norm(o.textContent || '') === norm(content));
      const loose = options.filter((o) => norm(o.textContent || '').includes(norm(content)) || norm(content).includes(norm(o.textContent || '')));
      const matches = exact.length ? exact : loose;
      if (!matches.length) throw new Error('下拉选项里没有匹配项，请手动选择。');
      if (matches.length > 1 && !exact.length) throw new Error('下拉选项匹配到多项，无法确定该填哪个，请手动选择。');
      actual = matches[0].value;
    } else if (el instanceof HTMLInputElement) {
      const probe = document.createElement('input');
      probe.type = el.type; probe.value = content;
      if (probe.value !== content) throw new Error('该输入框会改写内容格式（如日期、数字），已停止，请手动填写。');
    } else {
      actual = content.replace(/\r\n?/g, '\n');
    }
    if (el.maxLength >= 0 && content.length > el.maxLength) throw new Error(`内容 ${content.length} 字符，网页限制 ${el.maxLength}，未写入。`);
    const accepted = el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, composed: true, cancelable: true, inputType: 'insertReplacementText', data: content }));
    if (!accepted) throw new Error('网页拦截了自动填写，内容未修改。');
    const before = nativeValue(el);
    const nodes = el.isContentEditable ? Array.from(el.childNodes).map((n) => n.cloneNode(true)) : null;
    const selection = typeof el.selectionStart === 'number' ? { start: el.selectionStart, end: el.selectionEnd } : null;
    assignValue(el, actual);
    fire(el, 'insertReplacementText', content);
    await new Promise((r) => setTimeout(r, 140));
    if (!el.isConnected || nativeValue(el) !== actual) throw new Error('网页没有保留写入的内容（可能使用了定制编辑器），请核对页面。');
    return { before, nodes, selection, after: actual, label: labelOf(el), characters: content.length };
  }

  async function write(tokenValue, content) {
    if (!current || current.token !== tokenValue) throw new Error('目标输入框已变化，请在网页重新点选。');
    const el = current.el;
    if (!editable(el) || rootEditable(activeEl()) !== el) throw new Error('输入框已失效或焦点已移开，请重新点选。');
    const result = await writeEl(el, content);
    undoState = { el, before: result.before, nodes: result.nodes, selection: result.selection, after: result.after };
    return { label: result.label, characters: result.characters };
  }

  // ===== 批量补齐：扫描本页空输入框 → 按索引批量写入 → 批量撤回 =====
  let scanList = [];       // 扫描到的空框（本次文档生命周期内有效）
  let batchUndo = null;    // [{ el, before, nodes, after }]

  const deepInputs = (root, out) => {
    for (const el of root.querySelectorAll('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]')) {
      if (editable(el)) out.push(el);
    }
    for (const host of root.querySelectorAll('*')) {
      if (host.shadowRoot) deepInputs(host.shadowRoot, out);
    }
  };

  // 网申表单常见的「label 在左侧兄弟节点」布局：向上找两层取前兄弟文本
  const nearbyText = (el) => {
    let node = el;
    for (let up = 0; up < 3 && node; up++) {
      let sib = node.previousElementSibling;
      for (let k = 0; k < 3 && sib; k++) {
        const text = (sib.innerText || sib.textContent || '').trim().replace(/\s+/g, ' ');
        if (text && text.length <= 40 && !/^[*＊:：]+$/.test(text)) return text;
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    return '';
  };

  function scanEmpty() {
    const all = [];
    deepInputs(document, all);
    scanList = all.filter((el) => {
      if (el instanceof HTMLInputElement && el.type === 'file') return false;
      if (el instanceof HTMLSelectElement) {
        if (el.value) return false;
        return el.options.length > 1;   // 只有一个 option 的 select 通常是占位
      }
      return !nativeValue(el).trim();
    });
    return scanList.slice(0, 60).map((el, index) => ({
      index,
      label: nearbyText(el) ? nearbyText(el) + '｜' + labelOf(el) : labelOf(el),
      kind: el.tagName.toLowerCase(),
      inputType: el.type || 'text',
    }));
  }

  async function batchFill(items) {
    if (!Array.isArray(items) || !items.length) throw new Error('没有要填写的项。');
    const undoEntries = [];
    const results = [];
    for (const item of items) {
      const el = scanList[Number(item.index)];
      if (!el) { results.push({ label: '已失效的输入框', ok: false, error: '页面已变化，请重新扫描。' }); continue; }
      try {
        const r = await writeEl(el, String(item.value || ''));
        undoEntries.push({ el, before: r.before, nodes: r.nodes, after: r.after });
        results.push({ label: r.label, ok: true, characters: r.characters });
      } catch (e) {
        results.push({ label: labelOf(el), ok: false, error: e.message || '写入失败。' });
      }
    }
    if (undoEntries.length) batchUndo = undoEntries;
    return { results, filled: undoEntries.length, failed: results.length - undoEntries.length };
  }

  function undoBatch() {
    if (!batchUndo) throw new Error('当前页面没有批量填入记录。');
    let restored = 0;
    for (const u of batchUndo) {
      if (!editable(u.el) || nativeValue(u.el) !== u.after) continue;   // 用户已手动改过的不碰
      if (u.nodes) u.el.replaceChildren(...u.nodes); else assignValue(u.el, u.before);
      u.el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'historyUndo' }));
      restored += 1;
    }
    batchUndo = null;
    return { restored };
  }

  function undoWrite() {
    if (!undoState) throw new Error('当前页面没有可撤回的填写。');
    const u = undoState;
    if (!editable(u.el) || nativeValue(u.el) !== u.after) throw new Error('网页内容已变化，撤回可能覆盖你的修改，已停止。');
    if (u.nodes) u.el.replaceChildren(...u.nodes); else assignValue(u.el, u.before);
    u.el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'historyUndo' }));
    if (u.selection) try { u.el.setSelectionRange(u.selection.start, u.selection.end); } catch { /* 部分控件不支持 */ }
    undoState = null;
    return { label: labelOf(u.el) };
  }

  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== 'string') return false;
    if (msg.type === 'WRITE_FIELD') {
      write(String(msg.token || ''), typeof msg.value === 'string' ? msg.value : '')
        .then((data) => respond({ ok: true, data }), (e) => respond({ ok: false, error: e.message || '写入失败。' }));
      return true;
    }
    if (msg.type === 'UNDO_FIELD') {
      try { respond({ ok: true, data: undoWrite() }); } catch (e) { respond({ ok: false, error: e.message || '撤回失败。' }); }
      return false;
    }
    if (msg.type === 'SCAN_EMPTY') {
      try { respond({ ok: true, data: scanEmpty() }); } catch (e) { respond({ ok: false, error: e.message || '扫描失败。' }); }
      return false;
    }
    if (msg.type === 'BATCH_FILL') {
      batchFill(Array.isArray(msg.items) ? msg.items : [])
        .then((data) => respond({ ok: true, data }), (e) => respond({ ok: false, error: e.message || '批量填入失败。' }));
      return true;
    }
    if (msg.type === 'UNDO_BATCH') {
      try { respond({ ok: true, data: undoBatch() }); } catch (e) { respond({ ok: false, error: e.message || '批量撤回失败。' }); }
      return false;
    }
    return false;
  });

  bridge.describe = () => {
    const el = current?.el;
    return el && editable(el)
      ? { token: current.token, label: labelOf(el), kind: el.tagName.toLowerCase(), inputType: el.type || 'text' }
      : null;
  };
})();
