/*
  What a replay does not record, read off the picture (docs/VISUALS.md, "In a replay"): which
  wheels are on the ground, and where the hull is down on it.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { HULL_DOWN_FT, HULL_STRIKE_FT_PER_S, ON_GROUND_FT, replayContacts } from "../src/game/replay-effects.js";

const flat = () => 10;

test("a hull point down on the ground is a contact; one off it is not", () => {
  assert.equal(ON_GROUND_FT, 0.35);
  assert.equal(HULL_DOWN_FT, 0.25);
  const last = new Map();
  // Zone 3 is on the ground, zone 4 just off it, the others high.
  const hull = (zone) => [100, zone === 3 ? 10.1 : zone === 4 ? 10.4 : 14, 200];
  const contacts = replayContacts({ hull, ground: flat, last, dt: 1 / 30 });
  assert.deepEqual(contacts, [{ zone: 3, steps: 2, force: 0 }]);
  assert.equal(last.get(4), 10.4 - 10);
  assert.equal(last.size, 12);
  // A zone the truck has no point for is left out.
  assert.deepEqual(replayContacts({ hull: () => null, ground: flat, last: new Map(), dt: 1 / 60 }), []);
});

test("a point that came down hard this frame struck the ground, with the force of how fast; one that settles did not", () => {
  assert.equal(HULL_STRIKE_FT_PER_S, 8);
  const last = new Map([[1, 0.8], [2, 0.3]]);
  const hull = (zone) => (zone <= 2 ? [0, 10, 0] : [0, 20, 0]);
  const contacts = replayContacts({ hull, ground: flat, last, dt: 1 / 60 });
  // Zone 1 fell 0.8 ft in a sixtieth of a second: 48 ft/s. Zone 2 fell 0.3: 18 ft/s.
  assert.equal(contacts.length, 2);
  assert.ok(Math.abs(contacts[0].force - 48 * 60) < 1e-6);
  assert.ok(Math.abs(contacts[1].force - 18 * 60) < 1e-6);
  // Slowly down onto the ground, it scrapes and does not strike.
  const slow = replayContacts({ hull: () => [0, 10, 0], ground: flat, last: new Map([[1, 0.3]]), dt: 0.1 });
  assert.equal(slow.find((c) => c.zone === 1).force, 0);
  // Already down a frame ago, and still: a scrape.
  const still = replayContacts({ hull: () => [0, 10, 0], ground: flat, last: new Map([[1, 0]]), dt: 1 / 60 });
  assert.equal(still[0].force, 0);
  // A frame of film that does not move counts as one step and strikes nothing.
  const paused = replayContacts({ hull: () => [0, 10, 0], ground: flat, last: new Map([[1, 2]]), dt: 0 });
  assert.deepEqual(paused[0], { zone: 1, steps: 1, force: 0 });
});
