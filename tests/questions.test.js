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
  // 複習項目 9×7 在勾選的段 [2, 9] 裡(沒勾選的段不出題,見下方測試)
  const e = new QuestionEngine({ tables: [2, 9], reviewState: [{ a: 9, b: 7, streak: 0, dueIn: 1 }], rand: lcg(3) });
  const q1 = e.next();
  assert.ok(q1.isReview);
  assert.equal(q1.a, 9);
  assert.equal(q1.b, 7);
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

test('沒勾選的段不會從複習佇列出題,存檔仍保留', () => {
  const reviewState = [
    { a: 7, b: 8, streak: 0, dueIn: 1 },
    { a: 9, b: 6, streak: 0, dueIn: 0 },
  ];
  const engine = new QuestionEngine({ tables: [2, 3], reviewState });
  for (let i = 0; i < 200; i++) {
    const q = engine.next();
    assert.ok([2, 3].includes(q.a), `出了沒勾選的段:${q.a} × ${q.b}`);
    engine.report(q, true);
  }
  const saved = engine.getReviewState();
  assert.ok(saved.some((r) => r.a === 7 && r.b === 8));
  assert.ok(saved.some((r) => r.a === 9 && r.b === 6));
});

test('重新勾選後,該段的複習題會再出現', () => {
  const engine = new QuestionEngine({ tables: [7], reviewState: [{ a: 7, b: 8, streak: 0, dueIn: 1 }] });
  const q = engine.next();
  assert.deepEqual([q.a, q.b, q.isReview], [7, 8, true]);
});
