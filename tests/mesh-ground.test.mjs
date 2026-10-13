// Surfaces over the terrain (a bridge's deck, a rock: 4x4 Evolution's `meshGround`): a truck must stand on one on its
// wheels. The wheels once measured the terrain under the deck while the hull met the deck, so the truck lay on its
// belly with the wheels hanging and could not be driven (a player's report, Deja Voodoo's bridges).

import test from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/worker/sim-worker.js";

const deck = (y) => ({
  positions: new Float32Array([400, y, 400, 400, y, 700, 600, y, 700, 400, y, 400, 600, y, 700, 600, y, 400]), surfaceValues: new Int32Array([1100, 1100]),
});
const session = (meshGround, y) => createSession({
  heights: new Uint8Array(65536).fill(50).buffer, weather: 0, difficulty: 1, boxes: [], ramps: [], course: [], meshGround,
  trucks: [{ truck: {}, start: { pos: [500, y, 450], heading: 0 }, autopilot: false }],
});

test("on a deck 30 ft over the ground a truck rests on its wheels, as high over it as over the terrain, and drives", () => {
  const plain = session(null, 106);
  for (let i = 0; i < 120; i++) plain.step({});
  const ride = plain.state.pos[1] - 100;
  const up = session(deck(130), 136);
  for (let i = 0; i < 120; i++) up.step({});
  assert.ok(up.state.tires.every((t) => t.onGround), "all four wheels on the deck");
  assert.ok(Math.abs(up.state.pos[1] - 130 - ride) < 0.05, `rides ${up.state.pos[1] - 130} ft over the deck, ${ride} over the terrain`);
  for (let i = 0; i < 180; i++) up.step({ accelerate: true });
  assert.ok(up.state.pos[2] > 480, `drove to z ${up.state.pos[2]}`);
  assert.ok(Math.abs(up.state.pos[1] - 130 - ride) < 0.5);
  assert.equal(up.state.heliTimer, 0, "not fetched by the helicopter as a truck that is stuck");
});

test("dropped hard onto a deck a truck stays on it; under the deck, the deck is not its ground", () => {
  const dropped = session(deck(130), 160);
  for (let i = 0; i < 300; i++) dropped.step({});
  assert.ok(dropped.state.pos[1] > 133 && dropped.state.pos[1] < 138, `at ${dropped.state.pos[1]}`);
  const under = session(deck(130), 106);
  for (let i = 0; i < 120; i++) under.step({});
  assert.ok(under.state.pos[1] > 104 && under.state.pos[1] < 108, `at ${under.state.pos[1]}: on the terrain, under the deck`);
  assert.ok(under.state.tires.every((t) => t.onGround));
});

test("driving off the end of a deck a truck falls to the ground under it", () => {
  const off = session(deck(110), 116);
  for (let i = 0; i < 60; i++) off.step({});
  for (let i = 0; i < 900 && off.state.pos[2] < 760; i++) off.step({ accelerate: true });
  for (let i = 0; i < 240; i++) off.step({});
  assert.ok(off.state.pos[2] > 700, `left the deck at z ${off.state.pos[2]}`);
  assert.ok(off.state.pos[1] < 109, `on the terrain at ${off.state.pos[1]}`);
});

test("a truck whose state blows up is put back as it last stood, and the race goes on", async () => {
  const { copyState, restoreState, stateIsSane } = await import("../src/worker/sim-worker.js");
  const s = session(null, 106);
  for (let i = 0; i < 90; i++) s.step({});
  const stood = [...s.state.pos];
  assert.ok(stateIsSane(s.state));
  // A copy holds its own numbers; putting it back keeps the live objects.
  const copy = copyState(s.state), tires = s.state.tires, pos = s.state.pos;
  s.state.pos[0] = 1; s.state.tires[0].spin = 99;
  restoreState(s.state, copy);
  assert.equal(s.state.pos, pos);
  assert.equal(s.state.tires, tires);
  assert.equal(s.state.pos[0], stood[0]);
  assert.notEqual(s.state.tires[0].spin, 99);
  for (const broken of [(st) => { st.bvel[1] = Infinity; }, (st) => { st.pos[0] = NaN; }, (st) => { st.bvel[2] = 1e9; }, (st) => { st.pos[1] = 1e30; }]) {
    broken(s.state);
    assert.equal(stateIsSane(s.state), false);
    const began = Date.now();
    s.step({});
    assert.ok(Date.now() - began < 1000, "the step returns");
    assert.ok(stateIsSane(s.state));
    assert.ok(Math.hypot(s.state.pos[0] - stood[0], s.state.pos[1] - stood[1], s.state.pos[2] - stood[2]) < 2, `back at ${[...s.state.pos]}`);
    for (let i = 0; i < 30; i++) s.step({});
  }
  assert.equal(s.trucks[0].rescued, 4);
});
