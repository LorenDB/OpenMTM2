/*
  Tag (docs/PLAN.md, "Party modes"): its rules and computer trucks (src/game/tag.js),
  played in the simulation worker's session.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  AIM_MIN_S, AIM_MAX_S, CALM_COVER_SHARE, COVER_REACH_FT, FLANK_FT, HIDE_STANDOFF_FT, IT_ARROW, IT_START_HOLD_S,
  PRESS_FT, PRESSED_COVER_SHARE, ROAM_FT, ROAM_MARGIN_FT, TAG_BACK_S, WANDER_SHARE, chasePoint, clampToRect,
  coverBetween, coverOf, createTag, createTagDriver, fleePoint, flankPoint, hideBehind, hideScore, rampAway, rampLaunch,
  roamRect, routePoint, tagDrivePoint, tagHeld, tagItDrain, tagPlaces, tagRanks, tagSafe, tagStep, tagTransfer, wanderPoint,
} from "../src/game/tag.js";
import { WORLD_FT } from "../src/shared/scene-frame.js";
import { GAME_MODES, raceLengthLabel } from "../src/game/menu-data.js";
import { winnerCells } from "../src/ui/screens/results.js";
import { createSession } from "../src/worker/sim-worker.js";
import { buildTrackRender } from "../src/worker/track-build.js";
import { mtm2Sim as S } from "../src/vendor/openphotex/index.js";
import { skipWithoutStock, stockVfs } from "./helpers/stock.mjs";

test("Tag: It is held 5 s at the start without draining, a touch hands it on with no post-tag hold, and may not tag back for 10 s", () => {
  const tag = createTag(3, () => 0.5);
  assert.equal(tag.it, 1);
  assert.ok(tagHeld(tag, 1, IT_START_HOLD_S - 0.1) && !tagHeld(tag, 0, IT_START_HOLD_S - 0.1));
  assert.equal(tagStep(tag, IT_START_HOLD_S - 0.1, 1, [[0, 1]]), null, "no tag while It is held at the start");
  assert.deepEqual(tag.points, [100, 100, 100], "no point change during the opening hold");
  // At IT_START_HOLD_S with dt=1: trucks 0 and 2 gain +1 (101, tied for rank 1), truck 1 loses -1 (99, rank 3), then truck 1 tags truck 2 for 28.
  assert.deepEqual(tagStep(tag, IT_START_HOLD_S, 1, [[2, 0], [1, 2]]), { kind: "tag", from: 1, to: 2, points: 28 });
  assert.equal(tag.it, 2);
  assert.deepEqual(tag.points, [101, 127, 73]);
  assert.deepEqual(tagRanks(tag), [2, 1, 3]);
  assert.ok(!tagHeld(tag, 2, IT_START_HOLD_S + 0.1), "the new It is not held after a tag");
  assert.ok(tagSafe(tag, 1, IT_START_HOLD_S + TAG_BACK_S - 0.1));
  assert.equal(tagStep(tag, IT_START_HOLD_S + 5, 1, [[2, 1]]), null, "no tag-backs");
  // Next step (dt=1): trucks 0 and 1 gain +1 (102, 128), truck 2 loses -1 (71), then truck 2 tags truck 0 (rank 2 -> 18 points).
  assert.deepEqual(tagStep(tag, IT_START_HOLD_S + 5, 1, [[2, 0]]), { kind: "tag", from: 2, to: 0, points: 18 });
  // Time as It: truck 1 for the first two steps, truck 2 for the next two.
  assert.deepEqual(tag.itTime, [0, 2, 2]);
  assert.deepEqual(tag.points, [85, 129, 89], "two tags plus +1/s free and -1/s while It after the start hold");
  assert.deepEqual(tagPlaces(tag), [3, 1, 2]);
});

test("Tag scores +1/s for free trucks and -1/s for It on whole seconds after the start hold", () => {
  const tag = createTag(2, () => 0);
  assert.equal(tag.it, 0);
  tagStep(tag, 0, 5, []);
  assert.deepEqual(tag.points, [100, 100], "no score change during the 5 s start hold");
  tagStep(tag, IT_START_HOLD_S, 0.4, []);
  tagStep(tag, IT_START_HOLD_S + 0.4, 0.4, []);
  assert.deepEqual(tag.points, [100, 100], "under 1 s accumulated: no whole second ticked yet");
  tagStep(tag, IT_START_HOLD_S + 0.8, 0.4, []);
  assert.deepEqual(tag.points, [99, 101], "1 s crossed: It loses 1, free gains 1");
  tagStep(tag, IT_START_HOLD_S + 1.2, 4, []);
  assert.equal(tagItDrain(5), 5);
  assert.deepEqual(tag.points, [95, 105]);
});

test("Tag's point transfer scales with the victim's place and takes at most what the victim has left", () => {
  assert.equal(tagTransfer(4, 1), 28);
  assert.equal(tagTransfer(4, 4), 8);
  assert.equal(tagTransfer(2, 1), 28);
  assert.equal(tagTransfer(2, 2), 8);
  const tag = createTag(2, () => 0);
  tag.points = [50, 5];
  assert.deepEqual(tagStep(tag, IT_START_HOLD_S, 0, [[0, 1]]), { kind: "tag", from: 0, to: 1, points: 5 });
  assert.deepEqual(tag.points, [55, 0]);
});

test("Tag's computer trucks: It leads the nearest quarry; the others run from It and keep near home", () => {
  const p = chasePoint([0, 0, 0], [null, { pos: [160, 0, 0], vel: [0, 0, 50] }, { pos: [400, 0, 0], vel: [0, 0, 0] }]);
  assert.deepEqual(p, [160, 0, 75], "160 ft away: 2 s ahead, capped at 1.5 s");
  assert.equal(chasePoint([0, 0, 0], [null, null]), null);
  const leader = chasePoint([0, 0, 0], [null, { pos: [100, 0, 0], vel: [0, 0, 0], place: 4 }, { pos: [130, 0, 0], vel: [0, 0, 0], place: 1 }]);
  assert.deepEqual(leader, [130, 0, 0], "a leader slightly farther beats a nearer last-place truck");
  const near = chasePoint([0, 0, 0], [null, { pos: [50, 0, 0], vel: [0, 0, 0], place: 4 }, { pos: [200, 0, 0], vel: [0, 0, 0], place: 1 }]);
  assert.deepEqual(near, [50, 0, 0], "a much nearer quarry still wins");
  const closeLeader = chasePoint([0, 0, 0], [{ pos: [20, 0, 0], vel: [0, 0, 80], place: 1 }]);
  assert.deepEqual(closeLeader, [20, 0, 20], "within CHASE_RANK_FT the lead still uses real distance (0.25 s ahead), not negative cost");
  const away = fleePoint([100, 0, 0], [0, 0, 0]);
  assert.ok(away[0] > 200);
  const kept = fleePoint([480, 0, 0], [380, 0, 0], 0, [0, 0]);
  assert.ok(Math.hypot(kept[0], kept[2]) <= 500 + 1e-9);
});

/** A repeatable roll in [0, 1). */
function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const ROAM = { minX: 0, maxX: 2000, minZ: 0, maxZ: 1600 };
const flat = () => 20;
/** `values` in order, then the last one again. */
const scripted = (values) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};

test("Tag's trucks roam the ground around the course, not a lap, and stay on the map", () => {
  const around = roamRect([[2000, 2000], [2800, 2000], [2800, 2600], [2000, 2600]], [2100, 2100]);
  assert.ok(Math.abs(around.minX - (2000 - ROAM_MARGIN_FT)) < 1);
  assert.ok(Math.abs(around.maxX - (2800 + ROAM_MARGIN_FT)) < 1);
  assert.ok(Math.abs(around.minZ - (2000 - ROAM_MARGIN_FT)) < 1);
  assert.ok(Math.abs(around.maxZ - (2600 + ROAM_MARGIN_FT)) < 1);
  const homeOnly = roamRect([], [1000, 2000]);
  assert.equal(homeOnly.minX, 96);
  assert.ok(Math.abs(homeOnly.maxX - (1000 + ROAM_FT)) < 1);
  assert.ok(Math.abs(homeOnly.minZ - (2000 - ROAM_FT)) < 1);
  assert.ok(Math.abs(homeOnly.maxZ - (2000 + ROAM_FT)) < 1);
  assert.ok(homeOnly.minX <= 1000 && homeOnly.maxX >= 1000);
  const edge = roamRect([[100, 100], [WORLD_FT - 50, 4000]], [200, 200]);
  assert.ok(edge.minX >= 96 && edge.maxX <= WORLD_FT - 96 && edge.minZ >= 96 && edge.maxZ <= WORLD_FT - 96);
  const p = wanderPoint(ROAM, () => 0.25);
  assert.equal(p[0], 500);
  assert.equal(p[2], 400);
  assert.deepEqual(clampToRect([-10, 3, 9000], ROAM), [0, 3, 1600]);
});

test("Tag's trucks treat high ground, a ridge and a solid object as an advantage, and avoid water and a drop", () => {
  const it = [0, 0, 0];
  const spot = [0, 0, 300];
  const open = hideScore(spot, it, flat, []);
  const high = hideScore(spot, it, (_x, z) => (z > 150 ? 28 : 0), []);
  assert.ok(high > open, "high ground scores above level ground");
  const ridge = hideScore(spot, it, (_x, z) => (z > 100 && z < 200 ? 24 : 4), []);
  assert.ok(ridge > open, "a ridge between the truck and It scores above open ground");
  const barn = [{ pos: [0, 8, 150], reach: 24, tall: 18 }];
  assert.equal(coverBetween(barn, it, spot)?.tall, 18);
  assert.equal(coverBetween([{ pos: [80, 0, 0], reach: 10, tall: 20 }], it, spot), null, "a cover off to the side is not on the way");
  assert.ok(hideScore(spot, it, flat, barn) > open, "an object between the spot and It is cover");
  const wet = hideScore(spot, it, flat, [], { water: 30 });
  assert.ok(wet < open - 50, "a point under the water is refused");
  const cliff = hideScore(spot, it, (_x, z) => (z > 50 ? -30 : 10), [], { from: [0, 0, 0] });
  const level = hideScore(spot, it, () => 10, [], { from: [0, 0, 0] });
  assert.ok(cliff < level, "a long drop scores below level ground");
  // Too small, or a kind that never collides, is not cover.
  assert.equal(coverOf({ pos: [0, 0, 0], half: [2, 2, 2], type: 0 }), null);
  assert.equal(coverOf({ pos: [0, 0, 0], half: [20, 10, 20], type: 7 }), null);
  const building = coverOf({ pos: [5, 6, 7], half: [12, 8, 10], type: 0 });
  assert.ok(building.reach >= COVER_REACH_FT && building.tall >= 8 && building.pos[0] === 5);
});

test("a free truck mostly wanders; close to It it hides or runs, and a cover pulls the hiding spot behind it", () => {
  const base = { rect: ROAM, covers: [], ramps: [], heightAt: flat, water: null };
  let wander = 0;
  const random = mulberry(3);
  for (let i = 0; i < 80; i++) {
    const driver = createTagDriver();
    tagDrivePoint(driver, "free", { ...base, clock: 0, pos: [800, 0, 700], itPos: [100, 0, 100], random });
    if (driver.kind === "wander") wander++;
  }
  assert.ok(wander > 40, `${wander} of 80 aims wandered, which is the common choice`);
  for (let i = 0; i < 30; i++) {
    const driver = createTagDriver();
    tagDrivePoint(driver, "free", { ...base, clock: 0, pos: [40, 0, 0], itPos: [0, 0, 0], random: mulberry(10 + i) });
    assert.notEqual(driver.kind, "wander", "within PRESS_FT a truck does not wander");
    assert.ok(Math.hypot(40, 0) < PRESS_FT);
  }
  const barn = [{ pos: [500, 6, 500], reach: 30, tall: 24 }];
  const driver = createTagDriver();
  // 0.7 is past the wander share and inside the cover share.
  assert.ok(WANDER_SHARE < 0.7 && 0.7 < WANDER_SHARE + CALM_COVER_SHARE);
  const point = tagDrivePoint(driver, "free", {
    ...base, covers: barn, clock: 0, pos: [400, 0, 400], itPos: [100, 0, 100], random: scripted([0.7]),
  });
  assert.equal(driver.kind, "cover");
  const behind = hideBehind(barn[0], [100, 0, 100]);
  assert.ok(Math.hypot(driver.point[0] - behind[0], driver.point[2] - behind[2]) < 1, "the place it means to reach is the far side of the barn");
  assert.ok(behind[0] > barn[0].pos[0] && behind[2] > barn[0].pos[2]);
  assert.ok(Math.hypot(behind[0] - barn[0].pos[0], behind[2] - barn[0].pos[2]) >= barn[0].reach + HIDE_STANDOFF_FT - 1e-6);
  assert.ok(Math.hypot(point[0] - driver.point[0], point[2] - driver.point[2]) > 5, "the barn is on the way, so the truck steers wide of it");
  // The same aim is kept until it is time, or the truck arrives.
  const held = tagDrivePoint(driver, "free", {
    ...base, covers: barn, clock: 1, pos: [400, 0, 400], itPos: [100, 0, 100], random: () => { throw new Error("repicked"); },
  });
  assert.ok(Math.hypot(held[0] - point[0], held[2] - point[2]) < 1e-6);
  assert.ok(driver.until >= AIM_MIN_S && driver.until <= AIM_MAX_S);
  const arrived = tagDrivePoint(driver, "free", {
    ...base, covers: [], clock: 1, pos: [driver.point[0], 0, driver.point[2]], itPos: [100, 0, 100], random: scripted([0.1, 0.2, 0.3, 0]),
  });
  assert.equal(driver.kind, "wander");
  assert.ok(Math.hypot(arrived[0] - driver.point[0], arrived[2] - driver.point[2]) < 1);
  // Pressed: 0.8 is past the cover share, so it runs.
  assert.ok(0.8 > PRESSED_COVER_SHARE);
  const runner = createTagDriver();
  const fled = tagDrivePoint(runner, "free", {
    ...base, clock: 0, pos: [400, 0, 400], itPos: [450, 0, 400], random: scripted([0.8, 0.5, 0]),
  });
  assert.equal(runner.kind, "flee");
  assert.ok(fled[0] < 400, "a run goes away from It");
});

test("It goes around an object, up a slope, and up a ramp that faces its quarry", () => {
  const barn = { pos: [100, 5, 0], reach: 20, tall: 16 };
  const from = [0, 0, 0], to = [200, 0, 0];
  const around = flankPoint(from, to, barn);
  assert.ok(Math.abs(around[0] - 100) < 1e-6);
  assert.ok(Math.abs(Math.abs(around[2]) - (barn.reach + FLANK_FT)) < 1e-6);
  const steered = routePoint(from, to, [barn], flat);
  assert.ok(Math.abs(steered[2]) > barn.reach, "the steer point is wide of the barn, not through it");
  const climb = routePoint(from, [200, 0, 0], [], (x) => (x > 150 ? 40 : x > 40 ? 12 : 0));
  assert.ok(Math.abs(climb[0] - 80) < 1e-6, "a quarry well above is approached part way up the slope");
  // Body +z along +x: the nose is the high end.
  const ramp = { pos: [150, 0, 0], length: 40, height: 12, matrix: [0, 0, 1, 0, 1, 0, 0, 0, 0] };
  const tail = rampLaunch(from, [400, 0, 0], [ramp]);
  assert.ok(tail && Math.abs(tail[0] - 130) < 1e-6 && Math.abs(tail[2]) < 1e-6);
  assert.equal(rampLaunch(from, [400, 0, 0], [{ ...ramp, matrix: [0, 0, -1, 0, 1, 0, 0, 0, 0] }]), null, "a ramp facing the wrong way is ignored");
  assert.equal(rampLaunch([0, 0, 0], [80, 0, 0], [ramp]), null, "a close quarry is chased, not left for a ramp");
  const away = rampAway([100, 0, 0], [0, 0, 0], [ramp]);
  assert.ok(away && Math.abs(away[0] - 130) < 1e-6);
  const driver = createTagDriver();
  const chased = tagDrivePoint(driver, "it", {
    clock: 0, pos: from, itPos: from, quarry: [{ pos: [400, 4, 0], vel: [0, 0, 0] }],
    rect: ROAM, covers: [], ramps: [ramp], heightAt: flat, water: null, random: () => { throw new Error("no wander"); },
  });
  assert.equal(driver.kind, "ramp");
  assert.ok(Math.abs(chased[0] - 130) < 1e-6);
  const blocked = tagDrivePoint(createTagDriver(), "it", {
    clock: 0, pos: from, itPos: from, quarry: [{ pos: [200, 0, 0], vel: [0, 0, 0] }],
    rect: ROAM, covers: [barn], ramps: [], heightAt: flat, water: null, random: () => { throw new Error("no wander"); },
  });
  assert.ok(Math.abs(blocked[2]) > 1, "It does not steer through the barn");
});

test("the It marker is an arrow pointing down, wound so its +Z face is the front", () => {
  const tip = IT_ARROW[0];
  for (const p of IT_ARROW) assert.ok(p[1] >= tip[1]);
  assert.ok(IT_ARROW.filter((p) => p[1] === tip[1]).length === 1);
  assert.ok(IT_ARROW.some((p) => p[0] < -2) && IT_ARROW.some((p) => p[0] > 2), "the head is wider than the shaft");
  assert.ok(IT_ARROW.some((p) => Math.abs(p[0]) < 1 && p[1] > 2), "the shaft rises above the head");
  let area = 0;
  for (let i = 0; i < IT_ARROW.length; i++) {
    const a = IT_ARROW[i], b = IT_ARROW[(i + 1) % IT_ARROW.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  assert.ok(area > 0, "counter-clockwise seen from +Z, the side turned toward the camera");
});

test("the Races screen's modes and their length box", () => {
  assert.deepEqual(GAME_MODES.map((m) => m.id), ["default", "freeroam", "flyby", "tag"]);
  assert.equal(raceLengthLabel("rally", "tag"), "Minutes");
  assert.equal(raceLengthLabel("rally"), "Laps");
  assert.equal(raceLengthLabel("circuit", "freeroam"), "Laps");
  assert.equal(raceLengthLabel("summit", "flyby"), "Minutes");
  // The results: the score, and the game's length for the time.
  assert.deepEqual(winnerCells({ place: 1, name: "A", truckName: "B", score: 41.6, raceTime: 300, best: 12 }, { party: true }).slice(4), ["42", "05:00.00", ""]);
});

test("Tag on Farm Road 29: It sits in Park through its hold, and a touch makes the other truck It", { skip: skipWithoutStock("POD.INI") }, async () => {
  const build = await buildTrackRender(stockVfs(), "WORLD\\TPARK.SIT");
  const files = Object.keys(build.truckModels);
  // Two trucks far apart on the grid's line, the second driving the course.
  const grid = build.sim.grid;
  const session = createSession({
    heights: build.heights.buffer, clr: build.sim.clr.buffer, textureValues: build.sim.textureValues.buffer,
    ra0: build.sim.ra0?.buffer, ra1: build.sim.ra1?.buffer, boxes: build.sim.boxes, ramps: build.sim.ramps,
    waterLevelFt: build.waterLevelFt, weather: 0, difficulty: 1, course: build.sim.course,
    trucks: [0, 1].map((i) => ({
      truck: { anchors: build.truckModels[files[i]].anchors, scrapePoints: build.truckModels[files[i]].scrapePoints },
      start: { pos: grid[i * 7].pos, heading: grid[i * 7].heading }, autopilot: i === 1,
    })),
    race: { checkpoints: [], laps: 1, mode: "circuit" }, party: { mode: "tag", minutes: 1, it: 0, byCourse: true },
  });
  let r;
  for (let t = 0; t < 3 + IT_START_HOLD_S - 1; t += 0.25) {
    r = session.advance(t, { accelerate: true });
    if (r.race.started) assert.equal(session.trucks[0].state.controls.gear, S.GEAR.PARK, "It is held");
  }
  assert.equal(r.race.party.it, 0);
  // byCourse is set, and ignored: the free truck drives at a point on the ground around the course, not the lap.
  assert.equal(session.trucks[1].recovery.player, true);
  assert.equal(session.trucks[1].recovery.autopilot, false);
  const roam = Math.hypot(session.trucks[1].state.pos[0] - grid[7].pos[0], session.trucks[1].state.pos[2] - grid[7].pos[2]);
  assert.ok(roam > 30, `the free truck roamed ${roam} ft`);
  for (let t = 3 + IT_START_HOLD_S - 1; t < 3 + IT_START_HOLD_S + 1; t += 0.25) r = session.advance(t, {});
  // Free now: put the other truck against It's side.
  const it = session.trucks[0].state, other = session.trucks[1].state;
  other.pos.set([it.pos[0] + Math.cos(it.euler[2]) * 9, it.pos[1], it.pos[2] - Math.sin(it.euler[2]) * 9]);
  other.prevPos.set(other.pos);
  other.bvel.fill(0);
  for (let t = 3 + IT_START_HOLD_S + 1; t < 3 + IT_START_HOLD_S + 3; t += 0.25) r = session.advance(t, {});
  assert.equal(r.race.party.it, 1, "the touch made truck 1 It");
  assert.deepEqual(r.race.party.event, { kind: "tag", from: 0, to: 1, points: 28 });
  // The game ends at its minute.
  for (let t = 3 + IT_START_HOLD_S + 3; t < 3 + 62; t += 0.25) r = session.advance(t, {});
  assert.ok(r.race.over && r.race.trucks.every((x) => x.finished));
});
