// The physics models a race can run under (app/settings.js), and that the simulation knows each one's rules.

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, PHYSICS_MODELS, physicsModel } from "../src/app/settings.js";
import { mtm2Sim as S } from "../src/vendor/openphotex/index.js";
import { createSession } from "../src/worker/sim-worker.js";

test("the list: MTM2 first and the default, then the 1996 game; an unknown id is MTM2", () => {
  assert.deepEqual(PHYSICS_MODELS.map((m) => m.id), ["mtm2", "mtm1"]);
  assert.equal(DEFAULT_SETTINGS.physics, "mtm2");
  assert.equal(physicsModel("mtm1").label, "Monster Truck Madness");
  assert.equal(physicsModel("nothing").id, "mtm2");
  assert.equal(physicsModel(undefined).id, "mtm2");
  for (const m of PHYSICS_MODELS) assert.equal(S.simRules(m.id).id, m.id, `the simulation has rules for ${m.id}`);
});

test("a session takes its rules from the race: rain cuts the grip under MTM2's, not under the 1996 game's", () => {
  const init = (rules) => ({
    heights: new Uint8Array(65536).fill(50).buffer, weather: S.WEATHER.RAIN, difficulty: 1, rules,
    trucks: [{ truck: {}, start: { pos: [1000, 100, 1000], heading: 0 }, autopilot: false }],
  });
  const grip = (rules) => {
    const session = createSession(init(rules));
    return S.groundWeatherGrip(session.ground);
  };
  assert.equal(grip(undefined), 0.8);
  assert.equal(grip("mtm2"), 0.8);
  assert.equal(grip("mtm1"), 1);
});
