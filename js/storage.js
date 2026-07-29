// localStorage 包裝:任何失敗都退回記憶體,遊戲不因存檔掛掉。

export function safeLocalStorage() {
  try {
    const ls = globalThis.localStorage;
    const k = '__99racer_probe__';
    ls.setItem(k, '1');
    ls.removeItem(k);
    return ls;
  } catch {
    return null;
  }
}

export function createStorage(backend) {
  const mem = new Map();
  const get = (k) => {
    try {
      if (backend) return backend.getItem(k);
    } catch {}
    return mem.has(k) ? mem.get(k) : null;
  };
  const set = (k, v) => {
    try {
      if (backend) {
        backend.setItem(k, v);
        return;
      }
    } catch {}
    mem.set(k, v);
  };
  const load = (k, fallback) => {
    const raw = get(k);
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  };
  return {
    loadSettings: () => load('99racer.settings', { tables: [2, 3, 5], muted: false }),
    saveSettings: (s) => set('99racer.settings', JSON.stringify(s)),
    loadHighScore: () => load('99racer.highscore', 0),
    saveHighScore: (n) => set('99racer.highscore', JSON.stringify(n)),
    loadReview: () => load('99racer.review', []),
    saveReview: (arr) => set('99racer.review', JSON.stringify(arr)),
  };
}
