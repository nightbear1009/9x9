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
  // exclude:這局不會抽到的強化 id(練習模式「用點的」沒有車速與選道,排除慢速門與磁鐵)
  constructor(rand = Math.random, { exclude = [] } = {}) {
    this.rand = rand;
    this.exclude = new Set(exclude);
    this.magnet = false;
    this.coinBonus = false;
    this.shields = 0;
    this.doubleScore = false;
    this.slow = false;
  }

  drawChoices() {
    const all = [UPGRADES.double_score, UPGRADES.slow];
    if (!this.magnet) all.push(UPGRADES.magnet);
    if (this.shields < MAX_SHIELDS) all.push(UPGRADES.shield);
    if (!this.coinBonus) all.push(UPGRADES.coin_bonus);
    const pool = all.filter((u) => !this.exclude.has(u.id));
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
