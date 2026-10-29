// 口袋简历 PocketCV · 加密备份（AES-GCM + PBKDF2，浏览器原生 WebCrypto）
// 文件格式（base64 编码的 JSON）：{v:1, kdf:{salt,iter}, iv, ct}

const ITERATIONS = 310000;

const b64 = {
  encode(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); },
  decode(text) { const s = atob(text); const bytes = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i); return bytes; },
};

async function deriveKey(password, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function randomBytes(n) { const bytes = new Uint8Array(n); crypto.getRandomValues(bytes); return bytes; }

export async function encryptProfile(profile, password) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('备份口令至少 12 个字符。');
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = await deriveKey(password, salt);
  const plain = new TextEncoder().encode(JSON.stringify(profile));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return b64.encode(new TextEncoder().encode(JSON.stringify({
    v: 1, app: 'PocketCV', kdf: { salt: b64.encode(salt), iter: ITERATIONS }, iv: b64.encode(iv), ct: b64.encode(cipher),
  })));
}

export async function decryptProfile(text, password) {
  let box;
  try { box = JSON.parse(new TextDecoder().decode(b64.decode(text.trim()))); } catch { throw new Error('文件不是有效的加密备份。'); }
  if (box?.app !== 'PocketCV' || box?.v !== 1) throw new Error('这不是口袋简历的加密备份文件。');
  const key = await deriveKey(password, b64.decode(box.kdf.salt));
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.decode(box.iv) }, key, b64.decode(box.ct));
  } catch { throw new Error('解密失败：口令不正确或文件已损坏。口令遗失后无法找回。'); }
  return JSON.parse(new TextDecoder().decode(plain));
}
