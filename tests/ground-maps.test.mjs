/*
  The ground map and the puddle map (docs/VISUALS.md, "Rain"): rain stands where the ground
  has a low point, and nowhere else. The cover and shelter maps ("Under cover"): under a bridge
  neither rain nor snow falls.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  COVER_CLEAR_FT, COVER_MIN_WIDTH_FT, NO_COVER_FT, PUDDLE_RANGE_FT, PUDDLE_WATERLINE,
  basinDepthFt, buildCoverMap, buildGroundMap, buildPuddleMap, buildShelterMap, holdAt, puddleDepthAt, shelterAt, unevennessFt,
} from "../src/game/ground-maps.js";

// The real map's size: the unevenness that seeds the puddles is finer than a coarser map could show.
const SIDE = 1024, STEP = 8192 / SIDE;
const mapOf = (heightAt) => buildGroundMap(heightAt, SIDE);
const at = (x, z) => Math.floor(z / STEP) * SIDE + Math.floor(x / STEP);
const wet = (byte) => byte > PUDDLE_WATERLINE;
/** The share of samples under water in a square of the map. */
function wetShare(puddles, x0, z0, x1, z1) {
  let under = 0, all = 0;
  for (let z = z0; z < z1; z += STEP) for (let x = x0; x < x1; x += STEP) { all++; if (wet(puddles[at(x, z)])) under++; }
  return under / all;
}

test("the ground map samples the middle of each square", () => {
  const map = buildGroundMap((x, z) => x + 10 * z, 4);
  assert.equal(map.length, 16);
  assert.equal(map[0], 1024 + 10 * 1024);
  assert.equal(map[1 * 4 + 2], 5120 + 10 * 3072);
});

test("a hollow gathers a pond at its foot; the slopes around it hold nothing", () => {
  // A bowl 600 ft across and 40 ft deep in a plain, its floor nearly level.
  const bowl = (x, z) => 100 - 40 * Math.max(0, 1 - (Math.hypot(x - 4000, z - 4000) / 300) ** 2);
  const puddles = buildPuddleMap(mapOf(bowl));
  // At the foot of the bowl stands a pond, some forty feet across and deeper than a dimple on a flat ever is.
  let pond = 0, deepest = 0;
  for (let z = 3900; z < 4100; z += STEP) {
    for (let x = 3900; x < 4100; x += STEP) {
      if (wet(puddles[at(x, z)])) pond += STEP * STEP;
      deepest = Math.max(deepest, puddles[at(x, z)]);
    }
  }
  assert.ok(pond > 600 && pond < 4000, `the pond covers ${pond} square feet`);
  assert.ok(deepest > 190, `two inches or so at its deepest: ${deepest}`);
  // Half way up its side, ground that slopes at one in five.
  let onSlope = 0;
  for (let a = 0; a < 64; a++) onSlope += wet(puddles[at(4000 + Math.cos(a) * 200, 4000 + Math.sin(a) * 200)]) ? 1 : 0;
  assert.equal(onSlope, 0);
});

test("a steady slope holds no water at all", () => {
  // One in ten along x, rising to a ridge and falling again so the world still wraps.
  const ridge = (x) => 60 + 0.1 * (4096 - Math.abs(x - 4096));
  const puddles = buildPuddleMap(mapOf(ridge));
  assert.equal(wetShare(puddles, 600, 0, 3400, 8192), 0);
  assert.equal(wetShare(puddles, 4800, 0, 7600, 8192), 0);
});

test("level ground has puddles here and there, never a sheet of water", () => {
  const puddles = buildPuddleMap(mapOf(() => 50));
  const share = wetShare(puddles, 0, 0, 8192, 8192);
  assert.ok(share > 0.02 && share < 0.14, `wet share ${share}`);
  // Shallow: an inch or two at the most, not a pond.
  let deepest = 0;
  for (const byte of puddles) if (byte > deepest) deepest = byte;
  const deepestFt = ((deepest - PUDDLE_WATERLINE) / 127) * PUDDLE_RANGE_FT;
  assert.ok(deepestFt > 0.02 && deepestFt < 0.22, `deepest ${deepestFt} ft`);
  // In patches a few hundred feet across: the wettest tenth of the ground holds several times what the driest does.
  const shares = [];
  for (let z = 0; z < 8192; z += 256) for (let x = 0; x < 8192; x += 256) shares.push(wetShare(puddles, x, z, x + 256, z + 256));
  shares.sort((a, b) => a - b);
  const tenth = shares[Math.floor(shares.length * 0.1)], ninth = shares[Math.floor(shares.length * 0.9)];
  assert.ok(ninth > 0.07 && ninth > 3 * tenth, `${tenth} to ${ninth}`);
});

test("puddles are small: a few strides across, and none a pond, on level ground", () => {
  const puddles = buildPuddleMap(mapOf(() => 50));
  // Each connected stretch of water, in samples of 64 square feet.
  const seen = new Uint8Array(puddles.length), sizes = [];
  for (let start = 0; start < puddles.length; start++) {
    if (!wet(puddles[start]) || seen[start]) continue;
    let count = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const k = stack.pop(), x = k % SIDE, y = (k - x) / SIDE;
      count++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = ((y + dy + SIDE) % SIDE) * SIDE + ((x + dx + SIDE) % SIDE);
        if (wet(puddles[j]) && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    sizes.push(Math.sqrt(count * STEP * STEP));
  }
  sizes.sort((a, b) => a - b);
  assert.ok(sizes.length > 2000, `${sizes.length} puddles`);
  assert.ok(sizes[Math.floor(sizes.length * 0.9)] < 30, `nine in ten under 30 ft across: ${sizes[Math.floor(sizes.length * 0.9)]}`);
  assert.ok(sizes.at(-1) < 130, `the largest: ${sizes.at(-1)} ft`);
});

test("ground under the level's water holds no puddle, and the shore drains into it", () => {
  // A lake in a wide basin: the water stands at 40 ft.
  const basin = (x, z) => 20 + Math.hypot(x - 4000, z - 4000) * 0.05;
  const puddles = buildPuddleMap(mapOf(basin), { waterLevelFt: 40 });
  // Under the water (within 400 ft of the middle): no puddle, the byte is 0.
  for (let z = 3800; z < 4200; z += STEP) for (let x = 3800; x < 4200; x += STEP) assert.equal(puddles[at(x, z)], 0);
  // The slope above the shore runs off into the lake.
  let shore = 0;
  for (let a = 0; a < 64; a++) shore += wet(puddles[at(4000 + Math.cos(a) * 700, 4000 + Math.sin(a) * 700)]) ? 1 : 0;
  assert.equal(shore, 0);
});

test("a basin holds more the more ground drains into it", () => {
  assert.ok(Math.abs(basinDepthFt(100) - 0.049) < 1e-12, "a dimple where the ground holds water well: over half an inch");
  assert.ok(basinDepthFt(100, 0) < basinDepthFt(100, 1), "less where the ground does not hold it");
  assert.equal(basinDepthFt(30000), basinDepthFt(100), "a dimple's own ground adds nothing");
  assert.ok(basinDepthFt(60000) < basinDepthFt(250000));
  assert.equal(basinDepthFt(1e12), 0.8);
});

test("the unevenness is inches, repeats with the world and is the same every time", () => {
  let most = 0;
  for (let i = 0; i < 2000; i++) {
    most = Math.max(most, Math.abs(unevennessFt(i * 37.7, i * 91.3)));
    const hold = holdAt(i * 37.7, i * 91.3);
    assert.ok(hold >= 0 && hold <= 1);
  }
  assert.ok(most > 0.1 && most < 0.4, `most ${most}`);
  assert.equal(unevennessFt(100, 200), unevennessFt(100 + 8192, 200 - 8192));
  const flat = buildGroundMap(() => 50, 256);
  assert.deepEqual(buildPuddleMap(flat), buildPuddleMap(flat));
});

test("a stadium's edge drains away", () => {
  const puddles = buildPuddleMap(buildGroundMap(() => 50, 256), { wraps: false });
  for (let i = 0; i < 256; i++) assert.equal(puddles[i], 0);
});

test("the cover map holds the highest thing over each sample, and never misses one between samples", () => {
  // A sloping triangle from (100, 30) to (300, 30) to (100, 230), 40 ft up at its first corner and 70 at the others; the scene's z is the game's mirrored.
  const shape = { positions: new Float32Array([100, 40, -30, 300, 70, -30, 100, 70, -230]) };
  const cover = buildCoverMap([shape], SIDE);
  assert.equal(cover[at(150, 80)], 70, "a triangle's highest point");
  assert.equal(cover[at(1000, 1000)], NO_COVER_FT);
  // The sample whose square the corner only clips is under it too.
  assert.equal(cover[at(97, 27)], 70);
  // Placed by a matrix (moved 1000 ft along x), and under two things, the higher.
  const moved = { ...shape, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1000, 0, 0, 1] };
  const roof = { positions: new Float32Array([1100, 90, -60, 1200, 90, -60, 1100, 90, -160]) };
  const both = buildCoverMap([moved, roof], SIDE);
  assert.equal(both[at(1150, 80)], 90);
  assert.equal(both[at(1250, 50)], 70);
  // A triangle on edge as seen from above covers nothing.
  assert.ok(buildCoverMap([{ positions: new Float32Array([0, 0, -10, 0, 50, -10, 0, 50, -200]) }], SIDE).every((v) => v === NO_COVER_FT));
  // Too narrow a thing shelters nothing (worker/track-build.js leaves it out): a pole, a sign, a gantry's bar.
  assert.ok(COVER_MIN_WIDTH_FT > 8 && COVER_MIN_WIDTH_FT < 20);
});

test("ground lies under cover where something stands clear over it, with a soft edge; null where nothing does", () => {
  const ground = (x) => (x < 2000 ? 20 : 100);
  // A deck at 60 ft: 40 ft over the ground to the west, buried in the hill to the east.
  const deck = { positions: new Float32Array([1600, 60, -1600, 2400, 60, -1600, 2400, 60, -2400, 1600, 60, -2400]), indices: [0, 1, 2, 0, 2, 3] };
  const shelter = buildShelterMap(buildCoverMap([deck], SIDE), ground, SIDE);
  assert.equal(shelterAt(shelter, 1800, 2000, SIDE), 1);
  assert.equal(shelterAt(shelter, 2200, 2000, SIDE), 0, "a thing in the ground is no roof");
  assert.equal(shelterAt(shelter, 1000, 1000, SIDE), 0);
  // At the deck's edge, part: rain and snow blow in a little under it.
  const edge = shelterAt(shelter, 1600, 2000, SIDE);
  assert.ok(edge > 0.2 && edge < 0.8, `edge ${edge}`);
  // Something under the clearance stands on the ground: no shelter anywhere, and no map.
  const low = { ...deck, positions: deck.positions.map((v, i) => (i % 3 === 1 ? 20 + COVER_CLEAR_FT - 1 : v)) };
  assert.equal(buildShelterMap(buildCoverMap([low], SIDE), ground, SIDE), null);
  assert.equal(shelterAt(null, 0, 0), 0);
});

test("how deep a puddle is where a wheel stands is read off the puddle map as the ground's shader reads it", () => {
  // A map four samples square, 2048 ft apart: one sample a full puddle (255), one dry ground over its pool (0), the rest at the waterline.
  const side = 4, depth = new Uint8Array(side * side).fill(PUDDLE_WATERLINE);
  depth[1 * side + 1] = 255;
  depth[2 * side + 2] = 0;
  const puddles = { depth, side }, step = 8192 / side;
  // At a sample's middle, the sample.
  assert.ok(Math.abs(puddleDepthAt(puddles, 1.5 * step, 1.5 * step) - PUDDLE_RANGE_FT) < 1e-9);
  assert.ok(Math.abs(puddleDepthAt(puddles, 2.5 * step, 2.5 * step) + (128 / 127) * PUDDLE_RANGE_FT) < 1e-9);
  assert.equal(puddleDepthAt(puddles, 0.5 * step, 3.5 * step), 0);
  // Half way between the puddle and the waterline, half as deep; and the map repeats with the world.
  assert.ok(Math.abs(puddleDepthAt(puddles, 2 * step, 1.5 * step) - PUDDLE_RANGE_FT / 2) < 1e-9);
  assert.equal(puddleDepthAt(puddles, 1.5 * step + 8192, 1.5 * step - 8192), puddleDepthAt(puddles, 1.5 * step, 1.5 * step));
  // No map, no puddle.
  assert.ok(puddleDepthAt(null, 0, 0) < 0);
});
