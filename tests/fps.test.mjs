import test from "node:test";
import assert from "node:assert/strict";
import { createFpsTracker, formatFps } from "../src/game/fps.js";

test("the FPS tracker starts at 60 and holds a steady frame rate", () => {
  const tracker = createFpsTracker();
  assert.equal(Math.round(tracker.fps), 60);
  for (let i = 0; i < 200; i++) tracker.update(1 / 60);
  assert.ok(Math.abs(tracker.fps - 60) < 1);
});

test("the FPS tracker settles toward a new steady frame rate", () => {
  const tracker = createFpsTracker();
  for (let i = 0; i < 200; i++) tracker.update(1 / 30);
  assert.ok(Math.abs(tracker.fps - 30) < 1);
});

test("the FPS tracker ignores a missing or non-positive frame time", () => {
  const tracker = createFpsTracker();
  tracker.update(1 / 60);
  const before = tracker.fps;
  tracker.update(0);
  tracker.update(-1 / 60);
  assert.equal(tracker.fps, before);
});

test("the FPS text shows whole frames per second", () => {
  assert.equal(formatFps(59.6), "60 FPS");
  assert.equal(formatFps(29.4), "29 FPS");
});
