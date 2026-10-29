// 口袋简历 PocketCV · 最小 ZIP 容器（自研实现）
// 导出仅用 STORE（不压缩），导入兼容 STORE/DEFLATE（DecompressionStream）。
// 有意不支持 ZIP64、加密、分卷；全部读取带边界防护。

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const MAX_ENTRIES = 160;
const MAX_FILE_BYTES = 8 * 1024 * 1024;   // 单文件未压缩上限
const MAX_TOTAL_BYTES = 32 * 1024 * 1024; // 解压总量上限

// ===== 打包（STORE）=====
export function packZip(files) {
  const entries = Object.entries(files);
  if (!entries.length || entries.length > MAX_ENTRIES) throw new Error('压缩包条目数量无效。');
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBytes = encoder.encode(name);
    if (nameBytes.length > 200) throw new Error('条目名称过长。');
    const data = typeof content === 'string' ? encoder.encode(content) : content;
    if (!(data instanceof Uint8Array)) throw new Error('条目内容必须是字符串或字节数组。');
    if (data.length > MAX_FILE_BYTES) throw new Error('单个文件过大。');
    const crc = crc32(data);

    const head = new Uint8Array(30);
    const h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true);   // local file header
    h.setUint16(4, 20, true);           // version needed
    h.setUint16(6, 0x0800, true);       // UTF-8 名称
    h.setUint16(8, 0, true);            // STORE
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, nameBytes.length, true);
    localParts.push(head, nameBytes, data);

    const dir = new Uint8Array(46);
    const d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true);   // central directory header
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x0800, true);
    d.setUint16(10, 0, true);           // STORE
    d.setUint32(16, crc, true);
    d.setUint32(20, data.length, true);
    d.setUint32(24, data.length, true);
    d.setUint16(28, nameBytes.length, true);
    d.setUint32(42, offset, true);
    centralParts.push(dir, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }

  const central = concat(centralParts);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);     // end of central directory
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, central.length, true);
  e.setUint32(16, offset, true);
  return concat([...localParts, central, end]);
}

// ===== 解包（STORE / DEFLATE）=====
async function inflate(data, expectedSize) {
  let stream;
  try { stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')); }
  catch { throw new Error('当前浏览器不支持解压，请升级 Chrome 后重试。'); }
  const reader = stream.getReader();
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > expectedSize || size > MAX_TOTAL_BYTES) { await reader.cancel(); throw new Error('解压后超过声明大小，已停止。'); }
      parts.push(value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch { /* 已经结束 */ }
    throw error;
  }
  if (size !== expectedSize) throw new Error('解压长度与目录记录不符。');
  return concat(parts);
}

export async function unpackZip(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (b.length < 22 || b.length > MAX_FILE_BYTES) throw new Error('文件不是有效的 XLSX（大小超出范围）。');
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);

  // 从尾部找 EOCD（22 字节固定 + 至多 64K 注释）
  let eocd = -1;
  const scanFloor = Math.max(0, b.length - 22 - 0x10000);
  for (let p = b.length - 22; p >= scanFloor; p--) {
    if (view.getUint32(p, true) !== 0x06054b50) continue;
    if (p + 22 + view.getUint16(p + 20, true) === b.length) { eocd = p; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 XLSX / ZIP 文件。');
  if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0) throw new Error('不支持分卷或缺失数据的压缩包。');
  const count = view.getUint16(eocd + 10, true);
  const dirSize = view.getUint32(eocd + 12, true);
  const dirOffset = view.getUint32(eocd + 16, true);
  if (count > MAX_ENTRIES || view.getUint16(eocd + 8, true) !== count) throw new Error('压缩包条目数量异常。');
  if (dirOffset + dirSize > eocd) throw new Error('压缩包目录越界。');

  const records = [];
  const names = new Set();
  let totalDeclared = 0;
  let p = dirOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > eocd || view.getUint32(p, true) !== 0x02014b50) throw new Error('压缩包目录损坏。');
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const packedSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    if (p + 46 + nameLen + extraLen + commentLen > dirOffset + dirSize) throw new Error('目录记录越界。');
    const name = decoder.decode(b.subarray(p + 46, p + 46 + nameLen));
    if (flags & 0x1) throw new Error('不支持加密的压缩包。');
    if (method !== 0 && method !== 8) throw new Error('不支持的压缩方式。');
    if (size === 0xffffffff || localOffset === 0xffffffff || packedSize === 0xffffffff) throw new Error('暂不支持 ZIP64 压缩包。');
    if (!name || name.includes('..') || name.startsWith('/') || name.includes('\\') || name.includes('\0')) throw new Error('压缩包路径不安全。');
    if (names.has(name)) throw new Error('压缩包条目重复。');
    names.add(name);
    totalDeclared += size;
    if (size > MAX_TOTAL_BYTES || totalDeclared > MAX_TOTAL_BYTES) throw new Error('解压总量过大，已停止。');

    // 本地头校验
    if (localOffset + 30 > b.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('文件头无效。');
    if (view.getUint16(localOffset + 8, true) !== method) throw new Error('文件头与目录压缩方式不一致。');
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    if (decoder.decode(b.subarray(localOffset + 30, localOffset + 30 + localNameLen)) !== name) throw new Error('文件名校验失败。');
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + packedSize > b.length) throw new Error('文件数据越界。');
    records.push({ name, method, crc, size, data: b.subarray(dataStart, dataStart + packedSize) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (p !== dirOffset + dirSize) throw new Error('压缩包目录大小不符。');

  const out = new Map();
  for (const r of records) {
    const data = r.method === 0 ? r.data : await inflate(r.data, r.size);
    if (data.length !== r.size || crc32(data) !== r.crc) throw new Error('文件内容校验失败。');
    out.set(r.name, data);
  }
  return out;
}
