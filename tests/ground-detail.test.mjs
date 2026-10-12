/*
  The ground's grain (docs/VISUALS.md, "Ground"): how much of it each kind of ground takes, from
  the `.TTY` type of its texture (MTM2_PHYSICS.md 2.3), and the scales it lies at.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { CLIFF_NORMAL, DEFAULT_GRAIN_SHARE, GRAIN, PATCHES, grainShare } from "../src/game/ground-detail.js";

test("rough ground takes the grain in full, made ground a little, water none", () => {
  // A texture's value is type * 100 + depth in inches: Rocks 12, Dirt 2, Gravel 7, Grass 6, Mud 4, Sand 5, Snow 9, Ice 8, Cement 1, Wood 11, Metal 10, Water 3.
  assert.equal(grainShare(1200), 1);
  assert.equal(grainShare(1206), 1, "the depth does not matter");
  for (const [value, share] of [[200, 0.85], [700, 0.85], [600, 0.7], [400, 0.6], [500, 0.5], [900, 0.3], [800, 0.3], [100, 0.3], [1100, 0.25], [1000, 0.2]]) {
    assert.equal(grainShare(value), share, `value ${value}`);
  }
  assert.equal(grainShare(300), 0);
  assert.equal(grainShare(1300), 0, "deep water");
  // A texture without a type is Default, the stock tracks' bare ground.
  assert.equal(grainShare(0), DEFAULT_GRAIN_SHARE);
  assert.equal(grainShare(undefined), DEFAULT_GRAIN_SHARE);
  assert.equal(grainShare(9900), DEFAULT_GRAIN_SHARE);
  assert.ok(grainShare(1200) > grainShare(200) && grainShare(200) > grainShare(600) && grainShare(600) > grainShare(500) && grainShare(500) > grainShare(100));
});

test("the grain lies at two scales that repeat with the world, each gone before a pixel is wider than it", () => {
  // The game's tiles are 64 texels across 32 ft: half a foot a texel. The fine grain repeats every 7 ft with features of inches.
  assert.ok(GRAIN.fine.repeatFt > 5 && GRAIN.fine.repeatFt < 10 && GRAIN.coarse.repeatFt > GRAIN.fine.repeatFt * 4);
  for (const scale of [GRAIN.fine, GRAIN.coarse]) {
    const repeats = 8192 / scale.repeatFt;
    assert.ok(Math.abs(repeats - Math.round(repeats)) < 1e-9, "a whole number of repeats across the world, so it joins at the wrap");
    assert.ok(scale.fadeToFt > scale.fadeFromFt * 3);
  }
  assert.ok(GRAIN.coarse.fadeFromFt > GRAIN.fine.fadeToFt, "the coarse grain carries on where the fine has gone");
  for (const wide of [PATCHES.broadFt, PATCHES.mediumFt, PATCHES.smallFt]) assert.ok(Math.abs(8192 / wide - Math.round(8192 / wide)) < 1e-9);
  assert.ok(PATCHES.amount > 0.05 && PATCHES.amount < 0.25);
  assert.ok(PATCHES.farFromFt < PATCHES.farToFt && PATCHES.farFlat > 0.5 && PATCHES.farFlat <= 1);
  // A cliff is ground no tire holds (a slope of 1 in 1 has a normal 0.707 high): its texture is seen edge on.
  assert.ok(CLIFF_NORMAL.cliff < 0.707 && CLIFF_NORMAL.level > 0.707 && CLIFF_NORMAL.level < 1);
});
