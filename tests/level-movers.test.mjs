import test from "node:test";
import assert from "node:assert/strict";
import { createLevelMovers } from "../src/game/level-movers.js";
import { terrainOfBuild } from "../src/shared/build-terrain.js";
import { buildTrackRender } from "../src/worker/track-build.js";
import { skipWithoutStock, stockVfs } from "./helpers/stock.mjs";

test("a level with no moving objects has nothing to step", () => {
  const movers = createLevelMovers({ boxes: [{ type: 0, positionFt: [0, 0, 0] }], ra0: null, ra1: null }, null);
  assert.equal(movers.count, 0);
  assert.deepEqual(movers.update(1), []);
});

test("the fly-by's movers: TPARK's train runs along its bvel in the simulation's 1/60 s steps", { skip: skipWithoutStock("POD.INI") }, async () => {
  const build = await buildTrackRender(stockVfs(), "WORLD\\TPARK.SIT");
  const moving = build.sim.boxes.filter((b) => b.type === 10);
  const movers = createLevelMovers(build.sim, terrainOfBuild(build));
  assert.equal(movers.count, moving.length);
  // Less than a step: nothing moves yet. Then a quarter second in all: 15 steps.
  assert.deepEqual(movers.update(0.01), []);
  const moves = movers.update(0.24);
  const first = moving[0], pose = moves.find((m) => m.sitIndex === first.sitIndex);
  assert.ok(pose && pose.matrix.length === 9);
  const moved = Math.hypot(pose.pos[0] - first.positionFt[0], pose.pos[2] - first.positionFt[2]);
  const expected = Math.hypot(first.bvel[0], first.bvel[2]) * 15 / 60;
  assert.ok(Math.abs(moved - expected) < 1e-3, `moved ${moved} of ${expected}`);
});
