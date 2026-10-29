// 口袋简历 PocketCV · 通用 UI 工具（自有实现）
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === 'text') node.textContent = String(value);
    else if (key === 'class') node.className = value;
    else if (key === 'on') for (const [event, handler] of Object.entries(value)) node.addEventListener(event, handler);
    else if (['checked', 'disabled', 'hidden', 'value'].includes(key)) node[key] = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const ICON_PATHS = {
  menu: 'M3 6h18M3 12h18M3 18h18',
  close: 'm6 6 12 12M6 18 18 6',
  edit: 'm16 3 5 5-12 12-6 1 1-6L16 3ZM13 6l5 5',
  trash: 'M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15',
  plus: 'M12 5v14M5 12h14',
  download: 'M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5',
  lock: 'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4',
  spark: 'M12 3l1.9 5.3 5.3 1.9-5.3 1.9L12 17.2l-1.9-5.3L4.8 10l5.3-1.9L12 3Zm7 12 .9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9L19 15Z',
  history: 'M3 3v6h6M3 9a9 9 0 1 1-1 7M12 7v5l3 2',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Zm10 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  undo: 'M4 9h9a5 5 0 0 1 0 10h-3M4 9l4-4M4 9l4 4',
  target: 'M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm0-4.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM12 2v3M12 19v3M2 12h3M19 12h3',
};
export function icon(name, size = 15) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, String(v));
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', ICON_PATHS[name] || ICON_PATHS.menu);
  svg.append(path);
  return svg;
}

export function button(label, handler, { kind = '', symbol = '', disabled = false, title = '' } = {}) {
  const iconOnly = kind.includes('icon-only');
  const name = title || label;
  return h('button', { type: 'button', class: `btn ${kind}`.trim(), disabled, title: name, 'aria-label': iconOnly ? name : null, on: { click: handler } },
    symbol ? icon(symbol) : null, iconOnly ? null : h('span', { text: label }));
}

export function inputLabel(label, input, hint = '') {
  return h('label', { class: 'control' },
    h('span', { class: 'control-label', text: label }), input,
    hint ? h('span', { class: 'hint', text: hint }) : null);
}

export function saveFile(name, content, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function modal(title, build, { wide = false } = {}) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const dialog = h('dialog', { class: wide ? 'modal' : 'modal', 'aria-label': title });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dialog.close(); dialog.remove();
      if (previous?.isConnected) previous.focus();
      resolve(value);
    };
    const body = h('div', { class: 'modal-body' });
    const foot = h('div', { class: 'modal-foot' });
    dialog.append(
      h('header', { class: 'modal-head' }, h('h2', { text: title }), button('关闭', () => finish(null), { kind: 'quiet' })),
      body, foot,
    );
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    build({ body, foot, finish });
    document.body.append(dialog);
    dialog.showModal();
  });
}

export async function confirmAction(title, text, action = '确认', { danger = false } = {}) {
  return modal(title, ({ body, foot, finish }) => {
    body.append(h('p', { class: 'modal-description', text }));
    foot.append(button('取消', () => finish(false), { kind: 'quiet' }), button(action, () => finish(true), { kind: danger ? 'danger' : 'primary' }));
  });
}
