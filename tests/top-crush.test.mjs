// Top-crush cars in a race (MTM2_PHYSICS.md 14.27): the simulation holds a truck up on one and flattens its cab, and
// the cab's model stands at the frame its crush says, where an animated model would be played in time.

import test from "node:test";
import assert from "node:assert/strict";
import { createSession, crushShare } from "../src/worker/sim-worker.js";

test("a cab's crush as a share of the most it can be", () => {
  const car = { body: { height: 3 }, cab: { height: 6 }, crush: 0 };
  assert.equal(crushShare(car), 0);
  car.crush = (1 - 3.25 / 6) / 2;
  assert.ok(Math.abs(crushShare(car) - 0.5) < 1e-12);
  car.crush = 1;
  assert.equal(crushShare(car), 1);
  // A cab no taller than the body cannot be crushed.
  assert.equal(crushShare({ body: { height: 5 }, cab: { height: 5 }, crush: 0.2 }), 0);
});

test("a truck dropped on a top-crush car rests on it and flattens its cab; the tick reports how far", () => {
  const session = createSession({
    heights: new Uint8Array(65536).fill(50).buffer, weather: 0, difficulty: 1, boxes: [], ramps: [], course: [],
    topCrush: [{
      positionFt: [500, 101.5, 500], position2Ft: [500, 0, 500], theta: 0, phi: 0, psi: 0,
      sizeFt: [30, 14, 3], size2Ft: [26, 12, 6], mass: 0, bvel: [0, 0, 0], rates: [0, 0, 0], bodyBounds: null, cabBounds: null,
    }],
    trucks: [{ truck: {}, start: { pos: [500, 118, 500], heading: 0 }, autopilot: false }],
  });
  assert.equal(session.crushCars.length, 1);
  for (let i = 0; i < 300; i++) session.step({});
  const car = session.crushCars[0];
  assert.ok(car.crush > 0.05, `crushed ${car.crush}`);
  assert.ok(crushShare(car) > 0.1 && crushShare(car) <= 1);
  assert.ok(session.state.pos[1] > 104, `the truck is held up at ${session.state.pos[1]} ft over ground at 100`);
});

test("without a top-crush car nothing is reported", () => {
  const session = createSession({
    heights: new Uint8Array(65536).fill(50).buffer, weather: 0, difficulty: 1,
    trucks: [{ truck: {}, start: { pos: [500, 106, 500], heading: 0 }, autopilot: false }],
  });
  assert.deepEqual(session.crushCars, []);
});
