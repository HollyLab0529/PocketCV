// 口袋简历 PocketCV · 存储核心：带修订号与历史快照的资料仓库
// driver 仅需实现 get(key)/set(key,value)；扩展走 chrome.storage.local，独立页走 localStorage。

export const STORE_KEY = 'pocketcv.profile.v1';
const HIST_KEY = 'pocketcv.history.v1';
const EPOCH_KEY = 'pocketcv.epoch.v1';
const HISTORY_MAX = 3;

export class ConflictError extends Error {
  constructor() { super('资料已在其他窗口变更，请重新载入后再试。'); this.code = 'CONFLICT'; }
}

export function createStore(driver) {
  let writes = Promise.resolve();
  const serialize = (fn) => { const next = writes.then(fn); writes = next.catch(() => {}); return next; };

  const readEpoch = async () => (await driver.get(EPOCH_KEY)) || 0;
  const bumpEpoch = async () => { const next = (await readEpoch()) + 1; await driver.set(EPOCH_KEY, next); return next; };
  const pushHistory = async (label, profile) => {
    const list = (await driver.get(HIST_KEY)) || [];
    list.push({ at: Date.now(), label, profile });
    while (list.length > HISTORY_MAX) list.shift();
    await driver.set(HIST_KEY, list);
  };

  return {
    async load() {
      const [profile, epoch] = [await driver.get(STORE_KEY), await readEpoch()];
      return { profile, epoch };
    },
    async save(profile, rev, checkpoint = '', epoch = 0) {
      return serialize(async () => {
        const currentEpoch = await readEpoch();
        if (epoch !== currentEpoch) throw new ConflictError();
        const previous = await driver.get(STORE_KEY);
        // 修订号检查：旧窗口（revision 落后）不得整树覆盖新数据
        const prevRev = Number(previous?.revision) || 0;
        if (previous && prevRev !== (Number(rev) || 0)) throw new ConflictError();
        if (checkpoint && previous) await pushHistory(checkpoint, previous);
        const updatedAt = new Date().toISOString();
        const next = { ...profile, revision: (Number(rev) || 0) + 1, updatedAt };
        await driver.set(STORE_KEY, next);
        return { profile: next, epoch: currentEpoch };
      });
    },
    async history() {
      const list = (await driver.get(HIST_KEY)) || [];
      return [...list].reverse();
    },
    async replaceAll(profile, checkpoint = '') {
      return serialize(async () => {
        const previous = await driver.get(STORE_KEY);
        if (checkpoint && previous) await pushHistory(checkpoint, previous);
        const epoch = await bumpEpoch();
        const next = { ...profile, revision: 0, updatedAt: new Date().toISOString() };
        await driver.set(STORE_KEY, next);
        return { profile: next, epoch };
      });
    },
    async erase() {
      return serialize(async () => {
        const epoch = await bumpEpoch();
        await driver.set(HIST_KEY, []);
        const fresh = null;
        await driver.set(STORE_KEY, fresh);
        return { profile: null, epoch };
      });
    },
  };
}
