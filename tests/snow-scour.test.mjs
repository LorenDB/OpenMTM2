/*
  A truck's body in the snow (docs/VISUALS.md, "Crashes in the snow"): the hollow it leaves is the
  part of its hull under the snow's surface, and a drag one long hollow.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { SCOUR, alignScour, bodyInSnow, convexHull, scourLid, scourLidFt, scourShape, scourSteps } from "../src/game/snow-scour.js";

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} is not ${b}`);

// A stock truck's hull points (BIGFOOT.TRK), in its own axes: bottom corners front and back, hood, cab roof, tail.
const HULL = [[-3.7, 0, 9.2], [3.7, 0, 9.2], [-3.7, 2.6, 9.2], [3.7, 2.6, 9.2], [-2.6, 5.2, 1.9], [2.6, 5.2, 1.9],
  [-2.1, 5.2, -0.8], [2.1, 5.2, -0.8], [-3.7, 2.8, -9.2], [3.7, 2.8, -9.2], [-3.7, 0, -9.2], [3.7, 0, -9.2]];
/** The hull at (x, z) as it lies: upside down (on its roof, the roof `sunkFt` under the snow's surface at 1 ft), or nose down by `pitch` radians. */
const onRoof = (x, z, sunkFt) => HULL.map(([px, py, pz]) => [x + px, 1 - sunkFt + (5.2 - py), z + pz]);
/** Snow lying `thickFt` thick over level ground at 0 ft. */
const snow = (thickFt) => () => ({ surfaceFt: thickFt, thickFt });
const area = (outline) => {
  const hull = convexHull(outline);
  let twice = 0;
  for (let i = 0; i < hull.length; i++) { const a = hull[i], b = hull[(i + 1) % hull.length]; twice += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(twice) / 2;
};

test("a truck on its roof in deep snow has its roof in it: a hollow the roof's size, as deep as it went", () => {
  const body = bodyInSnow(onRoof(100, 200, 0.6), snow(1));
  assert.ok(body);
  near(body.depthFt, 0.6);
  // The cab roof is 5.2 by 2.7 ft: what is under the surface reaches a little past it, where the cab's sides go down.
  const a = area(body.outline);
  assert.ok(a > 5.2 * 2.7 && a < 12 * 6, `area ${a}`);
  const shape = scourShape(body.outline, body.depthFt);
  near(shape.x, 100, 0.5);
  near(shape.z, 200 + 0.55, 0.6);
  assert.ok(shape.halfWidthFt >= 2.6 + SCOUR.marginFt - 1e-6 && shape.halfLengthFt >= shape.halfWidthFt);
  // Never deeper than the snow, less what the body packs under it.
  assert.equal(bodyInSnow(onRoof(100, 200, 3), snow(1)).depthFt, 1 - SCOUR.floorFt);
});

test("the hollow is as large as what went in: none clear of the snow or in the course's thin snow, more the further it sinks", () => {
  assert.equal(bodyInSnow(onRoof(0, 0, -0.5), snow(1)), null, "resting on the snow's surface");
  assert.equal(bodyInSnow(onRoof(0, 0, 0.05), snow(1)), null, "barely touching it");
  assert.equal(bodyInSnow(onRoof(0, 0, 0.6), snow(SCOUR.thinFt / 2)), null, "the course's thin snow");
  // A truck rolled most of the way onto its side, its lowest edge `sunk` under the snow's surface at 1 ft: the more of
  // it in, the larger the hollow.
  const leaning = (roll, sunk) => {
    const turned = HULL.map(([px, py, pz]) => [px * Math.cos(roll) - py * Math.sin(roll), px * Math.sin(roll) + py * Math.cos(roll), pz]);
    const low = Math.min(...turned.map((p) => p[1]));
    return turned.map(([x, y, z]) => [x, y - low + 1 - sunk, z]);
  };
  const shallow = bodyInSnow(leaning(1.2, 0.3), snow(1)), deeper = bodyInSnow(leaning(1.2, 0.9), snow(1));
  assert.ok(shallow && deeper);
  assert.ok(area(deeper.outline) > area(shallow.outline) * 1.3, `${area(deeper.outline)} against ${area(shallow.outline)}`);
});

test("the hollow round an outline: the least rectangle round it, a margin larger, its length the longer way", () => {
  // A rectangle 16 ft along x and 8 ft along z, about (10, 20).
  const shape = scourShape([[2, 16], [18, 16], [18, 24], [2, 24], [10, 20]], 0.5);
  near(shape.x, 10); near(shape.z, 20);
  near(shape.halfLengthFt, 8 + SCOUR.marginFt); near(shape.halfWidthFt, 4 + SCOUR.marginFt);
  near(Math.abs(Math.sin(shape.angle)), 1, 1e-9);
  assert.equal(shape.depthFt, 0.5);
  // Turned a quarter, its length and width the other way round, it is the same hollow, and goes into the first without spinning.
  const other = { ...shape, angle: shape.angle + Math.PI / 2, halfLengthFt: shape.halfWidthFt, halfWidthFt: shape.halfLengthFt };
  const aligned = alignScour(other, shape);
  near(aligned.angle, shape.angle); near(aligned.halfLengthFt, shape.halfLengthFt);
});

test("a body that slides through the snow scours one long hollow: one each step of the way, scored along it", () => {
  const first = { x: 0, z: 0, angle: 0, halfLengthFt: 3, halfWidthFt: 2, depthFt: 0.5 };
  const [only] = scourSteps(null, first);
  assert.equal(only.drag, null, "going in, it is a dent");
  // Less than a step on: nothing yet.
  assert.deepEqual(scourSteps(first, { ...first, x: SCOUR.stepFt / 2 }), []);
  // Three feet on: one each step, evenly, the way it went.
  const steps = scourSteps(first, { ...first, x: 3, depthFt: 0.7 });
  assert.equal(steps.length, Math.ceil(3 / SCOUR.stepFt));
  near(steps[0].x, 3 / steps.length); near(steps.at(-1).x, 3);
  near(steps.at(-1).depthFt, 0.7);
  assert.deepEqual(steps[0].drag, [1, 0]);
  // Boring down where it is: one more, deeper.
  assert.equal(scourSteps(first, { ...first, depthFt: first.depthFt + SCOUR.deeperFt * 2 }).length, 1);
  // Put back on the course, far away: a new hollow, not a drag.
  const far = scourSteps(first, { ...first, x: SCOUR.jumpFt + 1 });
  assert.equal(far.length, 1);
  assert.equal(far[0].drag, null);
  // However fast, no more than so many in a frame.
  assert.ok(scourSteps(first, { ...first, x: SCOUR.jumpFt - 1 }).length <= SCOUR.mostSteps);
});

test("over a drag only some hollows have lids, one each part of a hollow's length, each reaching to the next", () => {
  assert.equal(SCOUR.lidEvery, 0.8);
  assert.equal(scourLidFt(5), 4);
  assert.equal(scourLidFt(1), SCOUR.lidLeastFt, "never closer than 2 ft");
  const at = (x) => ({ x, z: 0, halfLengthFt: 5, drag: [1, 0] });
  // A hollow going in always has one, and the first of a drag.
  assert.ok(scourLid({ ...at(0), drag: null }, [0, 0]));
  assert.ok(scourLid(at(0), null));
  // Along the drag, one each 4 ft or so: of the hollows laid each 0.75 ft, one in six (at 4.5, 9, ... 36 ft).
  let last = [0, 0], lids = 0;
  for (let x = SCOUR.stepFt; x <= 40; x += SCOUR.stepFt) if (scourLid(at(x), last)) { lids++; last = [x, 0]; }
  assert.equal(lids, 8);
  assert.ok(SCOUR.stepFt * 5 <= scourLidFt(5));
});
