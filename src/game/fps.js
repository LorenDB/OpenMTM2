/*
  The frame rate tracker behind the FPS counter. Pure, so it runs under Node.

  Each drawn frame calls `update` with its length in seconds; the rate follows the
  same smoothing the GOLD mode FRAME display uses, so the two agree.
*/

export function createFpsTracker({ initial = 60, smoothing = 0.1 } = {}) {
  let fps = initial;
  return {
    get fps() { return fps; },
    update(dt) {
      if (!(dt > 0)) return fps;
      fps += (1 / dt - fps) * smoothing;
      return fps;
    },
    reset() { fps = initial; },
  };
}

/** The counter text for a rate: whole frames per second. */
export function formatFps(fps) {
  return `${Math.round(fps)} FPS`;
}
