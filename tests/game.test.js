import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QuestionEngine } from '../js/questions.js';
import { UpgradeState } from '../js/upgrades.js';
import { Game, SPEED_PRESETS } from '../js/game.js';

// 最小的瀏覽器替身:畫布什麼都不畫,requestAnimationFrame 由測試手動推進
function makeEnv() {
  const frames = [];
  const noop = () => {};
  const ctx = new Proxy({}, { get: () => noop, set: () => true });
  globalThis.window = { addEventListener: noop, removeEventListener: noop, devicePixelRatio: 1 };
  globalThis.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
  globalThis.cancelAnimationFrame = noop;
  const canvas = {
    getContext: () => ctx, addEventListener: noop, removeEventListener: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 480, height: 800 }),
  };
  let now = performance.now();
  const step = (n = 1) => { for (let i = 0; i < n; i++) { now += 40; frames.shift()(now); } };
  return { canvas, step };
}

function makeUi(log) {
  const noop = () => {};
  return {
    setQuestion: noop, setScore: noop, setHearts: noop, setCombo: noop, setLevel: noop, setShields: noop,
    showLearning: noop, hideLearning: noop,
    levelComplete: (level) => log.levelUps.push(level),
    gameOver: (stats) => { log.over = stats; },
  };
}

const audio = new Proxy({}, { get: () => () => {} });

// 每一幀都把車道對準正確答案;practice 時另外送出「出發」
function playCorrectly(game, env, { gates, practice }) {
  let guard = 0;
  while (game.gatesPassed < gates && game.level === 1 && guard++ < 5000) {
    const pending = game.walls.find((w) => !w.resolved);
    if (pending) {
      game.targetLane = pending.q.correctIndex;
      if (practice) game.onKey({ key: 'Enter' });
    }
    env.step();
  }
}

test('用點的:答對會拿到金幣,過 10 道門出現強化三選一', () => {
  const env = makeEnv();
  const log = { levelUps: [], over: null };
  const upgrades = new UpgradeState(Math.random, { exclude: ['slow', 'magnet'] });
  const game = new Game({
    canvas: env.canvas, questionEngine: new QuestionEngine({ tables: [2, 3] }), upgrades, audio,
    ui: makeUi(log), baseSpeed: SPEED_PRESETS.slow, practice: true,
  });
  game.start();
  playCorrectly(game, env, { gates: 10, practice: true });
  assert.deepEqual(log.levelUps, [2]);
  assert.equal(game.state, 'upgrade');
  assert.ok(game.coins >= 9 * 3, `前 9 道門的金幣應已吃到,實際 ${game.coins}`);
  // 選完強化後繼續,最後一串金幣也吃得到,下一題照常停等
  upgrades.apply('shield');
  game.resumeAfterUpgrade();
  env.step(60);
  assert.equal(game.coins, 30);
  assert.equal(game.state, 'running');
  game.destroy();
});

test('用點的:答錯沒有金幣', () => {
  const env = makeEnv();
  const log = { levelUps: [], over: null };
  const game = new Game({
    canvas: env.canvas, questionEngine: new QuestionEngine({ tables: [2, 3] }), upgrades: new UpgradeState(), audio,
    ui: makeUi(log), baseSpeed: SPEED_PRESETS.slow, practice: true,
  });
  game.start();
  let guard = 0;
  while (game.gatesPassed < 1 && guard++ < 2000) {
    const pending = game.walls.find((w) => !w.resolved);
    if (pending) { game.targetLane = (pending.q.correctIndex + 1) % 3; game.onKey({ key: 'Enter' }); }
    env.step();
  }
  env.step(120);
  assert.equal(game.coins, 0);
  assert.equal(game.hearts, 2);
  game.destroy();
});

test('一般檔位:金幣與強化照舊', () => {
  const env = makeEnv();
  const log = { levelUps: [], over: null };
  const game = new Game({
    canvas: env.canvas, questionEngine: new QuestionEngine({ tables: [2, 3] }), upgrades: new UpgradeState(), audio,
    ui: makeUi(log), baseSpeed: SPEED_PRESETS.slow, practice: false,
  });
  game.start();
  playCorrectly(game, env, { gates: 10, practice: false });
  assert.deepEqual(log.levelUps, [2]);
  assert.equal(game.state, 'upgrade');
  game.destroy();
});
