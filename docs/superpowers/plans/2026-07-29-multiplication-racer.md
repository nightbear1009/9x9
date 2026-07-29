# 《九九小車手》Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建一個可在 iPad Safari 遊玩的九九乘法表公路闖關遊戲(PWA),部署到 GitHub Pages。

**Architecture:** 純靜態網頁、零 build 步驟。純邏輯(出題/升級/存檔)與畫面(Canvas 遊戲迴圈)分離:`questions.js`/`upgrades.js`/`storage.js` 是零 DOM 依賴的 ES modules,可直接用 `node --test` 測;`game.js` 只負責遊戲迴圈與繪製,依賴全部由建構子注入;`index.html` 內的 module script 負責畫面切換與接線。

**Tech Stack:** Vanilla JS (ES modules)、Canvas 2D、WebAudio、Service Worker、`node --test`(內建,零套件)、GitHub Pages。

## Global Constraints

- 零 npm 相依套件;`package.json` 只為了 `"type": "module"` 存在。
- 所有資源引用一律相對路徑(部署在 `/9x9/` 子路徑下)。
- 介面文字繁體中文。
- localStorage 鍵:`99racer.settings`、`99racer.highscore`、`99racer.review`;所有讀寫經過 `storage.js`(內部 try/catch,失敗退回記憶體)。
- 遊戲數值(spec 已核可):3 車道、3 愛心、每關 10 排門、車速每關 +8% 上限 2 倍、門間隔 = 基礎速度 × 4 秒、答對 100×連擊(上限 ×5)、金幣 10 分(加倍後 20)、答錯慢動作 2 秒顯示正解、複習題 3~5 題後重出且連對 2 次移出。
- macOS 環境:無 `timeout(1)`;等待外部狀態用背景輪詢,不用前景 sleep。

---

### Task 1: 專案骨架 + storage.js

**Files:**
- Create: `package.json`, `.gitignore`, `js/storage.js`
- Test: `tests/storage.test.js`

**Interfaces:**
- Consumes: 無(第一個 task)
- Produces:
  - `safeLocalStorage(): Storage | null` — 探測 localStorage 可用性(寫入測試鍵),失敗回 null
  - `createStorage(backend): { loadSettings(): {tables:number[], muted:boolean}, saveSettings(s), loadHighScore(): number, saveHighScore(n), loadReview(): Array<{a,b,streak,dueIn}>, saveReview(arr) }` — backend 為 null 或丟例外時退回記憶體 Map,絕不 throw

- [ ] **Step 1: 建骨架檔案**

`package.json`:
```json
{
  "name": "9x9",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test tests/" }
}
```

`.gitignore`:
```
.DS_Store
```

- [ ] **Step 2: 寫失敗測試 `tests/storage.test.js`**

```js
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
```

- [ ] **Step 3: 跑測試確認失敗** — `node --test tests/`,預期 `Cannot find module '../js/storage.js'`

- [ ] **Step 4: 實作 `js/storage.js`**

```js
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
```

注意:`get` 的 fallback 邏輯是「backend 丟例外 → 讀記憶體」,`set` 同理,這樣 quota 爆掉時同一份資料仍在記憶體內一致。

- [ ] **Step 5: 跑測試確認通過** — `node --test tests/`,4 tests PASS

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: 專案骨架與 storage 模組"`

---

### Task 2: questions.js 出題引擎

**Files:**
- Create: `js/questions.js`
- Test: `tests/questions.test.js`

**Interfaces:**
- Consumes: 無
- Produces:
  - `generateDistractors(a, b, rand?): number[]` — 回傳 2 個相異、>0、≠ a×b 的干擾項,優先取自 `{a×(b±1), (a±1)×b}`
  - `class QuestionEngine`:
    - `constructor({ tables?: number[], reviewState?: Array<{a,b,streak,dueIn}>, rand?: () => number })`
    - `next(): { a, b, answer, choices: number[3], correctIndex: 0|1|2, isReview: boolean }` — 複習佇列到期優先
    - `report(question, correct: boolean): void` — 更新複習佇列與 `stats`
    - `getReviewState(): Array<{a,b,streak,dueIn}>` — 可 JSON 序列化,dueIn 夾在 1..9
    - `stats: { correct: number, total: number }`

- [ ] **Step 1: 寫失敗測試 `tests/questions.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDistractors, QuestionEngine } from '../js/questions.js';

// 可重現的偽隨機
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('干擾項:2 個、相異、為正、不等於正解(全表掃過)', () => {
  const rand = lcg(42);
  for (let a = 1; a <= 9; a++) {
    for (let b = 1; b <= 9; b++) {
      const d = generateDistractors(a, b, rand);
      assert.equal(d.length, 2, `${a}x${b}`);
      assert.notEqual(d[0], d[1], `${a}x${b}`);
      for (const v of d) {
        assert.ok(v > 0, `${a}x${b} 出現 ${v}`);
        assert.notEqual(v, a * b, `${a}x${b}`);
      }
    }
  }
});

test('next() 只從勾選的段出題,choices 含正解於 correctIndex', () => {
  const e = new QuestionEngine({ tables: [7], rand: lcg(1) });
  for (let i = 0; i < 50; i++) {
    const q = e.next();
    assert.equal(q.a, 7);
    assert.ok(q.b >= 1 && q.b <= 9);
    assert.equal(q.choices.length, 3);
    assert.equal(q.choices[q.correctIndex], q.answer);
    assert.equal(q.answer, q.a * q.b);
  }
});

test('答錯的題目會在 3~5 題內以複習題重新出現', () => {
  const e = new QuestionEngine({ tables: [2, 3, 5], rand: lcg(7) });
  const q = e.next();
  e.report(q, false);
  let found = -1;
  for (let i = 1; i <= 5; i++) {
    const nq = e.next();
    if (nq.isReview && nq.a === q.a && nq.b === q.b) { found = i; break; }
    e.report(nq, true);
  }
  assert.ok(found >= 1 && found <= 5, `複習題出現在第 ${found} 題`);
});

test('複習題連對 2 次移出;中途答錯重置', () => {
  const e = new QuestionEngine({ tables: [4], reviewState: [{ a: 4, b: 6, streak: 0, dueIn: 1 }], rand: lcg(3) });
  const q1 = e.next();
  assert.ok(q1.isReview);
  e.report(q1, true); // streak 1,重新排程
  // 跑到它再出現
  let q2;
  for (let i = 0; i < 10; i++) { q2 = e.next(); if (q2.isReview) break; e.report(q2, true); }
  assert.ok(q2.isReview);
  e.report(q2, false); // 重置 streak
  assert.equal(e.getReviewState().length, 1);
  assert.equal(e.getReviewState()[0].streak, 0);
  // 連對兩次 → 移出
  let served = 0;
  for (let i = 0; i < 30 && served < 2; i++) {
    const q = e.next();
    if (q.isReview) { e.report(q, true); served++; }
    else e.report(q, true);
  }
  assert.equal(e.getReviewState().length, 0);
});

test('getReviewState 可序列化且 dueIn 夾在 1..9', () => {
  const e = new QuestionEngine({ tables: [2], rand: lcg(9) });
  const q = e.next();
  e.report(q, false);
  const state = JSON.parse(JSON.stringify(e.getReviewState()));
  for (const r of state) {
    assert.ok(r.dueIn >= 1 && r.dueIn <= 9);
    assert.ok(Number.isInteger(r.a) && Number.isInteger(r.b));
  }
});

test('stats 累計答對/總數', () => {
  const e = new QuestionEngine({ tables: [2], rand: lcg(5) });
  const a = e.next(); e.report(a, true);
  const b = e.next(); e.report(b, false);
  assert.deepEqual(e.stats, { correct: 1, total: 2 });
});
```

- [ ] **Step 2: 跑測試確認失敗** — `node --test tests/`,questions 相關 FAIL(module not found)

- [ ] **Step 3: 實作 `js/questions.js`**

```js
// 出題引擎:選段、擬真干擾項、答錯複習佇列(間隔重複)。零 DOM 依賴。

const REVIEW_STREAK_TARGET = 2; // 連對 2 次移出複習佇列
const SERVING = 999;            // 已抽出、等待 report 的哨兵值

export function generateDistractors(a, b, rand = Math.random) {
  const answer = a * b;
  const pool = [];
  for (const v of [a * (b - 1), a * (b + 1), (a - 1) * b, (a + 1) * b]) {
    if (v > 0 && v !== answer && !pool.includes(v)) pool.push(v);
  }
  const picked = [];
  while (picked.length < 2 && pool.length > 0) {
    const i = Math.floor(rand() * pool.length);
    picked.push(pool.splice(i, 1)[0]);
  }
  let guard = 0;
  while (picked.length < 2) {
    const delta = 1 + Math.floor(rand() * 3) + Math.floor(guard / 10);
    const v = answer + (rand() < 0.5 ? -delta : delta);
    if (v > 0 && v !== answer && !picked.includes(v)) picked.push(v);
    guard++;
  }
  return picked;
}

export class QuestionEngine {
  constructor({ tables = [2, 3, 5], reviewState = [], rand = Math.random } = {}) {
    this.tables = tables.slice();
    this.rand = rand;
    this.review = reviewState.map((r) => ({
      a: r.a, b: r.b, streak: r.streak || 0, dueIn: r.dueIn ?? this.#gap(),
    }));
    this.stats = { correct: 0, total: 0 };
  }

  #gap() { return 3 + Math.floor(this.rand() * 3); } // 3..5 題後再出

  next() {
    for (const r of this.review) if (r.dueIn !== SERVING) r.dueIn -= 1;
    const due = this.review.find((r) => r.dueIn <= 0);
    let a, b, isReview;
    if (due) {
      a = due.a; b = due.b; isReview = true;
      due.dueIn = SERVING; // 等 report 後重新排程,避免連續重複抽中
    } else {
      a = this.tables[Math.floor(this.rand() * this.tables.length)];
      b = 1 + Math.floor(this.rand() * 9);
      isReview = false;
    }
    const answer = a * b;
    const choices = generateDistractors(a, b, this.rand);
    const correctIndex = Math.floor(this.rand() * 3);
    choices.splice(correctIndex, 0, answer);
    return { a, b, answer, choices, correctIndex, isReview };
  }

  report(q, correct) {
    this.stats.total += 1;
    if (correct) this.stats.correct += 1;
    const idx = this.review.findIndex((r) => r.a === q.a && r.b === q.b);
    if (correct) {
      if (idx >= 0) {
        const r = this.review[idx];
        r.streak += 1;
        if (r.streak >= REVIEW_STREAK_TARGET) this.review.splice(idx, 1);
        else r.dueIn = this.#gap();
      }
    } else if (idx >= 0) {
      const r = this.review[idx];
      r.streak = 0;
      r.dueIn = this.#gap();
    } else {
      this.review.push({ a: q.a, b: q.b, streak: 0, dueIn: this.#gap() });
    }
  }

  getReviewState() {
    return this.review.map((r) => ({
      a: r.a, b: r.b, streak: r.streak,
      dueIn: Math.max(1, Math.min(r.dueIn, 9)),
    }));
  }
}
```

- [ ] **Step 4: 跑測試確認通過** — `node --test tests/` 全綠

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: 出題引擎與複習佇列"`

---

### Task 3: upgrades.js 升級池

**Files:**
- Create: `js/upgrades.js`
- Test: `tests/upgrades.test.js`

**Interfaces:**
- Consumes: 無
- Produces:
  - `UPGRADES: { magnet, shield, double_score, slow, coin_bonus }` — 每項 `{id, emoji, name, desc}`
  - `HEART_REFILL: {id:'heart', ...}` — 補位選項;**效果由 game 端處理**(`game.refillHeart()`),`apply('heart')` 是 no-op
  - `class UpgradeState`:
    - `constructor(rand?)`
    - `drawChoices(): Array<{id,emoji,name,desc}>` — 3 個相異;已持有的磁鐵/金幣加倍、疊滿的護盾會從池中移除;不足 3 個以 HEART_REFILL 補位
    - `apply(id): void`
    - `onLevelComplete(): void` — 清除單關效果(double_score、slow);**必須在 drawChoices 前呼叫**
    - `consumeShield(): boolean`、`coinValue(): 10|20`、`scoreMultiplier(): 1|2`
    - 屬性:`magnet: boolean`、`shields: number(0..2)`、`slow: boolean`

- [ ] **Step 1: 寫失敗測試 `tests/upgrades.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UpgradeState, UPGRADES, HEART_REFILL } from '../js/upgrades.js';

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

test('抽 3 個相異選項', () => {
  const u = new UpgradeState(lcg(1));
  const c = u.drawChoices();
  assert.equal(c.length, 3);
  assert.equal(new Set(c.map((x) => x.id)).size, 3);
});

test('已持有的永久升級從池中移除;池不足以愛心補位', () => {
  const u = new UpgradeState(lcg(2));
  u.apply('magnet');
  u.apply('coin_bonus');
  u.apply('shield');
  u.apply('shield'); // 疊滿 2 層
  const c = u.drawChoices();
  const ids = c.map((x) => x.id).sort();
  assert.deepEqual(ids, ['double_score', 'heart', 'slow'].sort());
});

test('護盾上限 2 層,消耗後可再抽', () => {
  const u = new UpgradeState(lcg(3));
  u.apply('shield'); u.apply('shield'); u.apply('shield');
  assert.equal(u.shields, 2);
  assert.equal(u.consumeShield(), true);
  assert.equal(u.shields, 1);
  assert.equal(u.consumeShield(), true);
  assert.equal(u.consumeShield(), false);
});

test('單關效果:雙倍分數與慢速在 onLevelComplete 清除', () => {
  const u = new UpgradeState(lcg(4));
  u.apply('double_score'); u.apply('slow');
  assert.equal(u.scoreMultiplier(), 2);
  assert.equal(u.slow, true);
  u.onLevelComplete();
  assert.equal(u.scoreMultiplier(), 1);
  assert.equal(u.slow, false);
});

test('金幣價值:預設 10,加倍後 20', () => {
  const u = new UpgradeState(lcg(5));
  assert.equal(u.coinValue(), 10);
  u.apply('coin_bonus');
  assert.equal(u.coinValue(), 20);
});

test('UPGRADES 與 HEART_REFILL 中文文案齊備', () => {
  for (const k of ['magnet', 'shield', 'double_score', 'slow', 'coin_bonus']) {
    assert.ok(UPGRADES[k].name && UPGRADES[k].emoji && UPGRADES[k].desc, k);
  }
  assert.equal(HEART_REFILL.id, 'heart');
});
```

- [ ] **Step 2: 跑測試確認失敗**

- [ ] **Step 3: 實作 `js/upgrades.js`**

```js
// 單局升級池:死了歸零,只在一局內生效。零 DOM 依賴。

export const UPGRADES = {
  magnet: { id: 'magnet', emoji: '🧲', name: '磁鐵', desc: '隔壁車道的金幣也吸得到' },
  shield: { id: 'shield', emoji: '🛡️', name: '護盾', desc: '抵擋一次答錯' },
  double_score: { id: 'double_score', emoji: '⭐', name: '雙倍分數', desc: '下一關得分 ×2' },
  slow: { id: 'slow', emoji: '🐢', name: '慢速門', desc: '下一關恢復慢車速' },
  coin_bonus: { id: 'coin_bonus', emoji: '💰', name: '金幣加倍', desc: '每枚金幣 20 分' },
};

export const HEART_REFILL = { id: 'heart', emoji: '❤️', name: '愛心補給', desc: '回復 1 顆愛心' };

const MAX_SHIELDS = 2;

export class UpgradeState {
  constructor(rand = Math.random) {
    this.rand = rand;
    this.magnet = false;
    this.coinBonus = false;
    this.shields = 0;
    this.doubleScore = false;
    this.slow = false;
  }

  drawChoices() {
    const pool = [UPGRADES.double_score, UPGRADES.slow];
    if (!this.magnet) pool.push(UPGRADES.magnet);
    if (this.shields < MAX_SHIELDS) pool.push(UPGRADES.shield);
    if (!this.coinBonus) pool.push(UPGRADES.coin_bonus);
    const choices = [];
    while (choices.length < 3 && pool.length > 0) {
      const i = Math.floor(this.rand() * pool.length);
      choices.push(pool.splice(i, 1)[0]);
    }
    while (choices.length < 3) choices.push(HEART_REFILL);
    return choices;
  }

  apply(id) {
    if (id === 'magnet') this.magnet = true;
    else if (id === 'shield') this.shields = Math.min(MAX_SHIELDS, this.shields + 1);
    else if (id === 'double_score') this.doubleScore = true;
    else if (id === 'slow') this.slow = true;
    else if (id === 'coin_bonus') this.coinBonus = true;
    // 'heart' 由 game.refillHeart() 處理
  }

  onLevelComplete() {
    this.doubleScore = false;
    this.slow = false;
  }

  consumeShield() {
    if (this.shields > 0) { this.shields -= 1; return true; }
    return false;
  }

  coinValue() { return this.coinBonus ? 20 : 10; }
  scoreMultiplier() { return this.doubleScore ? 2 : 1; }
}
```

- [ ] **Step 4: 跑測試確認通過** — `node --test tests/` 全綠

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: 單局升級池"`

---

### Task 4: audio.js 合成音效

**Files:**
- Create: `js/audio.js`
- Test: `tests/audio.test.js`

**Interfaces:**
- Consumes: 無
- Produces: `class GameAudio`:
  - `unlock()` — 第一次觸碰時呼叫;建立/恢復 AudioContext,環境不支援時靜默降級
  - `setMuted(bool)`
  - 音效方法(全部在無 context 或靜音時 no-op):`correct() wrong() coin() levelUp() gameOver() click() startEngine() stopEngine()`

- [ ] **Step 1: 寫失敗測試 `tests/audio.test.js`**(node 沒有 AudioContext,驗證降級不 throw)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../js/audio.js';

test('無 AudioContext 環境下所有方法皆不 throw', () => {
  const a = new GameAudio();
  assert.doesNotThrow(() => {
    a.unlock();
    a.correct(); a.wrong(); a.coin(); a.levelUp(); a.gameOver(); a.click();
    a.startEngine(); a.stopEngine();
    a.setMuted(true); a.correct();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

- [ ] **Step 3: 實作 `js/audio.js`**

```js
// WebAudio 合成音效,不用音檔。iOS 需在使用者手勢中 unlock()。

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineNodes = null;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (AC) this.ctx = new AC();
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m) {
    this.muted = m;
    if (m) this.stopEngine();
  }

  #tone(freq, dur, type = 'sine', vol = 0.15, when = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur);
  }

  correct() { this.#tone(660, 0.1); this.#tone(880, 0.15, 'sine', 0.15, 0.08); }
  wrong() { this.#tone(160, 0.3, 'square', 0.08); }
  coin() { this.#tone(1320, 0.06, 'triangle', 0.12); }
  click() { this.#tone(800, 0.04, 'sine', 0.08); }
  levelUp() { [523, 659, 784, 1046].forEach((f, i) => this.#tone(f, 0.12, 'sine', 0.15, i * 0.09)); }
  gameOver() { [392, 330, 262, 196].forEach((f, i) => this.#tone(f, 0.2, 'sawtooth', 0.08, i * 0.15)); }

  startEngine() {
    if (!this.ctx || this.muted || this.engineNodes) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = 50;
    g.gain.value = 0.015;
    o.connect(g);
    g.connect(this.ctx.destination);
    o.start();
    this.engineNodes = { o, g };
  }

  stopEngine() {
    if (!this.engineNodes) return;
    try { this.engineNodes.o.stop(); } catch {}
    this.engineNodes = null;
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: WebAudio 合成音效"`

---

### Task 5: index.html + style.css 畫面骨架

**Files:**
- Create: `index.html`, `style.css`

**Interfaces:**
- Consumes: Task 1-4 的模組(import 進 module script)
- Produces: DOM 結構與 `ui` 物件契約(Task 6 的 `Game` 會呼叫):
  - `ui.setQuestion(text)`、`ui.setScore(n)`、`ui.setHearts(n)`、`ui.setCombo(n)`、`ui.setLevel(n)`、`ui.setShields(n)`
  - `ui.showLearning(text)` / `ui.hideLearning()`
  - `ui.levelComplete(level)` — 顯示三選一 overlay;選定後呼叫 `game.resumeAfterUpgrade()`
  - `ui.gameOver({score, coins, correct, total})` — 顯示結算
  - DOM ids:`#screen-home #screen-game #screen-over #hud-question #hud-score #hud-hearts #hud-combo #hud-level #hud-shields #overlay-upgrade #upgrade-cards #overlay-learning #learning-text #game-canvas #table-toggles #btn-start #btn-mute #home-highscore #over-score #over-coins #over-acc #over-best #btn-again #btn-home`

- [ ] **Step 1: 寫 `index.html`**(此步先接線到假的 Game;Task 6 完成後換真的)

```html
<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>九九小車手</title>
<link rel="manifest" href="manifest.json">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="stylesheet" href="style.css">
</head>
<body>

<section id="screen-home" class="screen">
  <h1>🏎️ 九九小車手</h1>
  <p class="subtitle">開過寫著正確答案的門!</p>
  <div class="panel">
    <p class="panel-title">要練哪幾段?</p>
    <div id="table-toggles"></div>
  </div>
  <button id="btn-start" class="btn-big">出發!</button>
  <p id="home-highscore" class="muted"></p>
  <button id="btn-mute" class="btn-small">🔊</button>
</section>

<section id="screen-game" class="screen hidden">
  <div class="stage">
    <canvas id="game-canvas"></canvas>
    <div class="hud">
      <div class="hud-top">
        <span id="hud-hearts"></span>
        <span id="hud-level"></span>
        <span id="hud-score">0</span>
      </div>
      <div id="hud-question"></div>
      <div class="hud-mid">
        <span id="hud-combo"></span>
        <span id="hud-shields"></span>
      </div>
    </div>
    <div id="overlay-learning" class="overlay hidden">
      <div id="learning-text"></div>
    </div>
    <div id="overlay-upgrade" class="overlay hidden">
      <h2 id="upgrade-title"></h2>
      <div id="upgrade-cards"></div>
    </div>
  </div>
</section>

<section id="screen-over" class="screen hidden">
  <h1>💥 遊戲結束</h1>
  <div class="panel stats">
    <p>分數 <b id="over-score"></b></p>
    <p>金幣 <b id="over-coins"></b></p>
    <p>答對率 <b id="over-acc"></b></p>
    <p class="muted">最高分 <b id="over-best"></b></p>
  </div>
  <button id="btn-again" class="btn-big">再玩一次</button>
  <button id="btn-home" class="btn-small">回首頁</button>
</section>

<script type="module">
import { QuestionEngine } from './js/questions.js';
import { UpgradeState, HEART_REFILL } from './js/upgrades.js';
import { createStorage, safeLocalStorage } from './js/storage.js';
import { GameAudio } from './js/audio.js';
import { Game } from './js/game.js';

const $ = (id) => document.getElementById(id);
const storage = createStorage(safeLocalStorage());
const audio = new GameAudio();
let settings = storage.loadSettings();
let game = null;
let upgrades = null;
let engine = null;

audio.setMuted(settings.muted);
document.addEventListener('pointerdown', () => audio.unlock(), { once: true });

// ---- 首頁:選段 ----
function renderToggles() {
  const box = $('table-toggles');
  box.innerHTML = '';
  for (let n = 1; n <= 9; n++) {
    const b = document.createElement('button');
    b.className = 'toggle' + (settings.tables.includes(n) ? ' on' : '');
    b.textContent = n;
    b.onclick = () => {
      audio.click();
      const i = settings.tables.indexOf(n);
      if (i >= 0) { if (settings.tables.length > 1) settings.tables.splice(i, 1); }
      else settings.tables.push(n);
      settings.tables.sort((x, y) => x - y);
      storage.saveSettings(settings);
      renderToggles();
    };
    box.appendChild(b);
  }
}
renderToggles();
$('home-highscore').textContent = `最高分:${storage.loadHighScore()}`;

$('btn-mute').onclick = () => {
  settings.muted = !settings.muted;
  audio.setMuted(settings.muted);
  storage.saveSettings(settings);
  $('btn-mute').textContent = settings.muted ? '🔇' : '🔊';
};
$('btn-mute').textContent = settings.muted ? '🔇' : '🔊';

// ---- 畫面切換 ----
function show(id) {
  for (const s of ['screen-home', 'screen-game', 'screen-over']) $(s).classList.add('hidden');
  $(id).classList.remove('hidden');
}

// ---- UI 契約(給 Game 呼叫)----
const ui = {
  setQuestion: (t) => { $('hud-question').textContent = t; },
  setScore: (n) => { $('hud-score').textContent = n; },
  setHearts: (n) => { $('hud-hearts').textContent = '❤️'.repeat(n) + '🖤'.repeat(Math.max(0, 3 - n)); },
  setCombo: (n) => { $('hud-combo').textContent = n >= 2 ? `🔥 連擊 ×${Math.min(n, 5)}` : ''; },
  setLevel: (n) => { $('hud-level').textContent = `第 ${n} 關`; },
  setShields: (n) => { $('hud-shields').textContent = '🛡️'.repeat(n); },
  showLearning: (t) => { $('learning-text').textContent = t; $('overlay-learning').classList.remove('hidden'); },
  hideLearning: () => { $('overlay-learning').classList.add('hidden'); },
  levelComplete: (level) => {
    $('upgrade-title').textContent = `🎉 進入第 ${level} 關!選一個強化`;
    const cards = $('upgrade-cards');
    cards.innerHTML = '';
    for (const c of upgrades.drawChoices()) {
      const el = document.createElement('button');
      el.className = 'card';
      el.innerHTML = `<span class="card-emoji">${c.emoji}</span><span class="card-name">${c.name}</span><span class="card-desc">${c.desc}</span>`;
      el.onclick = () => {
        audio.click();
        if (c.id === HEART_REFILL.id) game.refillHeart();
        else upgrades.apply(c.id);
        $('overlay-upgrade').classList.add('hidden');
        game.resumeAfterUpgrade();
      };
      cards.appendChild(el);
    }
    $('overlay-upgrade').classList.remove('hidden');
  },
  gameOver: (stats) => {
    const best = Math.max(stats.score, storage.loadHighScore());
    storage.saveHighScore(best);
    $('over-score').textContent = stats.score;
    $('over-coins').textContent = stats.coins;
    $('over-acc').textContent = stats.total ? `${Math.round(stats.correct / stats.total * 100)}%` : '—';
    $('over-best').textContent = best;
    game.destroy();
    game = null;
    show('screen-over');
  },
};

// ---- 開始遊戲 ----
function startGame() {
  engine = new QuestionEngine({ tables: settings.tables, reviewState: storage.loadReview() });
  const origReport = engine.report.bind(engine);
  engine.report = (q, ok) => { origReport(q, ok); storage.saveReview(engine.getReviewState()); };
  upgrades = new UpgradeState();
  game = new Game({ canvas: $('game-canvas'), questionEngine: engine, upgrades, audio, ui });
  show('screen-game');
  game.start();
}

$('btn-start').onclick = () => { audio.unlock(); audio.click(); startGame(); };
$('btn-again').onclick = () => { audio.click(); startGame(); };
$('btn-home').onclick = () => {
  audio.click();
  $('home-highscore').textContent = `最高分:${storage.loadHighScore()}`;
  show('screen-home');
};

// ---- PWA ----
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
</script>
</body>
</html>
```

- [ ] **Step 2: 寫 `style.css`**

```css
* { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { height: 100%; overflow: hidden; touch-action: none; overscroll-behavior: none; }
body {
  background: #1b1e27;
  color: #f2f4f8;
  font-family: system-ui, -apple-system, "PingFang TC", sans-serif;
  user-select: none;
  -webkit-user-select: none;
}

.screen {
  height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 24px;
  text-align: center;
}
.hidden { display: none !important; }
h1 { font-size: 44px; }
.subtitle { color: #aab3c5; font-size: 20px; }
.muted { color: #7b8496; }

.panel { background: #262b38; border-radius: 16px; padding: 20px 24px; }
.panel-title { margin-bottom: 12px; font-size: 18px; color: #aab3c5; }
.stats p { font-size: 22px; margin: 8px 0; }
.stats b { font-size: 28px; color: #ffd34d; margin-left: 8px; }

#table-toggles { display: grid; grid-template-columns: repeat(3, 72px); gap: 10px; }
.toggle {
  height: 64px; font-size: 28px; font-weight: 700;
  border: 3px solid #3a4152; border-radius: 14px;
  background: #1f2430; color: #7b8496;
}
.toggle.on { background: #2f6fed; border-color: #5b93ff; color: #fff; }

.btn-big {
  font-size: 28px; font-weight: 800; padding: 18px 56px;
  border: 0; border-radius: 18px; background: #2f6fed; color: #fff;
  box-shadow: 0 6px 0 #1d4dbb;
}
.btn-big:active { transform: translateY(4px); box-shadow: 0 2px 0 #1d4dbb; }
.btn-small {
  font-size: 18px; padding: 10px 22px;
  border: 2px solid #3a4152; border-radius: 12px; background: #262b38; color: #f2f4f8;
}

#screen-game { padding: 0; }
.stage {
  position: relative;
  height: 100dvh;
  aspect-ratio: 480 / 800;
  max-width: 100vw;
  margin: 0 auto;
}
#game-canvas { width: 100%; height: 100%; display: block; }

.hud { position: absolute; inset: 0; pointer-events: none; display: flex; flex-direction: column; }
.hud-top {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 16px; font-size: 20px; font-weight: 700;
  text-shadow: 0 2px 4px rgba(0,0,0,.5);
}
#hud-score { color: #ffd34d; font-size: 26px; }
#hud-question {
  margin: 4px auto 0; padding: 10px 28px;
  background: rgba(20, 24, 33, .82); border-radius: 999px;
  font-size: 34px; font-weight: 800; letter-spacing: 2px;
}
.hud-mid { display: flex; justify-content: space-between; padding: 10px 16px; font-size: 20px; }
#hud-combo { color: #ff9f43; font-weight: 800; }

.overlay {
  position: absolute; inset: 0; z-index: 5;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px;
  background: rgba(15, 18, 26, .78);
  text-align: center; padding: 24px;
}
#overlay-learning { background: rgba(15, 18, 26, .6); pointer-events: none; }
#learning-text {
  font-size: 56px; font-weight: 900; color: #ffd34d;
  text-shadow: 0 4px 12px rgba(0,0,0,.6);
}
#overlay-upgrade h2 { font-size: 26px; }
#upgrade-cards { display: flex; flex-direction: column; gap: 14px; width: min(340px, 86%); }
.card {
  display: grid; grid-template-columns: 56px 1fr; grid-template-rows: auto auto;
  align-items: center; text-align: left; gap: 2px 12px;
  padding: 14px 18px; border: 3px solid #3a4152; border-radius: 16px;
  background: #262b38; color: #f2f4f8;
}
.card:active { border-color: #5b93ff; background: #2b3345; }
.card-emoji { grid-row: 1 / span 2; font-size: 40px; }
.card-name { font-size: 22px; font-weight: 800; }
.card-desc { font-size: 15px; color: #aab3c5; }
```

- [ ] **Step 3: 手動驗證骨架** — 起本機伺服器 `python3 -m http.server 8788`(背景),開 `http://localhost:8788`:首頁顯示、選段可切換且重新整理後記住、靜音鈕切換。此時按「出發」會因 `js/game.js` 不存在而 console 報錯 — 預期,Task 6 補上。

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: 畫面骨架與 UI 接線"`

---

### Task 6: game.js 核心遊戲迴圈

**Files:**
- Create: `js/game.js`

**Interfaces:**
- Consumes:`QuestionEngine`(`next()/report()/stats`)、`UpgradeState`(`magnet/shields/slow/consumeShield()/coinValue()/scoreMultiplier()/onLevelComplete()`)、`GameAudio`、Task 5 的 `ui` 契約
- Produces:`class Game`:
  - `constructor({ canvas, questionEngine, upgrades, audio, ui, rand? })`
  - `start()` — 重置狀態並啟動 rAF 迴圈
  - `destroy()` — 停止迴圈、卸載事件
  - `resumeAfterUpgrade()` — 升級選完後恢復
  - `refillHeart()` — 愛心補給(上限 3)

- [ ] **Step 1: 實作 `js/game.js`**(完整檔案)

```js
// 遊戲迴圈與 Canvas 繪製。狀態機:running → learning(慢動作) → upgrade(暫停) → over。

export const LOGICAL_W = 480;
export const LOGICAL_H = 800;

const LANE_COUNT = 3;
const ROAD_X = 40;
const ROAD_W = LOGICAL_W - ROAD_X * 2;
const LANE_W = ROAD_W / LANE_COUNT;
const BASE_SPEED = 260;               // px/s,第一關
const SPEED_GROWTH = 1.08;            // 每關 +8%
const SPEED_CAP = 2;                  // 上限 2 倍
const WALL_SPACING = BASE_SPEED * 4;  // 門間固定距離(基礎速度約 4 秒)
const GATES_PER_LEVEL = 10;
const CAR_Y = LOGICAL_H * 0.75;
const LANE_TWEEN_SEC = 0.15;
const LEARN_SEC = 2;
const LEARN_TIMESCALE = 0.25;
const MAX_HEARTS = 3;
const COIN_R = 16;
const CAR_W = 64;
const CAR_H = 100;

const laneCenter = (lane) => ROAD_X + LANE_W * lane + LANE_W / 2;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class Game {
  constructor({ canvas, questionEngine, upgrades, audio, ui, rand = Math.random }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = questionEngine;
    this.upgrades = upgrades;
    this.audio = audio;
    this.ui = ui;
    this.rand = rand;
    this.raf = 0;
    this.state = 'over';
    this.#fitCanvas();
    this.onResize = () => this.#fitCanvas();
    this.onPointer = (e) => this.#handlePointer(e);
    this.onKey = (e) => this.#handleKey(e);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKey);
    canvas.addEventListener('pointerdown', this.onPointer);
  }

  start() {
    this.state = 'running';
    this.score = 0;
    this.coins = 0;
    this.combo = 0;
    this.hearts = MAX_HEARTS;
    this.level = 1;
    this.gatesPassed = 0;
    this.pendingLevelUp = false;
    this.targetLane = 1;
    this.carX = laneCenter(1);
    this.walls = [];
    this.coinItems = [];
    this.particles = [];
    this.distToWall = WALL_SPACING * 0.6; // 開場緩衝
    this.dashOffset = 0;
    this.learnTimer = 0;
    this.ui.setScore(0);
    this.ui.setHearts(this.hearts);
    this.ui.setCombo(0);
    this.ui.setLevel(1);
    this.ui.setShields(this.upgrades.shields);
    this.ui.setQuestion('準備!');
    this.audio.startEngine();
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      this.#update(dt);
      this.#draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKey);
    this.canvas.removeEventListener('pointerdown', this.onPointer);
    this.audio.stopEngine();
  }

  resumeAfterUpgrade() {
    if (this.state !== 'upgrade') return;
    this.ui.setShields(this.upgrades.shields);
    this.state = 'running';
  }

  refillHeart() {
    this.hearts = Math.min(MAX_HEARTS, this.hearts + 1);
    this.ui.setHearts(this.hearts);
  }

  // ---- 輸入 ----

  #handlePointer(e) {
    if (this.state !== 'running' && this.state !== 'learning') return;
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * LOGICAL_W;
    this.targetLane = Math.max(0, Math.min(2, Math.floor((x - ROAD_X) / LANE_W)));
  }

  #handleKey(e) {
    if (e.key === 'ArrowLeft') this.targetLane = Math.max(0, this.targetLane - 1);
    if (e.key === 'ArrowRight') this.targetLane = Math.min(2, this.targetLane + 1);
  }

  // ---- 更新 ----

  #speed() {
    if (this.upgrades.slow) return BASE_SPEED;
    return BASE_SPEED * Math.min(SPEED_CAP, SPEED_GROWTH ** (this.level - 1));
  }

  #update(dt) {
    if (this.state === 'upgrade' || this.state === 'over') return;
    let scale = 1;
    if (this.state === 'learning') {
      scale = LEARN_TIMESCALE;
      this.learnTimer -= dt;
      if (this.learnTimer <= 0) {
        this.ui.hideLearning();
        if (this.hearts <= 0) { this.#gameOver(); return; }
        if (this.pendingLevelUp) { this.pendingLevelUp = false; this.#levelComplete(); return; }
        this.state = 'running';
      }
    }
    const scroll = this.#speed() * scale * dt;
    this.dashOffset = (this.dashOffset + scroll) % 80;

    // 車道補間(碰撞以 targetLane 判定 — 對小朋友寬容:點了就算)
    const targetX = laneCenter(this.targetLane);
    this.carX += (targetX - this.carX) * Math.min(1, dt / LANE_TWEEN_SEC);

    this.distToWall -= scroll;
    if (this.distToWall <= 0) {
      this.#spawnWall();
      this.distToWall += WALL_SPACING;
    }

    for (const w of this.walls) w.y += scroll;
    for (const c of this.coinItems) c.y += scroll;

    for (const w of this.walls) {
      if (!w.resolved && w.y >= CAR_Y - CAR_H / 2) {
        w.resolved = true;
        w.hitLane = this.targetLane;
        this.#resolveWall(w);
      }
    }

    const magnetRange = this.upgrades.magnet ? 1 : 0;
    for (const c of this.coinItems) {
      if (c.taken) continue;
      if (Math.abs(c.y - CAR_Y) < 40 && Math.abs(c.lane - this.targetLane) <= magnetRange) {
        c.taken = true;
        this.score += this.upgrades.coinValue();
        this.coins += 1;
        this.ui.setScore(this.score);
        this.audio.coin();
        this.#burst(laneCenter(c.lane), c.y, '#ffd34d', 6);
      }
    }

    this.walls = this.walls.filter((w) => w.y < LOGICAL_H + 120);
    this.coinItems = this.coinItems.filter((c) => !c.taken && c.y < LOGICAL_H + 40);

    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  #spawnWall() {
    const q = this.engine.next();
    this.walls.push({ y: -60, q, resolved: false, hitLane: -1 });
    this.ui.setQuestion(`${q.a} × ${q.b} = ?`);
    // 門後方(較晚進畫面)的路段生金幣串
    const zigzag = this.rand() < 0.4;
    const count = 4 + Math.floor(this.rand() * 3);
    let lane = Math.floor(this.rand() * 3);
    for (let i = 0; i < count; i++) {
      if (zigzag && this.rand() < 0.5) lane = Math.max(0, Math.min(2, lane + (this.rand() < 0.5 ? -1 : 1)));
      this.coinItems.push({ lane, y: -60 - WALL_SPACING * 0.3 - i * 70, taken: false });
    }
  }

  #resolveWall(w) {
    const q = w.q;
    const correct = w.hitLane === q.correctIndex;
    this.gatesPassed += 1;
    this.engine.report(q, correct);
    if (correct) {
      this.combo += 1;
      this.score += 100 * Math.min(this.combo, 5) * this.upgrades.scoreMultiplier();
      this.ui.setScore(this.score);
      this.ui.setCombo(this.combo);
      this.audio.correct();
      this.#burst(this.carX, CAR_Y - 60, '#7ce38b', 14);
      if (this.gatesPassed >= GATES_PER_LEVEL) this.#levelComplete();
      return;
    }
    const blocked = this.upgrades.consumeShield();
    this.ui.setShields(this.upgrades.shields);
    if (blocked) {
      this.audio.click();
      this.#burst(this.carX, CAR_Y - 60, '#7fd0ff', 14);
    } else {
      this.hearts -= 1;
      this.combo = 0;
      this.ui.setHearts(this.hearts);
      this.ui.setCombo(0);
      this.audio.wrong();
      this.#burst(this.carX, CAR_Y - 60, '#ff6b6b', 14);
    }
    // 學習時刻:慢動作 + 大字正解(護盾擋下也照樣顯示,學習不打折)
    this.state = 'learning';
    this.learnTimer = LEARN_SEC;
    this.ui.showLearning(`${q.a} × ${q.b} = ${q.answer}`);
    if (this.gatesPassed >= GATES_PER_LEVEL) this.pendingLevelUp = true;
  }

  #levelComplete() {
    this.gatesPassed = 0;
    this.level += 1;
    this.upgrades.onLevelComplete(); // 先清單關效果,再抽新選項
    this.state = 'upgrade';
    this.ui.setLevel(this.level);
    this.audio.levelUp();
    this.ui.levelComplete(this.level);
  }

  #gameOver() {
    this.state = 'over';
    this.audio.stopEngine();
    this.audio.gameOver();
    const { correct, total } = this.engine.stats;
    this.ui.gameOver({ score: this.score, coins: this.coins, correct, total });
  }

  #burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const ang = this.rand() * Math.PI * 2;
      const sp = 80 + this.rand() * 160;
      this.particles.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0.4 + this.rand() * 0.3, color });
    }
  }

  // ---- 繪製 ----

  #fitCanvas() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = LOGICAL_W * dpr;
    this.canvas.height = LOGICAL_H * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  #draw() {
    const ctx = this.ctx;
    ctx.fillStyle = '#58b368';
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    ctx.fillStyle = '#4a4e5a';
    ctx.fillRect(ROAD_X - 10, 0, ROAD_W + 20, LOGICAL_H);
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(ROAD_X - 10, 0, 6, LOGICAL_H);
    ctx.fillRect(ROAD_X + ROAD_W + 4, 0, 6, LOGICAL_H);

    ctx.strokeStyle = 'rgba(255,255,255,.7)';
    ctx.lineWidth = 6;
    ctx.setLineDash([40, 40]);
    ctx.lineDashOffset = -this.dashOffset;
    for (let i = 1; i < LANE_COUNT; i++) {
      const x = ROAD_X + LANE_W * i;
      ctx.beginPath();
      ctx.moveTo(x, -40);
      ctx.lineTo(x, LOGICAL_H + 40);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    for (const c of this.coinItems) {
      if (c.taken) continue;
      const x = laneCenter(c.lane);
      ctx.fillStyle = '#f7b731';
      ctx.beginPath();
      ctx.arc(x, c.y, COIN_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffe28a';
      ctx.beginPath();
      ctx.arc(x, c.y, COIN_R - 6, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const w of this.walls) this.#drawWall(w);
    this.#drawCar();

    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(p.life / 0.7, 0);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
    }
    ctx.globalAlpha = 1;
  }

  #drawWall(w) {
    const ctx = this.ctx;
    for (let i = 0; i < LANE_COUNT; i++) {
      const x = laneCenter(i);
      let plate = '#ffffff';
      if (w.resolved) {
        if (i === w.q.correctIndex) plate = '#7ce38b';
        else if (i === w.hitLane) plate = '#ff8787';
      }
      ctx.fillStyle = '#4a7bd0';
      ctx.fillRect(x - LANE_W / 2 + 8, w.y - 26, LANE_W - 16, 52);
      ctx.fillStyle = plate;
      ctx.fillRect(x - LANE_W / 2 + 14, w.y - 20, LANE_W - 28, 40);
      ctx.fillStyle = '#2b3856';
      ctx.font = 'bold 30px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(w.q.choices[i]), x, w.y);
    }
  }

  #drawCar() {
    const ctx = this.ctx;
    const x = this.carX;
    const y = CAR_Y;
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath();
    ctx.ellipse(x, y + CAR_H / 2 - 6, CAR_W / 2 + 6, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1f2430';
    for (const [dx, dy] of [
      [-CAR_W / 2, -CAR_H / 2 + 12], [CAR_W / 2 - 10, -CAR_H / 2 + 12],
      [-CAR_W / 2, CAR_H / 2 - 34], [CAR_W / 2 - 10, CAR_H / 2 - 34],
    ]) ctx.fillRect(x + dx, y + dy, 10, 22);
    ctx.fillStyle = '#e74c3c';
    roundRect(ctx, x - CAR_W / 2 + 6, y - CAR_H / 2, CAR_W - 12, CAR_H, 14);
    ctx.fill();
    ctx.fillStyle = '#aee3ff';
    roundRect(ctx, x - CAR_W / 2 + 14, y - CAR_H / 2 + 14, CAR_W - 28, 22, 6);
    ctx.fill();
    ctx.fillStyle = '#c0392b';
    roundRect(ctx, x - CAR_W / 2 + 14, y + 10, CAR_W - 28, 26, 6);
    ctx.fill();
  }
}
```

- [ ] **Step 2: 全部單元測試仍綠** — `node --test tests/`

- [ ] **Step 3: 手動驗證 checklist**(桌機瀏覽器 `http://localhost:8788`,console 無錯誤)
  - 按「出發」進遊戲,路面捲動、車在中道
  - 點左/右車道或方向鍵,車平滑換道
  - 門迎面而來,題目顯示在上方膠囊
  - 開對:綠粒子、分數增加、連擊顯示
  - 開錯:慢動作 + 大字正解 2 秒、愛心 -1
  - 通過 10 排門:升級三選一出現,選一個後繼續且變快
  - 錯 3 次:結算畫面,分數/金幣/答對率/最高分正確
  - 「再玩一次」「回首頁」正常

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: 核心遊戲迴圈與繪製"`

---

### Task 7: PWA(manifest + icons + service worker)

**Files:**
- Create: `manifest.json`, `sw.js`, `icons/icon.svg`, `icons/icon-192.png`, `icons/icon-512.png`, `icons/apple-touch-icon.png`

**Interfaces:**
- Consumes: Task 5 的 `<link rel="manifest">`、`<link rel="apple-touch-icon">`、SW 註冊(已寫好)
- Produces: 可安裝、離線可玩的 PWA

- [ ] **Step 1: 寫 `manifest.json`**

```json
{
  "name": "九九小車手",
  "short_name": "九九小車手",
  "start_url": ".",
  "scope": ".",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#1b1e27",
  "theme_color": "#1b1e27",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 2: 寫 `icons/icon.svg` 並轉 PNG**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#2f6fed"/>
  <rect x="96" y="0" width="16" height="512" fill="#5b93ff" opacity=".5"/>
  <rect x="400" y="0" width="16" height="512" fill="#5b93ff" opacity=".5"/>
  <g>
    <rect x="176" y="200" width="160" height="240" rx="36" fill="#e74c3c"/>
    <rect x="200" y="236" width="112" height="52" rx="14" fill="#aee3ff"/>
    <rect x="200" y="356" width="112" height="56" rx="14" fill="#c0392b"/>
    <rect x="160" y="228" width="24" height="56" rx="8" fill="#1f2430"/>
    <rect x="328" y="228" width="24" height="56" rx="8" fill="#1f2430"/>
    <rect x="160" y="364" width="24" height="56" rx="8" fill="#1f2430"/>
    <rect x="328" y="364" width="24" height="56" rx="8" fill="#1f2430"/>
  </g>
  <text x="256" y="140" font-family="Arial, sans-serif" font-size="96" font-weight="900" fill="#ffffff" text-anchor="middle">9×9</text>
</svg>
```

轉檔(macOS 內建 qlmanage 渲染 SVG;若失敗改用任何可用瀏覽器截圖):
```bash
cd icons && qlmanage -t -s 512 -o . icon.svg && mv icon.svg.png icon-512.png
sips -z 192 192 icon-512.png --out icon-192.png
sips -z 180 180 icon-512.png --out apple-touch-icon.png
```

- [ ] **Step 3: 寫 `sw.js`**

```js
const CACHE = '99racer-v1';
const ASSETS = [
  './', './index.html', './style.css',
  './js/questions.js', './js/upgrades.js', './js/game.js', './js/audio.js', './js/storage.js',
  './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
```

- [ ] **Step 4: 驗證** — 本機伺服器重新載入兩次,DevTools/Network 確認第二次由 SW 供應;或 `curl -s localhost:8788/sw.js` 確認可取。單元測試仍綠。

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: PWA manifest、圖示與 service worker"`

---

### Task 8: README + 部署到 GitHub Pages

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: 全部前置 task
- Produces: 線上網址 `https://<owner>.github.io/9x9/`

- [ ] **Step 1: 寫 `README.md`**

```markdown
# 九九小車手 🏎️

給小朋友的九九乘法表練習遊戲:開車過門,開過寫著正確答案的門!

- **玩**:https://<owner>.github.io/9x9/ (部署後把 <owner> 換成實際帳號)
- **iPad**:Safari 開啟 → 分享 → 加入主畫面,即可全螢幕離線遊玩
- 答錯的題目會自動加強複習(存在裝置上)
- 首頁可勾選要練習的段(預設 2、3、5)

## 開發

零相依、零 build。本機跑:`python3 -m http.server 8788`
測試:`npm test`(node --test)

改版部署:改檔案 → bump `sw.js` 的 `CACHE` 版本 → push 到 main。
```

- [ ] **Step 2: 最終全測試** — `node --test tests/` 全綠

- [ ] **Step 3: 建 repo 並推上去**

```bash
gh auth status
gh repo create 9x9 --public --source . --push
```

- [ ] **Step 4: 開啟 GitHub Pages**(owner 以 `gh api user -q .login` 取得)

```bash
gh api -X POST "repos/$(gh api user -q .login)/9x9/pages" -f "source[branch]=main" -f "source[path]=/"
```

若回 409(已存在)視為成功。

- [ ] **Step 5: 更新 README 的 owner 佔位、commit、push**

- [ ] **Step 6: 輪詢驗證上線**(背景執行,不佔前景;Pages 首次建置約 1-3 分鐘)

```bash
until curl -sf -o /dev/null "https://<owner>.github.io/9x9/"; do sleep 15; done; curl -s "https://<owner>.github.io/9x9/" | head -5
```

確認回應含 `九九小車手`。

- [ ] **Step 7: 線上煙霧測試** — `curl` 檢查 `index.html`、`js/game.js`、`manifest.json`、`sw.js`、`icons/icon-192.png` 皆 200。

---

## Self-Review 紀錄

- Spec 覆蓋:選段(Task 5 toggles)、干擾項/複習佇列(Task 2)、升級池含補位(Task 3)、慢動作學習時刻/連擊/關卡加速(Task 6)、PWA 離線(Task 7)、$0 部署(Task 8)——全數對應。
- 型別一致性:`ui` 契約在 Task 5 定義、Task 6 消費,方法名逐一核對;`UpgradeState` 屬性 `shields/magnet/slow` 與 game.js 用法一致;`HEART_REFILL.id === 'heart'` 由 index.html 分流到 `game.refillHeart()`。
- 已知取捨:碰撞以 `targetLane` 判定(點了就算),對小朋友寬容;護盾擋下仍顯示學習時刻。
