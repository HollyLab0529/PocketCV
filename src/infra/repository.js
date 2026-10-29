// 口袋简历 PocketCV · 上下文桥：扩展与独立页共用的仓库工厂与消息通道

export const isExtension = () => typeof chrome !== 'undefined' && !!chrome.runtime?.id;

export async function message(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response || !response.ok) {
    const error = new Error(response?.error || '扩展未响应，请在扩展管理页重新加载。');
    error.code = response?.code;
    throw error;
  }
  return response.data;
}

export function createRepository() {
  if (isExtension()) {
    return {
      mode: 'extension',
      load: () => message('LOAD'),
      save: (profile, rev, checkpoint, epoch) => message('SAVE', { profile, rev, checkpoint, epoch }),
      history: () => message('HISTORY'),
      erase: () => message('ERASE'),
      replaceAll: (profile, checkpoint) => message('REPLACE', { profile, checkpoint }),
      subscribe(fn) {
        const listener = (changes, area) => {
          if (area === 'local' && changes['pocketcv.profile.v1']?.newValue) fn(changes['pocketcv.profile.v1'].newValue);
        };
        chrome.storage.onChanged.addListener(listener);
        return () => chrome.storage.onChanged.removeListener(listener);
      },
    };
  }
  const driver = {
    async get(key) { const text = localStorage.getItem(key); return text ? JSON.parse(text) : null; },
    async set(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
  };
  // 动态 import 避免扩展模式打包依赖；独立页同源加载。
  return import('./storage-core.js').then(({ createStore }) => ({
    mode: 'standalone',
    ...createStore(driver),
    subscribe(fn) {
      const listener = (event) => {
        if (event.key === 'pocketcv.profile.v1' && event.newValue) { try { fn(JSON.parse(event.newValue)); } catch { /* 忽略坏数据 */ } }
      };
      window.addEventListener('storage', listener);
      return () => window.removeEventListener('storage', listener);
    },
  }));
}
