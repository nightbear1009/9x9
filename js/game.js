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
