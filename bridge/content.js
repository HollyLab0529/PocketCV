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

  async function write(tokenValue, content) {
    if (!current || current.token !== tokenValue) throw new Error('目标输入框已变化，请在网页重新点选。');
    const el = current.el;
    if (!editable(el) || rootEditable(activeEl()) !== el) throw new Error('输入框已失效或焦点已移开，请重新点选。');
    if (typeof content !== 'string' || !content.length) throw new Error('空内容不会写入，避免清空网页已有内容。');
    if (content.length > 32767) throw new Error('内容超过 32767 字符，未写入。');
    let actual = content;
    if (el instanceof HTMLSelectElement) {
      const options = Array.from(el.options).filter((o) => !o.disabled && !o.hidden && !(o.parentElement?.disabled));
      const matches = options.filter((o) => o.value === content || o.textContent?.trim() === content);
      if (matches.length !== 1) throw new Error('下拉选项无法唯一匹配，请在网页手动选择。');
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
    await new Promise((r) => setTimeout(r, 160));
    if (!el.isConnected || nativeValue(el) !== actual) throw new Error('网页没有保留写入的内容（可能使用了定制编辑器），请核对页面。');
    undoState = { el, before, nodes, selection, after: actual };
    return { label: labelOf(el), characters: content.length };
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
    return false;
  });

  bridge.describe = () => {
    const el = current?.el;
    return el && editable(el)
      ? { token: current.token, label: labelOf(el), kind: el.tagName.toLowerCase(), inputType: el.type || 'text' }
      : null;
  };
})();
