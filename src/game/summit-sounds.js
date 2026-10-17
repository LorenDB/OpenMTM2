/*
  Summit Rumble's scoring sounds (MONSTER_EXE_ANALYSIS.md 6.3, 0x42a090): what the player's score change
  calls for. Pure, so it runs under Node.
*/
import { SUMMIT_KNOCK_OFF } from "../vendor/openphotex/sim/mtm2/race/summit.js";

/** Each cue's sample (SOUND\<name>.WAV), its gain, and whether it cuts the last cue short or waits for it to end. */
export const SUMMIT_CUES = Object.freeze({
  knock: Object.freeze({ sample: "BUZZER3", gain: 1.4, interrupts: true }),
  lose: Object.freeze({ sample: "BUZZ3", gain: 1.5, interrupts: false }),
  score: Object.freeze({ sample: "SHUTTER", gain: 1.25, interrupts: false }),
});

/**
 * The cue a score change calls for: a knock-off (a fall of 50 or more, a point off the summit perhaps
 * counted in the same tick), a point lost, ten won, or null when the score stands.
 */
export function summitCue(previous, score) {
  if (previous === null || previous === undefined || score === previous) return null;
  if (score > previous) return "score";
  return previous - score >= SUMMIT_KNOCK_OFF ? "knock" : "lose";
}

/**
 * The player of the cues: `play(sample, { gain })` resolves to a voice `{ stopped, stop }`. The game keeps one
 * handle: a knock-off stops the last cue, the others are skipped while it still plays.
 */
export function createSummitSounds(play) {
  let last = null, current = null;
  const playing = (rec) => !!rec && !rec.cancelled && !rec.ended && !(rec.voice?.stopped);
  return {
    /** The player's score this frame; returns the cue played, or null. */
    update(score) {
      const cue = summitCue(last, score);
      last = score;
      if (!cue) return null;
      const spec = SUMMIT_CUES[cue];
      if (playing(current)) {
        if (!spec.interrupts) return null;
        current.cancelled = true;
        current.voice?.stop();
      }
      const rec = { voice: null, cancelled: false, ended: false };
      current = rec;
      Promise.resolve(play(spec.sample, { gain: spec.gain })).then((voice) => {
        if (!voice) { rec.ended = true; return; }
        if (rec.cancelled) voice.stop(); else rec.voice = voice;
      }, () => { rec.ended = true; });
      return cue;
    },
  };
}
