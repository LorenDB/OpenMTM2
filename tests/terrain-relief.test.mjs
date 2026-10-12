/*
  The drawn ground (docs/VISUALS.md, "Terrain"): a smooth surface over the game's own, which it
  equals wherever the game's is already smooth or something stands on it.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { mtm2Sim } from "../src/vendor/openphotex/index.js";
import {
  CELL_FT, DETAIL_MAX_FT, DETAIL_SLOPE_START, GRID, SEAT_LIMIT_FT, WORLD_FT,
  buildReliefData, conformPose, createRelief, detailReachFt, tireRadiusFt, triangleHeight, worldNoise, worldNoise3, ROUND,
} from "../src/game/terrain-relief.js";

const CELLS = GRID * GRID;
/** A level of one ground type everywhere: the .CLR all slot 0, whose type value is `value`. */
const plainData = (value = 200, extra = {}) => buildReliefData({ clr: new Uint16Array(CELLS), textureValues: [value], ...extra });
const reliefOf = (heights, data = plainData()) => createRelief({ heights, ...data });

function randomSource(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Rolling hills a few steps high, with one cliff. */
function hills(seed = 3) {
  const heights = new Uint8Array(CELLS);
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const wave = 40 + 14 * Math.sin((col / GRID) * Math.PI * 6 + seed) + 10 * Math.cos((row / GRID) * Math.PI * 4);
      heights[row * GRID + col] = Math.round(wave) + (col > 180 && col < 200 ? 60 : 0);
    }
  }
  return heights;
}

test("the game's surface in a cell is the simulation's own, on both diagonals", () => {
  const heights = hills();
  const relief = reliefOf(heights);
  const terrain = mtm2Sim.createTerrain(heights);
  const random = randomSource(9);
  for (let i = 0; i < 4000; i++) {
    // Whole 1/256 ft, as the game truncates positions.
    const x = Math.floor(random() * WORLD_FT * 256) / 256, z = Math.floor(random() * WORLD_FT * 256) / 256;
    assert.ok(Math.abs(relief.simAt(x, z) - mtm2Sim.terrainHeightAt(terrain, x, z)) < 1e-9, `${x}, ${z}`);
  }
  assert.equal(triangleHeight(0, 2, 4, 6, 0.5, 0.5, true), 3);
});

test("flat ground stays flat and an even incline stays its plane, to the last bit", () => {
  const flat = new Uint8Array(CELLS).fill(30);
  const incline = new Uint8Array(CELLS);
  // Rising one step a cell along x over the middle of the world, level outside it.
  for (let row = 0; row < GRID; row++) for (let col = 0; col < GRID; col++) incline[row * GRID + col] = Math.min(100, Math.max(20, col));
  const random = randomSource(4);
  const onFlat = reliefOf(flat), onIncline = reliefOf(incline);
  for (let i = 0; i < 2000; i++) {
    const x = random() * WORLD_FT, z = random() * WORLD_FT;
    assert.equal(onFlat.heightAt(x, z), 60);
    // Well inside the incline, away from where it levels off.
    const xi = 30 * CELL_FT + random() * 60 * CELL_FT;
    assert.ok(Math.abs(onIncline.offsetAt(xi, z)) < 1e-9, `${xi}, ${z}`);
  }
  assert.equal(onFlat.cellIsPlain(10, 10), true);
  assert.equal(onIncline.cellIsPlain(50, 60), true);
  // Where the incline meets the level ground the crease is rounded: the incline's foot is eased down toward it, and
  // the level ground within the rounding's reach of it (12 ft) is eased up to meet it. Further off nothing is touched.
  assert.equal(ROUND.stepFt * ROUND.taps, 12);
  assert.equal(onIncline.cellIsPlain(50, 17), true);
  assert.equal(onIncline.cellIsPlain(50, 20), false);
  assert.ok(onIncline.offsetAt(20 * CELL_FT + 12, 900) < -0.1, "the foot of the incline is eased below the crease");
  const before = onIncline.offsetAt(20 * CELL_FT - 2, 900);
  assert.ok(before > 0.005 && before < 0.5, `the level ground just before the crease is eased up: ${before}`);
  assert.equal(onIncline.offsetAt(19 * CELL_FT + 12, 900), 0, "twenty feet from the crease: untouched");
  assert.equal(onIncline.offsetAt(18 * CELL_FT + 5, 900), 0);
});

test("rounding takes the edge off a ridge: its slope turns over some twenty feet, not at a line", () => {
  // A ridge along x = 100 cells: rising one step a cell to it, falling one step a cell from it.
  const ridge = new Uint8Array(CELLS);
  for (let row = 0; row < GRID; row++) for (let col = 0; col < GRID; col++) ridge[row * GRID + col] = 100 - Math.min(40, Math.abs(col - 100));
  const relief = reliefOf(ridge);
  const slope = (x) => (relief.heightAt(x + 0.05, 2000) - relief.heightAt(x - 0.05, 2000)) / 0.1;
  const crest = 100 * CELL_FT;
  // Well down either flank the ground keeps its slope, one step (2 ft) a cell.
  assert.ok(Math.abs(slope(crest - 80) - 2 / CELL_FT) < 1e-6 && Math.abs(slope(crest + 80) + 2 / CELL_FT) < 1e-6);
  // Across the crest the slope turns by degrees: it never jumps by more than a part of the whole turn between two points a foot apart.
  let jump = 0;
  for (let x = crest - 16; x < crest + 16; x += 1) jump = Math.max(jump, Math.abs(slope(x + 1) - slope(x)));
  assert.ok(jump < 0.4 * (4 / CELL_FT), `the sharpest turn in a foot is ${jump}`);
  assert.ok(Math.abs(slope(crest)) < 1e-6, "level on the crest itself");
  // And the crest is lowered by it, by inches.
  const lowered = 200 - relief.heightAt(crest, 2000);
  assert.ok(lowered > 0.05 && lowered < 0.5, `the crest is ${lowered} ft lower`);
});

test("the smooth surface passes within inches of every corner and never leaves the range of the ground about it on gentle ground", () => {
  const heights = hills();
  const relief = reliefOf(heights);
  // Before rounding the surface is through every corner exactly; rounding moves it there by what the ground turns by.
  let offCorner = 0;
  for (let row = 0; row < GRID; row += 7) {
    for (let col = 0; col < 170; col += 5) {
      assert.ok(Math.abs(relief.baseAt(col * CELL_FT, row * CELL_FT) - heights[row * GRID + col] * 2) < 1e-9);
      offCorner = Math.max(offCorner, Math.abs(relief.heightAt(col * CELL_FT, row * CELL_FT) - heights[row * GRID + col] * 2));
    }
  }
  assert.ok(offCorner > 0.01 && offCorner < 1, `the furthest the surface passes from a corner: ${offCorner}`);
  const random = randomSource(21);
  let worst = 0;
  for (let i = 0; i < 6000; i++) {
    // West of the cliff the hills are too gentle for detail.
    const x = random() * 170 * CELL_FT, z = random() * WORLD_FT;
    const col = Math.floor(x / CELL_FT), row = Math.floor(z / CELL_FT);
    // The cell's own corners and those of the cells about it: the rounding reaches a quarter of a cell.
    const about = [];
    for (let r = -1; r <= 2; r++) for (let c = -1; c <= 2; c++) about.push(heights[((row + r) & 255) * GRID + ((col + c) & 255)] * 2);
    const h = relief.heightAt(x, z);
    assert.ok(h >= Math.min(...about) - 1e-9 && h <= Math.max(...about) + 1e-9, `${x}, ${z}`);
    worst = Math.max(worst, Math.abs(relief.offsetAt(x, z)));
  }
  // Rounding a crease of a step or two moves the ground by inches, not feet.
  assert.ok(worst > 0.05 && worst < 1.9, `worst ${worst}`);
});

test("the drawn ground is continuous: across cell edges, across the diagonal, and across the world's wrap", () => {
  const random = randomSource(77);
  const heights = new Uint8Array(CELLS).map(() => 40 + Math.floor(random() * 50));
  const relief = reliefOf(heights, plainData(1200));
  const e = 1e-4;
  for (let i = 0; i < 3000; i++) {
    const edge = Math.floor(random() * GRID) * CELL_FT, along = random() * WORLD_FT;
    // A random level is all cliffs, so the surface is steep: a step of 2e-4 ft changes it by far less than a hundredth of a foot.
    assert.ok(Math.abs(relief.heightAt(edge - e, along) - relief.heightAt(edge + e, along)) < 0.02, `x edge ${edge}, ${along}`);
    assert.ok(Math.abs(relief.heightAt(along, edge - e) - relief.heightAt(along, edge + e)) < 0.02, `z edge ${edge}, ${along}`);
  }
  for (let i = 0; i < 500; i++) {
    const x = random() * WORLD_FT, z = random() * WORLD_FT;
    assert.equal(relief.heightAt(x, z), relief.heightAt(x + WORLD_FT, z - WORLD_FT));
    assert.equal(relief.heightAt(x - 3 * WORLD_FT, z), relief.heightAt(x, z));
  }
});

test("detail grows with steepness and follows the ground type", () => {
  assert.equal(detailReachFt(0), 0);
  // No tire grips better than 1.0 (MTM2_PHYSICS.md 2.3), so none holds a slope over 1 in 1: detail begins just under that.
  assert.equal(DETAIL_SLOPE_START, 0.9);
  assert.equal(detailReachFt(0.5), 0, "a 27 degree hill is driven on: no detail");
  assert.equal(detailReachFt(DETAIL_SLOPE_START), 0);
  assert.ok(detailReachFt(1.2) > 0 && detailReachFt(1.2) < detailReachFt(1.8));
  assert.ok(detailReachFt(1.8) < detailReachFt(3), "a cliff has more than a steep slope");
  assert.equal(detailReachFt(40), DETAIL_MAX_FT);
  // The same cliff as rock, as sand and as cement: 60 steps over one cell.
  const cliff = hills();
  const reach = (value) => {
    const relief = reliefOf(cliff, plainData(value));
    let worst = 0;
    for (let k = 0; k < 400; k++) worst = Math.max(worst, Math.abs(relief.offsetAt(180 * CELL_FT + (k % 20) * 1.6, 500 + k * 13)));
    return worst;
  };
  const rock = reach(1200), sand = reach(500), cement = reach(100);
  assert.ok(rock > 3, `rock ${rock}`);
  assert.ok(sand < rock, `sand ${sand} under rock ${rock}`);
  // Made ground is smoothed but gets no relief: what is left is the rounding of the crease alone.
  assert.ok(cement < sand, `cement ${cement} under sand ${sand}`);
});

test("the ground is the game's under ground boxes, around placed objects and outside a stadium", () => {
  const heights = hills();
  const ra0 = new Uint8Array(CELLS), ra1 = new Uint8Array(CELLS);
  ra1[100 * GRID + 190] = 90; // a box on the cliff
  const data = plainData(1200, { ra0, ra1, objects: [{ x: 185 * CELL_FT + 10, z: 40 * CELL_FT + 5, radius: 12 }] });
  const relief = reliefOf(heights, data);
  const random = randomSource(5);
  for (let i = 0; i < 300; i++) {
    // Anywhere in the box's cell.
    assert.equal(relief.offsetAt(190 * CELL_FT + random() * CELL_FT, 100 * CELL_FT + random() * CELL_FT), 0);
    // Within the object's footprint and its margin.
    const angle = random() * Math.PI * 2, r = random() * 18;
    assert.equal(relief.offsetAt(185 * CELL_FT + 10 + Math.cos(angle) * r, 40 * CELL_FT + 5 + Math.sin(angle) * r), 0);
  }
  assert.equal(relief.cellIsPlain(100, 190), true, "a held cell is the game's whatever lies about it");
  // Far from both the cliff has its relief.
  assert.ok(Math.abs(relief.offsetAt(185 * CELL_FT + 10, 200 * CELL_FT)) > 0);

  const stadium = plainData(1200, { footprint: { col0: 113, col1: 127, row0: 93, row1: 107 } });
  assert.equal(stadium.smooth[100 * GRID + 113], 0, "on the footprint's edge");
  assert.equal(stadium.smooth[100 * GRID + 120], 255, "inside it");
  assert.equal(stadium.smooth[10 * GRID + 10], 0, "outside it");
});

test("the course has no detail, whatever it crosses; beside it the cliff has all of its own", () => {
  const cliff = hills();
  // A course straight up the cliff's face and on across its top, 40 ft wide.
  const course = [{ startFt: [170 * CELL_FT, 0, 2000], endFt: [210 * CELL_FT, 0, 2000], trackWidthFt: 40 }];
  const open = reliefOf(cliff, plainData(1200));
  const kept = reliefOf(cliff, plainData(1200, { courses: [course] }));
  let onCourse = 0, onCourseOpen = 0, beside = 0;
  for (let k = 0; k < 400; k++) {
    // On the cliff's west face (columns 180 to 181), within the track's width, then 300 ft to one side of it.
    const x = 180 * CELL_FT + (k % 40) * 0.8, across = ((k * 7) % 40) - 20;
    onCourse = Math.max(onCourse, Math.abs(kept.offsetAt(x, 2000 + across)));
    onCourseOpen = Math.max(onCourseOpen, Math.abs(open.offsetAt(x, 2000 + across)));
    beside = Math.max(beside, Math.abs(kept.offsetAt(x, 2300 + across) - open.offsetAt(x, 2300 + across)));
  }
  assert.ok(onCourseOpen > 3, `without the course the face has detail: ${onCourseOpen}`);
  // What is left on the course is the rounding of the crease, which the smooth surface does everywhere.
  const rounding = reliefOf(cliff, plainData(100));
  let smoothOnly = 0;
  for (let k = 0; k < 400; k++) smoothOnly = Math.max(smoothOnly, Math.abs(rounding.offsetAt(180 * CELL_FT + (k % 40) * 0.8, 2000 + ((k * 7) % 40) - 20)));
  assert.ok(Math.abs(onCourse - smoothOnly) < 1e-9, `${onCourse} is the smoothing alone, ${smoothOnly}`);
  assert.equal(beside, 0, "300 ft away nothing is changed");
  // The data: a point every 16 ft, none where there is no course.
  assert.equal(plainData(1200).calm.length, 0);
  assert.ok(plainData(1200, { courses: [course] }).calm.length / 4 >= (40 * CELL_FT) / 16);
});

test("the noise repeats with the world", () => {
  // In space too: across x and z it repeats, up the height it does not need to.
  assert.equal(worldNoise3(12.5, 40, 900.25, 104, 3), worldNoise3(12.5 + WORLD_FT, 40, 900.25 - WORLD_FT, 104, 3));
  assert.notEqual(worldNoise3(12.5, 40, 900.25, 104, 3), worldNoise3(12.5, 97, 900.25, 104, 3));
  for (const periods of [60, 96, 140, 1150]) {
    assert.ok(Math.abs(worldNoise(12.5, 900.25, periods, 3) - worldNoise(12.5 + WORLD_FT, 900.25 - WORLD_FT, periods, 3)) < 1e-9);
    const samples = Array.from({ length: 400 }, (_, i) => worldNoise(i * 17.3, i * 5.1, periods, 3));
    assert.ok(Math.max(...samples) <= 1.1 && Math.min(...samples) >= -1.1);
    assert.ok(Math.max(...samples) > 0.3 && Math.min(...samples) < -0.3);
  }
});

test("a drawn truck is seated on the drawn ground, wheel by wheel, and left alone in the air", () => {
  // Ground whose drawn surface stands a known amount above the game's, by where the wheel is.
  const relief = { simAt: () => 10, offsetAt: (x) => (x > 0 ? 0.6 : 0.2) };
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const hubs = [[4, 0, 6], [-4, 0, 6], [4, 0, -6], [-4, 0, -6]];
  const axles = [{ articulation: 0, travel: -1 }, { articulation: 0, travel: -1 }];
  // The body 4 ft up: the hubs at 13 ft, the treads on the ground at 10 ft.
  const pose = { pos: [0, 14, 0], matrix: identity, axles, steer: 0.1 };
  const seated = conformPose(pose, relief, hubs, 3);
  assert.ok(Math.abs(seated.pos[1] - 14.4) < 1e-9, "lifted by the mean of 0.6 and 0.2");
  assert.ok(Math.abs(seated.seatLift - 0.4) < 1e-9);
  assert.equal(seated.steer, 0.1, "the rest of the pose is kept");
  // Each wheel ends where the drawn ground is: the right ones 0.6 ft up, the left 0.2, as the truck draws its hubs.
  const hubHeight = (p, i) => p.pos[1] + hubs[i][0] * Math.sin(p.axles[i < 2 ? 0 : 1].articulation) + p.axles[i < 2 ? 0 : 1].travel;
  [0.6, 0.2, 0.6, 0.2].forEach((lift, i) => assert.ok(Math.abs(hubHeight(seated, i) - hubHeight(pose, i) - lift) < 2e-3, `wheel ${i}`));
  assert.equal(pose.axles[0].travel, -1, "the pose given is not changed");
  // Ten feet up: nothing is moved, and the pose comes back as it was.
  const flying = { pos: [0, 24, 0], matrix: identity, axles };
  assert.equal(conformPose(flying, relief, hubs, 3), flying);
  // One foot of air under the treads still seats fully; three feet about half.
  const hopping = conformPose({ pos: [0, 17, 0], matrix: identity, axles }, relief, hubs, 3);
  assert.ok(hopping.pos[1] - 17 > 0.15 && hopping.pos[1] - 17 < 0.25);
  // The drawn ground may stand feet off the game's: no wheel is moved further than the limit.
  const crag = { simAt: () => 10, offsetAt: () => 9 };
  assert.equal(conformPose({ pos: [0, 14, 0], matrix: identity, axles }, crag, hubs, 3).pos[1], 14 + SEAT_LIMIT_FT);
  // On ground too steep to hold (the game's slope over 1 in 1) a truck is sliding, not standing: it is left alone.
  const cliff = { simAt: () => 10, offsetAt: () => 2, simSlopeAt: () => 1.4 };
  const sliding = { pos: [0, 14, 0], matrix: identity, axles };
  assert.equal(conformPose(sliding, cliff, hubs, 3), sliding);
  // In Snow the water is ice, level and above its bed: a wheel over it stands on the ice, not on the drawn bed.
  assert.equal(conformPose(pose, relief, hubs, 3, 11), pose);
  assert.ok(conformPose(pose, relief, hubs, 3, 9).pos[1] > 14, "ice below this ground changes nothing");
  // The tire's radius comes from its model, or is the game's 66 inch tire.
  assert.equal(tireRadiusFt({ bounds: { min: [-1, -2.9, -2.9], max: [1, 2.9, 2.9] } }), 2.9);
  assert.equal(tireRadiusFt(null), 2.75);
});

test("relief data: crag is the mean of the four cells at a corner", () => {
  const clr = new Uint16Array(CELLS);
  clr[5 * GRID + 5] = 1;
  const data = buildReliefData({ clr, textureValues: [100, 1200] });
  // Cell (5, 5) is rock among cement: its four corners each see one rock cell in four.
  for (const [row, col] of [[5, 5], [5, 6], [6, 5], [6, 6]]) assert.equal(data.crag[row * GRID + col], Math.round(255 / 4));
  assert.equal(data.crag[4 * GRID + 4], 0);
  assert.equal(data.keepouts.length, 0);
});
