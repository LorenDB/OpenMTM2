import test from "node:test";
import assert from "node:assert/strict";
import {
  MARKED_CELLS, PARTICLE_POOL, createGroundMarks, createParticlePool, groundTexel, particleVelocity, takesTracks, throwsParticles, trackTexels, trackWidth,
} from "../src/game/mtm1-particles.js";

test("MTM1's surface flags (0x4300c0): every soft surface throws, cement does not; tracks on dirt, mud, grass, gravel, snow", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 9].map(throwsParticles), [false, true, true, true, true, true, true, true]);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 9].map(takesTracks), [false, true, false, true, false, true, true, true]);
});

test("a particle leaves at 0.9 to 1.1 of the tire's velocity across and 0.5 to 1.5 up, falls, and marks where it lands", () => {
  const low = particleVelocity([10, 10, 10], () => 0), high = particleVelocity([10, 10, 10], () => 0.999999);
  assert.deepEqual(low.map((v) => +v.toFixed(3)), [9, 5, 9]);
  assert.ok(high[1] > 14.99 && high[0] > 10.99);
  const pool = createParticlePool();
  pool.throw([0, 1, 0], [0, 4, 0], [10, 20, 30]);
  const landed = [];
  for (let t = 0; t < 2; t += 1 / 30) pool.step(1 / 30, () => 0, (x, z, colour) => landed.push(colour));
  assert.deepEqual(landed, [[10, 20, 30]]);
  // A ring: the 257th takes the first's place.
  const ring = createParticlePool();
  for (let i = 0; i <= PARTICLE_POOL; i++) ring.throw([0, 9, 0], [0, 0, 0], [i, 0, 0]);
  assert.equal(ring.particles[0].colour[0], PARTICLE_POOL);
});

test("a track step is a Bresenham line as wide as the tire, and a jump draws nothing", () => {
  const texels = trackTexels(0, 0, 4, 0, 3);
  assert.equal(texels.length, 15);
  assert.deepEqual(texels.slice(0, 3), [[0, -1], [0, 0], [0, 1]]);
  assert.deepEqual(trackTexels(0, 0, 40, 0, 2), []);
});

test("only 32 cells keep their marks: the 33rd takes the oldest's away", () => {
  const dropped = [];
  const marks = createGroundMarks({ onDrop: (cell) => dropped.push(cell.key) });
  for (let i = 0; i <= MARKED_CELLS; i++) marks.mark(i * 32 + 1, 1, [255, 0, 0]);
  assert.equal(marks.cells.size, MARKED_CELLS);
  assert.deepEqual(dropped, [0]);
  const cell = marks.mark(5, 40);
  assert.ok(cell.rgba[(8 * 32 + 5) * 4 + 3] > 0, "a darkened texel");
});

test("the ground's texel follows the cell's tile in the atlas", () => {
  // Two 2x2 tiles side by side, no padding: slot 0 red, slot 1 green.
  const rgba = new Uint8ClampedArray(4 * 2 * 4);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) rgba.set(x < 2 ? [255, 0, 0, 255] : [0, 255, 0, 255], (y * 4 + x) * 4);
  const atlas = { rgba, width: 4, height: 2, tileSide: 2, padding: 0, slots: 2 };
  const clr = new Uint16Array(256 * 256);
  clr[1] = 1;
  assert.deepEqual(groundTexel(atlas, clr, 5, 5), [255, 0, 0]);
  assert.deepEqual(groundTexel(atlas, clr, 40, 5), [0, 255, 0]);
});

test("a track is as many texels wide as the tire's radius, cut to a whole number (0x433d0f), not the tire's width", () => {
  assert.equal(trackWidth(3), 3);
  assert.equal(trackWidth(2.75), 2);
  assert.equal(trackWidth(0.4), 1);
  assert.equal(trackWidth(), 3);
  // Two texels across a step along x: z from -1 to 0.
  assert.deepEqual(trackTexels(0, 0, 1, 0, trackWidth(2.6)), [[0, -1], [0, 0], [1, -1], [1, 0]]);
});
