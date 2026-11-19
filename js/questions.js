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

  // 只出勾選的段:未勾選段的複習項目保留在存檔裡(之後重新勾選時再複習),但這局不出、也不倒數
  #active(r) { return this.tables.includes(r.a); }

  next() {
    for (const r of this.review) if (r.dueIn !== SERVING && this.#active(r)) r.dueIn -= 1;
    const due = this.review.find((r) => r.dueIn <= 0 && this.#active(r));
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
