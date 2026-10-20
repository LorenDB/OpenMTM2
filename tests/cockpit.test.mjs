import test from "node:test";
import assert from "node:assert/strict";
import { finderAngle, finderLinedUp, wheelFrame } from "../src/render/cockpit.js";

test("the wheel frame follows the steering in 5 degree steps, left negative, full lock 35", () => {
  assert.equal(wheelFrame(0), "C00");
  assert.equal(wheelFrame(0.01), "C00");
  assert.equal(wheelFrame(-0.45), "L35");
  assert.equal(wheelFrame(0.45), "R35");
  assert.equal(wheelFrame(0.9), "R35");
  assert.equal(wheelFrame(0.45 / 7), "R05");
});

test("the finder: a checkpoint ahead is 90 degrees, to the right 0, whatever the heading", () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);
  near(finderAngle([0, 0, 0], 0, [0, 0, 100]), 90);
  near(finderAngle([0, 0, 0], 0, [100, 0, 0]), 0);
  near(finderAngle([0, 0, 0], Math.PI / 2, [100, 0, 0]), 90);
  near(finderAngle([0, 0, 0], 0, [-100, 0, 0]), 180);
  assert.ok(finderLinedUp(90) && finderLinedUp(70) && !finderLinedUp(60) && !finderLinedUp(120));
});

test("the finder ring's colour and radii come from its art", async () => {
  const { ringShape } = await import("../src/render/cockpit.js");
  const width = 60, height = 60, rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x + 0.5 - 30, y + 0.5 - 30);
      if (d >= 22.1 && d <= 29.9) rgba.set([0, 0, 128, 255], (y * width + x) * 4);
    }
  }
  assert.deepEqual(ringShape({ width, height, rgba: rgba.buffer }), { color: "rgb(0, 0, 128)", inner: 22, outer: 30 });
  assert.deepEqual(ringShape(null), { color: "#000080", inner: 22, outer: 30 });
});
