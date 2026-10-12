/*
  Where the fog lies (docs/VISUALS.md, "Where the fog lies"), with "Volumetric weather": a floor
  of heights over the world, far smoother than the ground, that the fog thickens up from.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { FOG_FLOOR, buildFogFloor, courseProfile } from "../src/game/fog-floor.js";
import { fogAtHeight, fogVolume } from "../src/game/atmosphere.js";

const WORLD = 8192;
/** A course straight along z = 4000 from x = 500 to 7500, in straights of 1000 ft. */
const COURSE = Array.from({ length: 7 }, (_, i) => ({ startFt: [500 + i * 1000, 0, 4000], endFt: [1500 + i * 1000, 0, 4000] }));
const bump = (x, z, cx, cz, radius, height) => height * Math.max(0, 1 - Math.hypot(x - cx, z - cz) / radius);

test("the floor is a smooth map over the world, read between its samples and wrapping with it", () => {
  assert.equal(FOG_FLOOR.side, 64);
  const level = buildFogFloor({ heightAt: () => 42 });
  assert.equal(level.data.length, 64 * 64);
  for (const [x, z] of [[0, 0], [1000, 3000], [8100, 8150]]) assert.ok(Math.abs(level.at(x, z) - 42) < 1e-4);
  const hilly = buildFogFloor({ heightAt: (x, z) => bump(x, z, 2000, 2000, 1500, 300) });
  assert.equal(hilly.at(2000 + WORLD, 2000 - WORLD), hilly.at(2000, 2000));
  // Between two samples it runs straight from one to the other.
  const step = WORLD / 64, a = hilly.at(10 * step, 10 * step), b = hilly.at(11 * step, 10 * step);
  assert.ok(Math.abs(hilly.at(10.5 * step, 10 * step) - (a + b) / 2) < 1e-4);
});

test("without a course the floor is the land taken broadly, leaning to its low places: a peak stands out of it", () => {
  // A peak 300 ft high and some 1400 ft across: in Foggy its top is in the clear.
  const peak = buildFogFloor({ heightAt: (x, z) => bump(x, z, 2000, 2000, 700, 300) });
  assert.ok(peak.at(2000, 2000) < 100, `the floor under the top: ${peak.at(2000, 2000)}`);
  assert.ok(peak.at(2000, 2000) > peak.at(6000, 6000), "and higher than over the plain");
  assert.ok(fogAtHeight(fogVolume(2), 300 - peak.at(2000, 2000)) < 0.02);
  // A massif twice as broad lifts the fog with it: its top is coming out of the fog, not clear of it.
  const massif = buildFogFloor({ heightAt: (x, z) => bump(x, z, 2000, 2000, 1500, 300) });
  assert.ok(massif.at(2000, 2000) > peak.at(2000, 2000) * 2 && massif.at(2000, 2000) < 300 - 60);
  const over = fogAtHeight(fogVolume(2), 300 - massif.at(2000, 2000));
  assert.ok(over > 0.02 && over < 0.5, `over the massif: ${over}`);
});

test("along the course the floor is the course's height averaged along it: a crest comes out of the fog, a long ridge road does not", () => {
  // A crest the course crosses in a couple of hundred feet.
  const crest = (x, z) => bump(x, z, 4000, 4000, 120, 100);
  const overCrest = buildFogFloor({ heightAt: crest, segments: COURSE }).at(4000, 4000);
  assert.ok(overCrest < 20, `over the crest: ${overCrest}`);
  assert.ok(fogAtHeight(fogVolume(2), 100 - overCrest) < 0.4, "a truck on it is coming out of Foggy");
  // A road along a ridge 100 ft high for 4000 ft, with valleys either side.
  const ridge = (x, z) => (x > 2000 && x < 6000 && Math.abs(z - 4000) < 120 ? 100 : 0);
  const onRidge = buildFogFloor({ heightAt: ridge, segments: COURSE }).at(4000, 4000);
  assert.ok(onRidge > 85, `on the ridge: ${onRidge}`);
  assert.ok(fogAtHeight(fogVolume(2), 100 - onRidge) >= 1, "the road is in the fog's deck");
});

test("fog lies level and fills what lies below it: a valley beside the course is full of it up to the course's level, and a hill stands out of it", () => {
  // The course along a plateau 200 ft up; to one side the land falls away into a valley 800 ft wide, 150 ft below the road.
  const land = (x, z) => (Math.abs(z - 4900) < 400 ? 50 : 200);
  const floor = buildFogFloor({ heightAt: land, segments: COURSE });
  assert.ok(Math.abs(floor.at(4000, 4000) - 200) < 1, `on the course: ${floor.at(4000, 4000)}`);
  // Over the valley's floor the fog's own floor is the course's level, not the valley's: the valley is full to the brim.
  assert.ok(floor.at(4000, 4900) > 190, `over the valley: ${floor.at(4000, 4900)}`);
  // Land higher than the course's level stands up out of it, clear: the fog far off lies at the course's level, not on the land.
  const massif = buildFogFloor({ heightAt: (x, z) => bump(x, z, 4000, 400, 1500, 600), segments: COURSE });
  assert.ok(Math.abs(massif.at(4000, 400)) < 5, `under the massif's top, the course's level: ${massif.at(4000, 400)}`);
  assert.ok(fogAtHeight(fogVolume(2), 600 - massif.at(4000, 400)) < 0.01);
});

test("the course's height is averaged over a quarter mile of it, round the join where it comes back to its start", () => {
  assert.equal(FOG_FLOOR.courseWindowFt, 1400);
  const step = (x) => (x < 4000 ? 0 : 100);
  const profile = courseProfile(COURSE, (x) => step(x));
  assert.ok(profile.length > 200);
  const at = (x) => profile.reduce((best, p) => (Math.abs(p.x - x) < Math.abs(best.x - x) ? p : best)).height;
  assert.ok(Math.abs(at(4000) - 50) < 5, `at the step: ${at(4000)}`);
  assert.equal(at(2000), 0);
  assert.equal(at(6000), 100);
  // Not a loop: the ends are averaged up to themselves.
  assert.equal(at(500), 0);
  // A loop: a square circuit 2000 ft on a side; the ground is high near its start, and the average runs round the join.
  const square = [[1000, 1000], [3000, 1000], [3000, 3000], [1000, 3000], [1000, 1000]];
  const loop = square.slice(0, 4).map((p, i) => ({ startFt: [p[0], 0, p[1]], endFt: [square[i + 1][0], 0, square[i + 1][1]] }));
  const high = (x, z) => (x < 1300 && z < 1300 ? 100 : 0);
  const around = courseProfile(loop, high);
  assert.ok(around[0].height > 0 && Math.abs(around[0].height - around[around.length - 1].height) < 10);
  assert.deepEqual(courseProfile([], () => 0), []);
});
