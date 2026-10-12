/*
  The toggleable FPS counter: a small readout in the corner of a race or replay.
  The rate itself is tracked by the pure game/fps.js tracker; this only owns the
  element and its text. The flat screen only: a headset draws to its own display.
*/
import { createFpsTracker, formatFps } from "../game/fps.js";
import { el } from "./dom.js";

export function createFpsCounter({ visible = false } = {}) {
  const element = el("div", { class: "fps-counter", hidden: !visible }, formatFps(60));
  const tracker = createFpsTracker();
  let shown = !!visible;
  return {
    element,
    get visible() { return shown; },
    setVisible(on) {
      shown = !!on;
      element.hidden = !shown;
    },
    toggle() {
      this.setVisible(!shown);
      return shown;
    },
    /** A drawn frame of `dt` seconds: smooth the rate and refresh the text when shown. */
    update(dt) {
      const fps = tracker.update(dt);
      if (shown) element.textContent = formatFps(fps);
      return fps;
    },
  };
}
