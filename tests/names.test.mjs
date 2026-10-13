// The Names key's cycle (game/names.js): nothing, trucks, drivers, both.

import test from "node:test";
import assert from "node:assert/strict";
import { NAMES_BOTH, NAMES_DRIVERS, NAMES_OFF, NAMES_TRUCKS, nameLabel, nameLine, nextNamesMode } from "../src/game/names.js";

const truckName = (file) => ({ "BIGFOOT.TRK": "Bigfoot" }[file] ?? file);
const entrant = { file: "BIGFOOT.TRK", name: "Sam" };

test("N goes round four states: off, trucks, drivers, both, off", () => {
  const seen = [NAMES_OFF];
  for (let i = 0; i < 4; i++) seen.push(nextNamesMode(seen[seen.length - 1]));
  assert.deepEqual(seen, [NAMES_OFF, NAMES_TRUCKS, NAMES_DRIVERS, NAMES_BOTH, NAMES_OFF]);
});

test("the label by state: the truck, the driver, or the driver over the truck", () => {
  assert.equal(nameLabel(NAMES_OFF, entrant, truckName), null);
  assert.equal(nameLabel(NAMES_TRUCKS, entrant, truckName), "Bigfoot");
  assert.equal(nameLabel(NAMES_DRIVERS, entrant, truckName), "Sam");
  assert.deepEqual(nameLabel(NAMES_BOTH, entrant, truckName), ["Sam", "Bigfoot"]);
  // A driver with no name leaves the truck alone, on one line.
  assert.equal(nameLabel(NAMES_BOTH, { file: "BIGFOOT.TRK", name: "" }, truckName), "Bigfoot");
  assert.equal(nameLabel(NAMES_BOTH, null, truckName), null);
});

test("where there is one line (the course map), both names give the driver's", () => {
  assert.equal(nameLine(["Sam", "Bigfoot"]), "Sam");
  assert.equal(nameLine("Bigfoot"), "Bigfoot");
  assert.equal(nameLine(null), null);
});
