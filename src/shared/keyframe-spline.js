/*
  How the game plays an animated BIN (MONSTER_EXE_ANALYSIS.md, "Animated models", 0x431960): the
  frames run in a loop on the frame clock, each lasting the time the control file gives, and the
  vertices are a Catmull-Rom spline through four frames: the one before, the current one and the
  two after. Pure.
*/

/** The spline's four weights at `t` (0 to 1) between the current frame and the next: before, current, next, the one after. */
export function splineWeights(t) {
  const t2 = t * t, t3 = t2 * t;
  return [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2];
}

/**
 * Each frame's weight at `clock` seconds, for `frameCount` frames of `frameSeconds` each. The weights add up to 1;
 * some are below 0 or above 1, as a spline's are.
 */
export function keyframeWeights(clock, frameCount, frameSeconds, out = new Float32Array(frameCount)) {
  out.fill(0);
  if (frameCount < 1) return out;
  const span = frameCount * frameSeconds;
  const at = span > 0 ? (((clock % span) + span) % span) / frameSeconds : 0;
  const current = Math.min(frameCount - 1, Math.floor(at));
  const w = splineWeights(at - current);
  const wrap = (k) => ((k % frameCount) + frameCount) % frameCount;
  out[wrap(current - 1)] += w[0];
  out[current] += w[1];
  out[wrap(current + 1)] += w[2];
  out[wrap(current + 2)] += w[3];
  return out;
}

/** The frame time used when a control file gives none, seconds. */
export const DEFAULT_FRAME_SECONDS = 1;
