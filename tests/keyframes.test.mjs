import test from "node:test";
import assert from "node:assert/strict";
import { keyframeMorphs, resolveKeyframeModel } from "../src/worker/keyframes.js";
import { keyframeWeights, splineWeights } from "../src/shared/keyframe-spline.js";

const frame = (positions) => ({
  name: "FRAME.BIN", bounds: { min: [0, 0, 0], max: [1, 1, 1] }, textureNames: ["FRAME.RAW"],
  meshes: [{ positions: new Float32Array(positions), normals: new Float32Array(positions.length), uvs: new Float32Array(positions.length / 3 * 2) }],
});

test("animated BIN controls adopt their named frames and keep compatible morphs", async () => {
  const frames = new Map([["A.BIN", frame([0, 0, 0])], ["B.BIN", frame([1, 2, 3])]]);
  const model = await resolveKeyframeModel(
    { name: "CONTROL.BIN", frameNames: ["A.BIN", "B.BIN"], frameSeconds: 0.25, meshes: [] },
    async (name) => frames.get(name),
  );
  assert.equal(model.name, "CONTROL.BIN");
  assert.equal(model.resolvedFrame, "A.BIN");
  assert.equal(model.frameSeconds, 0.25);
  assert.deepEqual(Array.from(model.keyframes[1].meshes[0].positions), [1, 2, 3]);
});

test("frames with different geometry shapes are not used as morph targets", () => {
  assert.equal(keyframeMorphs(frame([0, 0, 0]), [frame([0, 0, 0]), frame([0, 0, 0, 1, 1, 1])]), null);
});

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} is not ${b}`);

test("the game's spline through four frames (0x431960): on a frame it is that frame, between two it overshoots", () => {
  assert.deepEqual(splineWeights(0), [0, 1, 0, 0]);
  [0, 0, 1, 0].forEach((w, i) => close(splineWeights(1)[i], w));
  // Halfway: -1/16, 9/16, 9/16, -1/16.
  [-0.0625, 0.5625, 0.5625, -0.0625].forEach((w, i) => close(splineWeights(0.5)[i], w));
});

test("frames loop on the clock, each lasting the control file's frame time", () => {
  // Four frames of a quarter second (TERYL.BIN): one second a loop.
  assert.deepEqual([...keyframeWeights(0, 4, 0.25)], [1, 0, 0, 0]);
  [0, 0, 1, 0].forEach((w, i) => close(keyframeWeights(0.5, 4, 0.25)[i], w));
  [1, 0, 0, 0].forEach((w, i) => close(keyframeWeights(3, 4, 0.25)[i], w));
  // Between the last frame and the first: the one before is frame 2, the one after the next is frame 1.
  const w = keyframeWeights(0.875, 4, 0.25);
  [0.5625, -0.0625, -0.0625, 0.5625].forEach((x, i) => close(w[i], x));
  close(w.reduce((a, b) => a + b, 0), 1);
  // Two frames: the neighbours fold onto the same two.
  close(keyframeWeights(0.5, 2, 1)[0] + keyframeWeights(0.5, 2, 1)[1], 1);
});
