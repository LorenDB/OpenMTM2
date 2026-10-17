/*
  Summit Rumble's scoring sounds (MONSTER_EXE_ANALYSIS.md 6.3, 0x42a090).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { SUMMIT_CUES, createSummitSounds, summitCue } from "../src/game/summit-sounds.js";

test("a knock-off buzzes BUZZER3 at 1.4, a point lost BUZZ3 at 1.5, ten won SHUTTER at 1.25", () => {
  assert.equal(summitCue(null, 0), null);
  assert.equal(summitCue(10, 10), null);
  assert.equal(summitCue(0, 10), "score");
  assert.equal(summitCue(10, 9), "lose");
  assert.equal(summitCue(10, -40), "knock");
  assert.equal(summitCue(10, -41), "knock");
  assert.deepEqual([SUMMIT_CUES.knock.sample, SUMMIT_CUES.knock.gain], ["BUZZER3", 1.4]);
  assert.deepEqual([SUMMIT_CUES.lose.sample, SUMMIT_CUES.lose.gain], ["BUZZ3", 1.5]);
  assert.deepEqual([SUMMIT_CUES.score.sample, SUMMIT_CUES.score.gain], ["SHUTTER", 1.25]);
});

test("one handle: a knock-off cuts the last cue short, the others wait for it to end", async () => {
  const voices = [];
  const play = (sample) => { const v = { sample, stopped: false, stop() { this.stopped = true; } }; voices.push(v); return Promise.resolve(v); };
  const sounds = createSummitSounds(play);
  sounds.update(0);
  assert.equal(sounds.update(10), "score");
  await Promise.resolve();
  assert.equal(sounds.update(20), null, "skipped while the shutter plays");
  assert.equal(sounds.update(-30), "knock");
  assert.equal(voices[0].stopped, true);
  await Promise.resolve();
  voices[1].stopped = true;
  assert.equal(sounds.update(-31), "lose");
  assert.deepEqual(voices.map((v) => v.sample), ["SHUTTER", "BUZZER3", "BUZZ3"]);
});
