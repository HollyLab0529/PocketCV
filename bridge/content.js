// 口袋简历 PocketCV · 网页桥接脚本（通过 chrome.scripting 注入招聘网页，隔离世界运行）
// 职责：跟踪用户在网页里点选的输入框；接收指令把资料写入该输入框；支持撤回。
(() => {
  // 版本戳守卫：扩展重载/更新后，旧脚本的 chrome.runtime 通道已失效（FOCUS 上报静默失败、
  // 写入指令无人接收），必须允许新版本脚本重新初始化接管页面；同版本重复注入仍跳过。
  let VER = '';
  try { VER = chrome.runtime.getManifest().version; } catch { /* 非扩展环境（本地测试页） */ }
  if (window.__pocketcvBridge === VER) return;
  window.__pocketcvBridge = VER;
  const bridge = {};

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

  // 自定义下拉（点击弹出选项面板的仿输入框）：写入文本只是改显示，网站不会记录；需要模拟点击选项
  const isPickerEl = (el) => el instanceof HTMLInputElement
    && (/^(请)?(点击|点此)?选择/.test(el.getAttribute('placeholder') || '')
      || (el.readOnly && /选择/.test(el.getAttribute('placeholder') || el.getAttribute('title') || '')));

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
    if (el && (editable(el) || isPickerEl(el))) current = { el, token: token() };
    else current = null;
    report();
  };

  document.addEventListener('focusin', (e) => pick(e.composedPath()[0]), true);
  document.addEventListener('pointerdown', (e) => pick(e.composedPath()[0]), true);
  window.addEventListener('blur', () => queueMicrotask(() => {
    if (document.activeElement?.tagName === 'IFRAME') { current = null; report(); }
  }), true);
  if (editable(rootEditable(activeEl()))) pick(activeEl());
  // 向后台上报本 frame 已注入，供整页扫描时逐 frame 寻址（iframe 内的表单也能扫到）
  try { chrome.runtime.sendMessage({ type: 'FRAME_ANNOUNCE' }).catch(() => {}); } catch { /* 扩展已重载等场景 */ }

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
    if (!editable(el) && !isPickerEl(el) || rootEditable(activeEl()) !== el && !isPickerEl(el)) throw new Error('输入框已失效或焦点已移开，请重新点选。');
    let result;
    if (isPickerEl(el)) {
      const r = await pickFill(el, content);
      undoState = { el, before: r.before, after: r.after, picker: true };
      return { label: r.label, characters: r.characters };
    }
    result = await writeEl(el, content);
    undoState = { el, before: result.before, nodes: result.nodes, selection: result.selection, after: result.after };
    return { label: result.label, characters: result.characters };
  }

  // ===== 一键处理本页表单：扫描全部输入框 → 按索引批量写入 → 批量撤回 =====
  let scanList = [];       // 扫描到的输入框（本次文档生命周期内有效）
  let batchUndo = null;    // [{ index, label, before, nodes, after }]（按扫描序号定位，抗网页重渲染）

  const deepInputs = (root, out) => {
    for (const el of root.querySelectorAll('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]')) {
      // 文件上传框不走 editable（不可文本写入），单独收进扫描清单走附件上传通道
      if (editable(el) || (el instanceof HTMLInputElement && el.type === 'file' && !el.disabled)) out.push(el);
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

  function scanPage() {
    const all = [];
    deepInputs(document, all);
    scanList = all.filter((el) => {
      if (el instanceof HTMLInputElement && el.type === 'file') return true;   // 附件/照片上传框，走专用上传通道
      if (el instanceof HTMLInputElement && ['password', 'checkbox', 'radio', 'search'].includes(el.type)) return false;
      // 页头/导航里的输入框（全站搜索框等）不是表单字段，匹配上去只会误导
      if (el.closest('nav, header, [role="banner"], [role="search"]')) return false;
      if (el instanceof HTMLSelectElement) return el.options.length > 1;   // 只有一个 option 的 select 通常是占位
      return true;
    });
    return scanList.slice(0, 120).map((el, index) => {
      if (el instanceof HTMLInputElement && el.type === 'file') {
        return {
          index,
          value: el.files.length ? Array.from(el.files).map((f) => f.name).join(', ') : '',
          picker: false,
          label: nearbyText(el) ? nearbyText(el) + '｜' + labelOf(el) : labelOf(el),
          kind: 'file',
          inputType: 'file',
        };
      }
      let value = '';
      if (el instanceof HTMLSelectElement) {
        const opt = el.options[el.selectedIndex < 0 ? 0 : el.selectedIndex];
        value = (el.value && opt) ? (opt.textContent || opt.value).trim() : '';   // 未选或选了空 value 视为未填
      } else {
        value = nativeValue(el).trim();
      }
      return {
        index,
        value,
        picker: isPickerEl(el),
        label: nearbyText(el) ? nearbyText(el) + '｜' + labelOf(el) : labelOf(el),
        kind: el.tagName.toLowerCase(),
        inputType: el.type || 'text',
      };
    });
  }

  // ===== 自定义下拉自动点选：模拟真实点击展开面板 → 在弹层里找文本匹配的选项点下去 =====
  const closeMenus = () => {
    for (const target of [document, document.body]) {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    }
  };
  const visible = (el) => {
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden'
      && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  };
  const normText = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

  async function pickFill(el, content) {
    const want = String(content || '').trim();
    if (!want) throw new Error('空内容不会写入。');
    if (!(el instanceof HTMLElement) || !el.isConnected) throw new Error('输入框已失效。');
    const target = normText(want);
    const before = el instanceof HTMLInputElement ? el.value : '';
    // 展开面板：模拟完整点击序列（React/Vue 组件普遍监听 mousedown/click）
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window }));
    }
    await new Promise((r) => setTimeout(r, 450));
    // 收集可见、叶子、文本精确相等的候选；选项弹层通常挂在 body 末尾，全文档找
    const candidates = [];
    const walk = (root) => {
      for (const node of root.querySelectorAll('*')) {
        if (node.shadowRoot) walk(node.shadowRoot);
        if (node === el || node.contains(el) || el.contains(node)) continue;
        if (!visible(node)) continue;
        const text = (node.innerText || node.textContent || '').trim().replace(/\s+/g, ' ');
        if (!text || text.length > 60 || normText(text) !== target) continue;
        candidates.push(node);
      }
    };
    walk(document);
    if (!candidates.length) { closeMenus(); throw new Error('下拉面板里没有找到「' + want + '」这个选项，请手动选择。'); }
    // 嵌套的同一选项（span 在 li 里）算一个；剩下的独立候选项多于一个视为歧义，宁可不填
    const options = candidates.filter((c) => !candidates.some((other) => other !== c && c.contains(other)));
    const unique = options.filter((c, i) => options.findIndex((o) => o.tagName === c.tagName && o.textContent.trim() === c.textContent.trim()) === i);
    if (unique.length > 1) { closeMenus(); throw new Error('下拉面板匹配到多个「' + want + '」选项，无法确定，请手动选择。'); }
    unique[0].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, composed: true, view: window }));
    unique[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true, view: window }));
    unique[0].dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true, composed: true, view: window }));
    unique[0].dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, composed: true, view: window }));
    unique[0].click();
    await new Promise((r) => setTimeout(r, 450));
    // 验证：选中值应回填到输入框；验证不过按失败处理，避免假成功
    const after = el instanceof HTMLInputElement ? el.value : '';
    if (!normText(after).includes(target)) {
      closeMenus();
      throw new Error('已尝试点选「' + want + '」，但网页没有回填选中值，请手动确认该下拉框。');
    }
    return { before, after, label: labelOf(el), characters: want.length };
  }

  // ===== 附件上传：把资料库里存的文件（简历/照片）写进 input[type=file] =====
  async function fillFile(el, fileData) {
    if (!(el instanceof HTMLInputElement) || el.type !== 'file') throw new Error('目标不是文件上传框。');
    if (el.disabled) throw new Error('上传框已禁用。');
    if (!fileData || typeof fileData.dataUrl !== 'string' || !fileData.dataUrl.startsWith('data:')) throw new Error('文件数据无效。');
    const res = await fetch(fileData.dataUrl);
    const buf = await res.arrayBuffer();
    const file = new File([buf], String(fileData.name || 'file').slice(0, 200), { type: String(fileData.type || 'application/octet-stream').slice(0, 120) });
    const dt = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    if (!el.files?.length) throw new Error('网页没有接受文件，请手动上传。');
    return { label: labelOf(el), characters: file.name.length };
  }

  async function batchFill(items) {
    if (!Array.isArray(items) || !items.length) throw new Error('没有要填写的项。');
    const undoEntries = [];
    const results = [];
    for (const item of items) {
      const el = scanList[Number(item.index)];
      if (!el) { results.push({ label: '已失效的输入框', ok: false, error: '页面已变化，请重新扫描。' }); continue; }
      try {
        let r;
        if (item.kind === 'file') {
          r = await fillFile(el, item.fileData);
        } else if (item.kind === 'picker' || (item.kind !== 'file' && isPickerEl(el))) {
          r = await pickFill(el, String(item.value || ''));
          undoEntries.push({ index: Number(item.index), label: r.label, before: r.before, after: r.after, picker: true });
          results.push({ label: r.label, ok: true, characters: r.characters });
          continue;
        } else {
          r = await writeEl(el, String(item.value || ''));
        }
        undoEntries.push({ index: Number(item.index), label: r.label, before: r.before, nodes: r.nodes, after: r.after });
        results.push({ label: r.label, ok: true, characters: r.characters });
      } catch (e) {
        results.push({ label: labelOf(el), ok: false, error: e.message || '写入失败。' });
      }
    }
    if (undoEntries.length) batchUndo = undoEntries;
    const filled = results.filter((r) => r.ok).length;
    return { results, filled, failed: results.length - filled };
  }

  function undoBatch() {
    if (!batchUndo) throw new Error('当前页面没有批量填入记录。');
    const total = batchUndo.length;
    let restored = 0, skipped = 0;
    scanPage();   // 网站可能重渲染了输入框（React 类常见），按扫描序号重新定位，不能复用旧元素
    for (const u of batchUndo) {
      const el = scanList[u.index];
      if (u.picker) {
        // 自定义下拉撤回是尽力而为：恢复输入框文本并通知网站，状态是否回退取决于网站实现
        if (!el || !el.isConnected || nativeValue(el).trim() !== String(u.after).trim()) { skipped += 1; continue; }
        assignValue(el, u.before);
        fire(el, 'historyUndo');
        restored += 1;
        continue;
      }
      if (!el || !editable(el) || nativeValue(el).trim() !== String(u.after).trim()) { skipped += 1; continue; }   // 已被网站保留/手动改过的不碰
      if (u.nodes) el.replaceChildren(...u.nodes); else assignValue(el, u.before);
      fire(el, 'historyUndo');
      restored += 1;
    }
    batchUndo = null;
    return { restored, skipped, total };
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

  // 在网页上高亮定位某个扫描到的框（未识别空框列表点击跳转用）
  function gotoBox(index) {
    const el = scanList[Number(index)];
    if (!el) throw new Error('页面已变化，请重新扫描。');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
    const old = el.style.cssText;
    el.style.cssText += `;outline:2px solid #3a7d5c !important;outline-offset:2px;transition:outline-color .8s;`;
    setTimeout(() => { el.style.cssText = old; }, 1600);
    return { label: labelOf(el) };
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
    if (msg.type === 'SCAN_PAGE') {
      try { respond({ ok: true, data: scanPage() }); } catch (e) { respond({ ok: false, error: e.message || '扫描失败。' }); }
      return false;
    }
    if (msg.type === 'GOTO_BOX') {
      try { respond({ ok: true, data: gotoBox(msg.index) }); } catch (e) { respond({ ok: false, error: e.message || '定位失败。' }); }
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
