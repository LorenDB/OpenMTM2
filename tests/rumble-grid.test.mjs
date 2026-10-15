import test from "node:test";
import assert from "node:assert/strict";
import { rumbleGrid } from "../src/game/race-setup.js";

const zone = { position: [4139.5, 110, 4301.5], size: [300, 64, 300] };

test("a Rumble whose slots all stand far from its zone starts in a ring inside the zone, facing its centre", () => {
  const far = [{ file: "A", pos: [3582.5, 422, 3576], heading: 0 }, { file: "B", pos: [3610, 422, 3648], heading: 0 }];
  const moved = rumbleGrid(far, zone);
  for (const slot of moved) {
    assert.ok(Math.hypot(slot.pos[0] - 4139.5, slot.pos[2] - 4301.5) < 150);
    assert.ok(slot.pos[1] > 142);
  }
  assert.equal(moved[0].file, "A");
  // Facing the centre: the first slot stands north of it and looks south.
  assert.ok(Math.abs(Math.abs(moved[0].heading) - Math.PI) < 1e-9);
});

test("a Rumble with a slot near its zone keeps the SIT's grid, as the stock ones do", () => {
  const near = [{ file: "A", pos: [4000, 100, 4200], heading: 0 }, { file: "B", pos: [3582.5, 422, 3576], heading: 0 }];
  assert.equal(rumbleGrid(near, zone), near);
  assert.equal(rumbleGrid(near, null), near);
});
