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
