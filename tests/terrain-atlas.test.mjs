/*
  The terrain atlas: one slot per texture, each as wide as the widest tile (worker/terrain-mesh.js).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { buildTerrainAtlas } from "../src/worker/terrain-mesh.js";

/** A 2 x 1 tile, black then white, and a 4 x 4 one, grey. */
const small = { width: 2, height: 1, rgba: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]) };
const big = { width: 4, height: 4, rgba: new Uint8ClampedArray(64).fill(128) };

/** The red of slot 0's texel (x, 0). */
const red = (atlas, x) => atlas.rgba[(atlas.rects[0][1] * atlas.width + atlas.rects[0][0] + x) * 4];

test("a small tile among wider ones is scaled up in blocks, or with smooth textures blended between its texels", () => {
  // Slots are at least 64 texels: both tiles are scaled up to that.
  const blocky = buildTerrainAtlas([small, big]);
  assert.equal(blocky.tileSide, 64);
  assert.deepEqual([0, 31, 32, 63].map((x) => red(blocky, x)), [0, 0, 255, 255]);
  const smooth = buildTerrainAtlas([small, big], 0, { smooth: true });
  const row = [0, 16, 31, 32, 48, 63].map((x) => red(smooth, x));
  assert.equal(row[0], 0);
  assert.equal(row[5], 255);
  for (let k = 1; k < row.length; k++) assert.ok(row[k] >= row[k - 1], `${row} rises between the texels`);
  assert.ok(row[2] > 0 && row[3] < 255, `${row} blends across the middle`);
  // A tile of one colour stays that colour.
  assert.equal(smooth.rgba[(smooth.rects[1][1] * smooth.width + smooth.rects[1][0]) * 4], 128);
});
