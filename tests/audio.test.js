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
