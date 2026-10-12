/*
  Snow on the ground as a depth (docs/VISUALS.md, "Snow"): deep on level ground, thin on slopes
  and along the course, none where the ground is too steep or something stands on it.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { GROUND_MAP_SIDE, buildCoverMap, buildShelterMap } from "../src/game/ground-maps.js";
import { buildReliefData, createRelief } from "../src/game/terrain-relief.js";
import {
  SNOW_BANK_FT, SNOW_BANK_SHARE, SNOW_BARE_SLOPE, SNOW_DEPTH_SCALE_FT, SNOW_HOLD_SLOPE, SNOW_LINE, SNOW_MAX_FT, SNOW_TRACK_SHARE,
  createSnowCover, snowBesideCourse, snowDrift, snowHold, snowShows,
} from "../src/game/snow-cover.js";

const GRID = 256, CELLS = GRID * GRID;
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} is not ${b}`);

test("level ground holds all of its snow, a slope less, a steep face none", () => {
  assert.equal(snowHold(0), 1);
  assert.equal(snowHold(SNOW_HOLD_SLOPE), 1);
  assert.ok(snowHold(0.3) < 1 && snowHold(0.3) > snowHold(0.6));
  assert.equal(snowHold(SNOW_BARE_SLOPE), 0);
  assert.equal(snowHold(3), 0);
  // The deepest snow fits the byte the mesh keeps it in, the bank's extra included.
  assert.ok(SNOW_MAX_FT * SNOW_BANK_SHARE < SNOW_DEPTH_SCALE_FT);
});

test("snow drifts: nowhere under four tenths of the deepest, deepest somewhere, the same across the world's wrap", () => {
  let least = 9, most = 0;
  for (let i = 0; i < 4000; i++) {
    const drift = snowDrift(i * 41.7, i * 13.3);
    least = Math.min(least, drift); most = Math.max(most, drift);
  }
  assert.ok(least >= 0.44 - 1e-9 && least < 0.6, `least ${least}`);
  assert.ok(most <= 1 + 1e-9 && most > 0.85, `most ${most}`);
  assert.equal(snowDrift(100, 200), snowDrift(100 + 8192, 200 - 8192));
});

test("along the course the snow is thin; beyond its edge it rises to a bank and settles to the open ground's", () => {
  assert.equal(snowBesideCourse(-20), SNOW_TRACK_SHARE);
  assert.equal(snowBesideCourse(0), SNOW_TRACK_SHARE);
  assert.ok(snowBesideCourse(SNOW_BANK_FT / 2) > SNOW_TRACK_SHARE && snowBesideCourse(SNOW_BANK_FT / 2) < SNOW_BANK_SHARE);
  near(snowBesideCourse(SNOW_BANK_FT), SNOW_BANK_SHARE);
  assert.ok(SNOW_BANK_SHARE > 1, "the bank stands above the open ground");
  near(snowBesideCourse(2 * SNOW_BANK_FT), 1);
  assert.equal(snowBesideCourse(500), 1);
  assert.equal(snowBesideCourse(Infinity), 1);
  // No step anywhere on the way out.
  for (let d = -5; d < 40; d += 0.25) assert.ok(Math.abs(snowBesideCourse(d + 0.25) - snowBesideCourse(d)) < 0.05, `at ${d}`);
});

test("the depth on real shapes: a level field, a course across it, a hillside, a cliff, a ground box", () => {
  // Level at 60 ft, with a hill rising to the east: one step a cell from column 100 (a slope of 1 in 16), then a wall.
  const heights = new Uint8Array(CELLS);
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) heights[row * GRID + col] = col < 100 ? 30 : col < 140 ? 30 + (col - 100) * 6 : col < 142 ? 30 + 240 - (col - 140) * 100 : 30;
  }
  const ra0 = new Uint8Array(CELLS), ra1 = new Uint8Array(CELLS);
  ra1[200 * GRID + 20] = 40;
  const course = [{ startFt: [200, 0, 2000], endFt: [2400, 0, 2000], trackWidthFt: 40 }];
  const data = buildReliefData({ clr: new Uint16Array(CELLS), textureValues: [200], ra0, ra1, courses: [course] });
  const relief = createRelief({ heights, ...data });
  const snow = createSnowCover({ relief, calm: data.calm, held: data.smooth });

  // Open level ground: the deepest there is, times the drift.
  const open = snow.depthAt(1000, 6000);
  near(open, SNOW_MAX_FT * snowDrift(1000, 6000));
  assert.ok(open > 0.5 && open <= SNOW_MAX_FT);
  // On the course: a share of that.
  near(snow.depthAt(1000, 2000), SNOW_MAX_FT * snowDrift(1000, 2000) * SNOW_TRACK_SHARE);
  assert.ok(snow.depthAt(1000, 2000) < 0.2, "an inch or two");
  // Its clear width is the track's half width (at least 24 ft) and 12 ft more: 36 ft out is still thin, the bank is 16 ft further.
  assert.equal(SNOW_BANK_FT, 16);
  near(snow.depthAt(1000, 2035) / snowDrift(1000, 2035), SNOW_MAX_FT * SNOW_TRACK_SHARE, 1e-6);
  near(snow.depthAt(1000, 2052) / snowDrift(1000, 2052), SNOW_MAX_FT * SNOW_BANK_SHARE, 0.02);
  near(snow.depthAt(1000, 2090) / snowDrift(1000, 2090), SNOW_MAX_FT, 1e-6);
  assert.equal(snow.nearCourse(Math.floor(2000 / 32), Math.floor(1000 / 32)), true);
  assert.equal(snow.nearCourse(180, 30), false);

  // The hillside (12 ft a cell, 0.375): some snow, less than the level ground's.
  const hill = snow.depthAt(120 * 32 + 16, 6000) / snowDrift(120 * 32 + 16, 6000);
  assert.ok(hill > 0.1 && hill < SNOW_MAX_FT * 0.8, `hillside ${hill}`);
  near(hill, SNOW_MAX_FT * snowHold(12 / 32), 0.02);
  // The wall behind it (200 ft a cell): none.
  assert.equal(snow.depthAt(140 * 32 + 16, 6000), 0);
  // Given the slope, the same answer as finding it.
  near(snow.depthAt(120 * 32 + 16, 6000, 12 / 32), snow.depthAt(120 * 32 + 16, 6000), 0.02);
  assert.equal(snow.depthAt(1000, 6000, 5), 0);

  // The cell with a ground box: none on it, and it fades in over the cells around it.
  assert.equal(snow.depthAt(20 * 32 + 16, 200 * 32 + 16), 0);
  assert.equal(snow.depthAt(20 * 32, 200 * 32), 0);
  assert.ok(snow.depthAt(22 * 32 + 16, 200 * 32 + 16) > 0.4);

  // Across the wrap it is the same place.
  assert.equal(snow.depthAt(1000 + 8192, 6000 - 8192), open);
});

test("a ground box's top along the course is the course: its snow as thin as the road's, and beside it the open ground's", () => {
  const heights = new Uint8Array(CELLS).fill(30);
  // A bridge's deck: a ground box over the course, and another off it.
  const ra0 = new Uint8Array(CELLS), ra1 = new Uint8Array(CELLS);
  for (const cell of [Math.floor(2000 / 32) * GRID + 31, 180 * GRID + 30]) { ra0[cell] = 60; ra1[cell] = 65; }
  const course = [{ startFt: [200, 0, 2000], endFt: [2400, 0, 2000], trackWidthFt: 40 }];
  const data = buildReliefData({ clr: new Uint16Array(CELLS), textureValues: [200], ra0, ra1, courses: [course] });
  const snow = createSnowCover({ relief: createRelief({ heights, ...data }), calm: data.calm, held: data.smooth });
  // The ground under a box has none; its top, the course's share, whatever the ground under it does.
  assert.equal(snow.depthAt(31 * 32 + 16, 2000), 0);
  assert.equal(snow.courseShareAt(31 * 32 + 16, 2000), SNOW_TRACK_SHARE);
  // Beyond the course's edge, the bank's and then the open ground's, as on the ground.
  near(snow.courseShareAt(1000, 2052), snowBesideCourse(52 - 36), 1e-4);
  assert.equal(snow.courseShareAt(30 * 32 + 16, 180 * 32 + 16), 1);
  // Across the wrap it is the same place.
  assert.equal(snow.courseShareAt(31 * 32 + 16 + 8192, 2000 - 8192), SNOW_TRACK_SHARE);
});

test("under a bridge no snow lies, and it comes in a little under the bridge's edge", () => {
  const relief = createRelief({ heights: new Uint8Array(CELLS).fill(10) });
  // A deck 40 ft over the ground (the ground is at 20 ft), from x 960 to 1280 and z 960 to 1120 (the scene's z is the game's mirrored).
  const deck = { positions: new Float32Array([960, 60, -960, 1280, 60, -960, 1280, 60, -1120, 960, 60, -1120]), indices: [0, 1, 2, 0, 2, 3] };
  const shelter = buildShelterMap(buildCoverMap([deck], GROUND_MAP_SIDE), relief.heightAt, GROUND_MAP_SIDE);
  const snow = createSnowCover({ relief, shelter });
  const bare = createSnowCover({ relief });
  assert.equal(snow.depthAt(1120, 1040), 0);
  assert.equal(snow.depthAt(2000, 2000), bare.depthAt(2000, 2000));
  // At the edge, some: the snow blows in.
  const edge = snow.depthAt(960, 1040);
  assert.ok(edge > 0 && edge < bare.depthAt(960, 1040), `edge ${edge}`);
});

test("with nothing but the ground, snow lies by slope and drift alone", () => {
  const relief = createRelief({ heights: new Uint8Array(CELLS).fill(10) });
  const snow = createSnowCover({ relief });
  near(snow.depthAt(3000, 3000), SNOW_MAX_FT * snowDrift(3000, 3000));
  assert.equal(snow.nearCourse(10, 10), false);
});

test("the snow line wanders: snow shows where it settles deeper than a depth that varies from place to place, not where the mesh says it ends", () => {
  // Deeper than the most it can need, snow always shows; shallower than the least, never; between, by the place.
  assert.equal(SNOW_LINE.showsFromFt, 0.05);
  assert.equal(SNOW_LINE.showsToFt, 0.36);
  for (const wander of [0, 0.3, 1]) {
    assert.equal(snowShows(0.7, wander), true);
    assert.equal(snowShows(0.04, wander), false);
  }
  assert.equal(snowShows(0.25, 0.2), true);
  assert.equal(snowShows(0.25, 0.8), false);
  // Open level ground is under snow everywhere, however it drifts.
  assert.ok(SNOW_MAX_FT * 0.44 > SNOW_LINE.showsToFt, "the shallowest drift on level ground is deeper than what always shows");
  // The course stays clear, so the way is plain: its snow is shallower than the least that shows. Short of the line the
  // snow lies thin, as specks, and the road takes a few where the line comes lowest.
  const road = SNOW_MAX_FT * SNOW_TRACK_SHARE;
  for (const wander of [0, 0.5, 1]) assert.equal(snowShows(road, wander), false);
  assert.ok(road + SNOW_LINE.softDepthFt > SNOW_LINE.showsFromFt && road + SNOW_LINE.softDepthFt < SNOW_LINE.showsToFt);
  // The line is held against the settled depth, so it stays where it is while the snow deepens...
  for (const down of [0.1, 0.3, 0.6, 1]) assert.equal(snowShows(0.3, 0.2, down), true, `with ${down} down`);
  for (const down of [0.1, 0.3, 0.6, 1]) assert.equal(snowShows(0.25, 0.8, down), false, `with ${down} down`);
  // ...but the first tenth of a fall creeps out from where the snow will lie deepest.
  assert.equal(SNOW_LINE.creepsUntil, 0.1);
  assert.equal(snowShows(0.3, 0.2, 0.02), false);
  assert.equal(snowShows(1.3, 0.2, 0.02), true);
  assert.equal(snowShows(1.3, 0.2, 0), false);
  // A race that begins in Snow has three tenths down: its line is already where it will stay.
  assert.ok(0.3 > SNOW_LINE.creepsUntil);
  // The line wanders over tens of feet, far wider than its fray, and the ground beside it is damp.
  assert.ok(SNOW_LINE.wanderFt / 4 > 30 && SNOW_LINE.frayFt < SNOW_LINE.wanderFt / 10);
  assert.ok(SNOW_LINE.damp > 0 && SNOW_LINE.damp < 0.5 && SNOW_LINE.frayDepthFt < SNOW_LINE.showsToFt);
});
