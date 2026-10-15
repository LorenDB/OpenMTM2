/*
  The terrain atlas: one slot per texture, each as wide as the widest tile (worker/terrain-mesh.js).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { buildTerrainAtlas, cellTileUvs } from "../src/worker/terrain-mesh.js";

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

test("the two-pixel overlap crops two of a tile's own pixels, however wide its atlas slot is", () => {
  // A 64 px tile beside a 256 px one (a custom track that mixes them, VALPO3): the slots are 256 texels, so the
  // small tile's two pixels are eight texels.
  const tile64 = { width: 64, height: 64, rgba: new Uint8ClampedArray(64 * 64 * 4) };
  const tile256 = { width: 256, height: 256, rgba: new Uint8ClampedArray(256 * 256 * 4) };
  const atlas = buildTerrainAtlas([tile64, tile256]);
  assert.equal(atlas.tileSide, 256);
  const left = (slot) => Math.min(...cellTileUvs(slot, atlas, new Float32Array(8)).filter((_, k) => k % 2 === 0)) * atlas.width - atlas.rects[slot][0];
  assert.ok(Math.abs(left(0) - 8) < 1e-3, `64 px tile cropped by ${left(0)} texels`);
  assert.ok(Math.abs(left(1) - 2) < 1e-3, `256 px tile cropped by ${left(1)} texels`);
  // An HD tile crops two pixels of the legacy tile it replaces.
  const hd = buildTerrainAtlas([{ ...tile256, legacyWidth: 64 }]);
  const hdLeft = Math.min(...cellTileUvs(0, hd, new Float32Array(8)).filter((_, k) => k % 2 === 0)) * hd.width - hd.rects[0][0];
  assert.ok(Math.abs(hdLeft - 8) < 1e-3, `HD tile cropped by ${hdLeft} texels`);
});
