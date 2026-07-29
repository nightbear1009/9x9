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
