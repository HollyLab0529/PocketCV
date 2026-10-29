// 口袋简历 PocketCV · Excel 资料表（自研实现）
// 导出：每分类一个工作表，A 分组 / B 项目 / C 填写内容 + D:H 隐藏身份列 + 隐藏结构表。
// 导入：识别本产品格式；同时支持小师弟求职 v2 工作簿迁移（少用→备用层级映射）。

import { validateProfile, emptyProfile, uid, TYPES, TIERS, LIMITS } from '../domain/model.js';
import { packZip, unpackZip } from './zip.js';

export const WORKBOOK_FORMAT = 'PocketCV workbook 1';
const STRUCTURE_SHEET = '_PocketCV结构';
const HELP_SHEET = '填写帮助';
const HEADERS = ['分组', '项目', '填写内容', '__kind', '__entry', '__field', '__type', '__sensitive'];
const XIAOSHIDI = { structure: '_小师弟结构', format: 'Xiaoshidi workbook 2', help: '填写帮助', tiers: { 常用: '常用', 扩展: '扩展', 少用: '备用' } };

// ===== 工具 =====
const xmlEscape = (v) => String(v)
  .replace(/_x([0-9a-fA-F]{4})_/g, '_x005F_x$1_')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/\r/g, '&#13;');
const xmlUnescape = (s) => s.replace(/_x([0-9a-fA-F]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const colLetter = (i) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };

function sheetSafeName(name, used) {
  let base = name.replace(/[\\/\[\]*?:]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31);
  if (/[\uD800-\uDBFF]$/.test(base)) base = base.slice(0, -1); // 不留孤立代理对
  if (!base) base = '资料';
  let result = base, n = 2;
  while (used.has(result.toLowerCase())) {
    const suffix = ` (${n++})`;
    let cut = base.slice(0, 31 - suffix.length);
    if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
    result = cut + suffix;
  }
  used.add(result.toLowerCase());
  return result;
}

// ===== 导出 =====
export function exportProfileWorkbook(profile, { accent = '7d93a8', themeId = '' } = {}) {
  const p = validateProfile(profile);
  const color = accent.replace(/^#/, '').toUpperCase();
  const meta = [
    ['格式', WORKBOOK_FORMAT], ['资料ID', p.id], ['资料名称', p.name],
    ['版本', String(p.version)], ['修订', String(p.revision)], ['更新时间', p.updatedAt],
  ];
  if (themeId) meta.push(['主题', themeId]);

  const used = new Set([STRUCTURE_SHEET.toLowerCase(), HELP_SHEET.toLowerCase()]);
  const sheets = p.modules.map((m, index) => {
    const name = sheetSafeName(m.name, used);
    const id = String(index + 1);
    meta.push(['分类', id, name, m.id, m.name, m.tier]);
    const rows = [HEADERS];
    const merges = [];
    for (const e of m.entries) {
      rows.push([e.title, '', '', 'entry', e.id, '', '', '']);
      merges.push(`A${rows.length}:C${rows.length}`);
      for (const f of e.fields) rows.push([f.group, f.label, f.value, 'field', e.id, f.id, f.type, f.sensitive ? '是' : '否']);
    }
    return { id, name, rows, merges, kind: 'data' };
  });

  sheets.push({ id: String(sheets.length + 1), name: HELP_SHEET, kind: 'help', merges: [], rows: [
    ['口袋简历 · Excel 资料表', '在 Excel / WPS 中离线填写，导回口袋简历。'],
    ['用 AI 填写', '把这份文件和你的简历原文一起发给任意 AI 助手（DeepSeek、通义、ChatGPT 等），并说：「请把我的简历信息填入这份表格每个工作表的"填写内容"列，保持行、列与工作表结构完全不变，缺失的信息留空、不要编造」，AI 改好后保存 .xlsx，回到插件里点导入。'],
    ['结构就是格式', '插件不识别任意 Excel；只要保持本模板的表头、工作表与隐藏列结构，AI 或你自己填的内容都能导回。'],
    ['怎么填', '每个工作表是一类资料；「填写内容」列写你的信息；一条深色标题行是一段记录。'],
    ['加记录', '复制一整段（含深色标题行），修改标题与内容即可。'],
    ['加字段', '在记录里插入一整行，填「项目」与「填写内容」。'],
    ['改分类', '直接改底部工作表名；复制整个工作表即新增分类。'],
    ['别动隐藏列', 'D:H 列记住身份与类型，请整行复制或移动，不要只排序部分列。'],
    ['纯文本', '手机号、日期、证件号请保持文本格式，避免 Excel 改写前导零或日期。'],
    ['隐私', 'Excel 是明文文件，包含敏感字段，请只在本机保管，不要外发。'],
  ] });
  sheets.push({ id: String(sheets.length + 1), name: STRUCTURE_SHEET, kind: 'meta', hidden: true, merges: [], rows: meta });

  const files = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + sheets.map((s) => `<Override PartName="/xl/worksheets/sheet${s.id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>'
      + sheets.map((s) => `<sheet name="${xmlEscape(s.name)}" sheetId="${s.id}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${s.id}"/>`).join('') + '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map((s) => `<Relationship Id="rId${s.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.id}.xml"/>`).join('')
      + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': styleSheet(color),
  };
  for (const s of sheets) files[`xl/worksheets/sheet${s.id}.xml`] = worksheetXml(s, color);
  return packZip(files);
}

function styleSheet(color) {
  const xfs = [
    [0, 0, 0], // 0 帮助列等默认
    [1, 2, 0], // 1 表头：白字 + 强调色底
    [2, 3, 1], // 2 记录标题：粗体 + 浅底
    [0, 4, 1], // 3 内容列：文本换行
    [3, 0, 1], // 4 分组列：弱化
    [0, 0, 1], // 5 其他
  ];
  return '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="4"><font><sz val="11"/><color rgb="FF2A2E33"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><color rgb="FF2A2E33"/><name val="Microsoft YaHei"/></font><font><sz val="10"/><color rgb="FF6B7076"/><name val="Microsoft YaHei"/></font></fonts>'
    + `<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF${color}"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F3F5"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFAFAF8"/><bgColor indexed="64"/></patternFill></fill></fills>`
    + '<borders count="2"><border/><border><bottom style="hair"><color rgb="FFE3E4E8"/></bottom></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + `<cellXfs count="${xfs.length}">` + xfs.map(([font, fill, border]) =>
      `<xf numFmtId="49" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1" indent="1"/></xf>`).join('')
    + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
}

function worksheetXml(sheet, color) {
  const data = sheet.kind === 'data';
  const columns = data
    ? '<col min="1" max="1" width="14" customWidth="1"/><col min="2" max="2" width="24" customWidth="1"/><col min="3" max="3" width="64" style="3" customWidth="1"/><col min="4" max="8" width="16" hidden="1" customWidth="1"/>'
    : '<col min="1" max="1" width="24" customWidth="1"/><col min="2" max="2" width="84" customWidth="1"/>';
  const rows = sheet.rows.map((row, i) => {
    const isEntry = data && row[3] === 'entry';
    const textWidth = (t) => Math.ceil([...String(t)].reduce((v, ch) => v + (ch.charCodeAt(0) > 255 ? 2 : 1), 0) / 1);
    const lineCount = (t, unit) => String(t).split(/\r\n|\r|\n/).reduce((n, line) => n + Math.max(1, Math.ceil(textWidth(line) / unit)), 0);
    const heights = data
      ? Math.min(180, Math.max(30, (i === 0 ? 2 : isEntry ? lineCount(row[0], 100) : Math.max(lineCount(row[0], 13), lineCount(row[1], 23), lineCount(row[2], 58))) * 15 + 12))
      : Math.max(32, lineCount((row[0] || '') + (row[1] || ''), 62) * 15 + 12);
    const styleOf = (j) => (i === 0 ? 1 : isEntry && j < 3 ? 2 : data && j === 2 ? 3 : data && j === 0 ? 4 : 5);
    return `<row r="${i + 1}" ht="${heights}" customHeight="1">` + row.map((v, j) =>
      `<c r="${colLetter(j)}${i + 1}" t="inlineStr" s="${styleOf(j)}"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`).join('') + '</row>';
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + (data ? `<sheetPr><tabColor rgb="FF${color}"/></sheetPr>` : '')
    + `<dimension ref="A1:${data ? 'H' : 'B'}${Math.max(sheet.rows.length, 1)}"/>`
    + '<sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + `<sheetFormatPr defaultRowHeight="28"/><cols>${columns}</cols><sheetData>${rows}</sheetData>`
    + (sheet.merges.length ? `<mergeCells count="${sheet.merges.length}">` + sheet.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('') + '</mergeCells>' : '')
    + '<pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/></worksheet>';
}

// ===== 导入 =====
function parseXml(bytes, path) {
  if (!bytes) throw new Error(`工作簿缺少组件：${path}`);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error(`文件编码异常：${path}`); }
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('不支持带实体声明的 XML。');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error(`XML 内容损坏：${path}`);
  return doc;
}
const all = (parent, name) => Array.from(parent.getElementsByTagNameNS('*', name));

function readSheetRows(doc, shared, sheetName) {
  const rows = [];
  let cells = 0;
  const errBase = sheetName ? `「${sheetName}」` : '工作表';
  for (const row of all(doc, 'row')) {
    const out = [];
    for (const cell of Array.from(row.children).filter((x) => x.localName === 'c')) {
      if (++cells > 120000) throw new Error(`${errBase}单元格过多。`);
      const ref = /^([A-Z]{1,3})([1-9]\d*)$/.exec(cell.getAttribute('r') || '');
      if (!ref) throw new Error(`${errBase}单元格坐标无效。`);
      if (all(cell, 'f').length) throw new Error(`${errBase}包含公式，请在 Excel 中转为文本后重新保存再导入。`);
      let col = 0;
      for (const ch of ref[1]) col = col * 26 + ch.charCodeAt(0) - 64;
      col -= 1;
      if (col > 15) throw new Error(`${errBase}列数超出资料表范围。`);
      if (out[col] !== undefined) throw new Error(`${errBase}单元格坐标重复。`);
      const type = cell.getAttribute('t');
      const value = all(cell, 'v')[0]?.textContent ?? '';
      if (type === 'inlineStr') {
        out[col] = all(cell, 't').filter((t) => t.parentElement?.localName !== 'rPh').map((t) => t.textContent || '').join('');
      } else if (type === 's') {
        const index = Number(value);
        if (!Number.isSafeInteger(index) || index < 0 || index >= shared.length) throw new Error(`${errBase}共享字符串索引无效。`);
        out[col] = shared[index];
      } else if (type === 'e') {
        throw new Error(`${errBase}存在错误单元格，请先在 Excel 中修复。`);
      } else {
        if (value !== '') throw new Error(`${errBase}单元格 ${cell.getAttribute('r')} 不是文本。为保护证件号、日期与前导零，请将该列设为文本格式并重新输入原内容。`);
        out[col] = '';
      }
      if (out[col].length > LIMITS.value) throw new Error(`${errBase}某单元格内容超过 ${LIMITS.value} 字符。`);
    }
    rows.push(out);
    if (rows.length > (LIMITS.modules + LIMITS.entries + LIMITS.fields + 8)) throw new Error(`${errBase}行数过多。`);
  }
  return rows;
}

/** 数据工作表行 → 模块/记录/字段。PocketCV 与小师弟共用同一可见布局。 */
function resolveTier(tier, tierMap, sheetName) {
  if (!tier) return '常用';
  if (Object.prototype.hasOwnProperty.call(tierMap, tier)) return tierMap[tier];
  if (TIERS.includes(tier)) return tier;
  throw new Error(`「${sheetName}」分类层级信息损坏，请修正结构表或重新导出。`);
}

function dataSheetToProfile(sheet, descriptor, tierMap) {
  const rows = sheet.rows;
  const name = sheet.name;
  if (!rows.length || HEADERS.slice(0, 3).some((v, i) => rows[0][i] !== v)) {
    throw new Error(`「${name}」缺少「分组、项目、填写内容」表头，请使用资料表导出的 Excel。`);
  }
  const module = {
    id: descriptor?.moduleId && /^[-\w]{1,64}$/.test(descriptor.moduleId) ? descriptor.moduleId : uid('m'),
    name: name.slice(0, LIMITS.label) || '未命名分类',
    tier: resolveTier(descriptor?.tier, tierMap, name),
    entries: [],
  };
  const idPool = new Set([module.id]);
  const adoptId = (candidate) => {
    if (typeof candidate === 'string' && /^[-\w]{1,64}$/.test(candidate) && !idPool.has(candidate)) {
      idPool.add(candidate);
      return candidate;
    }
    const fresh = uid('x');
    idPool.add(fresh);
    return fresh;
  };

  let current = null;
  rows.slice(1).forEach((raw, index) => {
    const r = Array.from({ length: 8 }, (_, i) => raw[i] ?? '');
    if (r.every((v) => v === '')) return;
    if (raw.slice(8).some((v) => v !== undefined && v !== '')) throw new Error(`「${name}」第 ${index + 2} 行：多出了内容列，请把新增资料放在「项目」行。`);
    const [group, label, value, kind, eid, fid, type, sensitive] = r;
    const fail = (text) => { throw new Error(`「${name}」第 ${index + 2} 行：${text}`); };
    if (kind && kind !== 'entry' && kind !== 'field') fail('隐藏列的记录类型损坏，请整行复制。');

    if (kind === 'entry' || (!kind && group && !label && !value)) {
      const title = group.trim();
      if (!title) fail('记录标题不能为空。');
      if (label || value) fail('标题行只能填写标题，资料请放在下方「项目」行。');
      current = { id: adoptId(eid), title: title.slice(0, LIMITS.label), fields: [] };
      module.entries.push(current);
      return;
    }

    if (!label.trim()) fail('请填写「项目」名称，或删除整行。');
    if (!current) {
      if (eid) fail('缺少记录标题行，请将整段记录一起导回。');
      current = { id: adoptId(''), title: '未命名记录', fields: [] };
      module.entries.push(current);
    }
    const fieldType = type || (value.includes('\n') ? 'multiline' : 'text');
    if (!TYPES.includes(fieldType)) fail('字段类型损坏，请在资料页重新设置该字段。');
    if (sensitive && sensitive !== '是' && sensitive !== '否') fail('敏感标记只能为「是」或「否」。');
    current.fields.push({
      id: adoptId(fid),
      label: label.trim().slice(0, LIMITS.label),
      group: group.trim().slice(0, LIMITS.label),
      type: fieldType,
      value,
      sensitive: sensitive ? sensitive === '是' : false,
    });
  });
  return module;
}

export async function importProfileWorkbook(bytes) {
  const files = await unpackZip(bytes);
  if (!files.has('[Content_Types].xml') || [...files.keys()].some((n) => /vbaProject|externalLinks|\.bin$/i.test(n))) {
    throw new Error('仅支持无宏、无外部链接的标准 XLSX。');
  }
  const wb = parseXml(files.get('xl/workbook.xml'), 'workbook.xml');
  const rels = parseXml(files.get('xl/_rels/workbook.xml.rels'), 'workbook.xml.rels');
  const links = new Map();
  for (const rel of all(rels, 'Relationship')) {
    if (rel.getAttribute('TargetMode') === 'External') throw new Error('不接受带外部链接的工作簿。');
    let target = rel.getAttribute('Target') || '';
    if (target.includes('..') || target.includes('\\')) throw new Error('工作表引用路径不安全。');
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
    links.set(rel.getAttribute('Id'), target);
  }
  const sheets = new Map();
  for (const s of all(wb, 'sheet')) {
    const relId = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const path = links.get(relId);
    if (!path) throw new Error('工作表引用缺失。');
    sheets.set(s.getAttribute('name') || '', { id: s.getAttribute('sheetId') || '', path });
  }

  // 哪种格式？
  const xiaoshidi = sheets.has(XIAOSHIDI.structure);
  const pocketcv = sheets.has(STRUCTURE_SHEET);
  if (!xiaoshidi && !pocketcv) {
    if (sheets.has('资料表') && sheets.has('_投递舱')) throw new Error('这是小师弟求职旧版资料表。请先在小师弟中导入后用新版导出，再来迁移。');
    throw new Error('找不到资料表结构（隐藏结构表缺失）。请使用口袋简历或小师弟求职（v2）导出的 Excel；不支持任意 Excel 智能识别。');
  }
  const structure = xiaoshidi ? XIAOSHIDI : { structure: STRUCTURE_SHEET, format: WORKBOOK_FORMAT, help: HELP_SHEET, tiers: Object.fromEntries(TIERS.map((t) => [t, t])) };
  const shared = readSharedStrings(files);
  const docSheets = new Map(); // name -> 解析后的行
  for (const [name, s] of sheets) {
    if (name === structure.structure || name === structure.help) continue;
    docSheets.set(name, readSheetRows(parseXml(files.get(s.path), s.path), shared, name));
  }

  const metaRows = readSheetRows(parseXml(files.get(sheets.get(structure.structure).path), 'structure'), shared, structure.structure);
  const meta = new Map(metaRows.filter((r) => r[0] !== '分类').map((r) => [r[0], r[1]]));
  if (meta.get('格式') !== structure.format) throw new Error('工作簿格式标记不符，请使用对应产品导出的资料表。');

  const descriptors = new Map();
  for (const row of metaRows.filter((r) => r[0] === '分类')) {
    if (descriptors.has(row[1])) throw new Error('结构表分类信息重复。');
    descriptors.set(String(row[1]), { sheetName: row[2], moduleId: row[3], tier: row[5] });
  }

  const p = emptyProfile();
  p.id = meta.get('资料ID') && /^[-\w]{1,80}$/.test(meta.get('资料ID')) ? meta.get('资料ID') : p.id;
  p.name = (meta.get('资料名称') || p.name).slice(0, LIMITS.label);
  p.updatedAt = Date.parse(meta.get('更新时间') || '') ? meta.get('更新时间') : p.updatedAt;
  for (const [name, rows] of docSheets) {
    const sheet = { name, rows };
    const s = sheets.get(name);
    const d = descriptors.get(String(s.id)) || null;
    p.modules.push(dataSheetToProfile(sheet, d, structure.tiers));
  }
  if (!p.modules.length) throw new Error('资料表里没有任何分类数据。');
  return { profile: validateProfile(p), source: xiaoshidi ? 'xiaoshidi' : 'pocketcv' };
}

function readSharedStrings(files) {
  const bytes = files.get('xl/sharedStrings.xml');
  if (!bytes) return [];
  const doc = parseXml(bytes, 'sharedStrings.xml');
  return all(doc, 'si').map((si) =>
    all(si, 't').filter((t) => t.parentElement?.localName !== 'rPh').map((t) => t.textContent || '').join(''));
}
