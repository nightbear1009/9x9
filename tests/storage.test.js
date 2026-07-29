import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStorage } from '../js/storage.js';

function fakeBackend() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    dump: m,
  };
}

test('backend 為 null 時回傳預設值且可用記憶體讀寫', () => {
  const s = createStorage(null);
  assert.deepEqual(s.loadSettings(), { tables: [2, 3, 5], muted: false });
  assert.equal(s.loadHighScore(), 0);
  assert.deepEqual(s.loadReview(), []);
  s.saveHighScore(1234);
  assert.equal(s.loadHighScore(), 1234);
});

test('有 backend 時 roundtrip 正常', () => {
  const b = fakeBackend();
  const s = createStorage(b);
  s.saveSettings({ tables: [7, 8], muted: true });
  assert.deepEqual(s.loadSettings(), { tables: [7, 8], muted: true });
  s.saveReview([{ a: 3, b: 7, streak: 1, dueIn: 4 }]);
  assert.deepEqual(s.loadReview(), [{ a: 3, b: 7, streak: 1, dueIn: 4 }]);
  assert.ok(b.dump.has('99racer.settings'));
});

test('backend 丟例外時退回記憶體,不 throw', () => {
  const s = createStorage({
    getItem: () => { throw new Error('QuotaExceeded'); },
    setItem: () => { throw new Error('QuotaExceeded'); },
  });
  s.saveHighScore(99);
  assert.equal(s.loadHighScore(), 99);
});

test('JSON 壞掉時回傳預設值', () => {
  const b = fakeBackend();
  b.setItem('99racer.settings', '{oops');
  const s = createStorage(b);
  assert.deepEqual(s.loadSettings(), { tables: [2, 3, 5], muted: false });
});
