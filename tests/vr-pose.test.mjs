import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calibrate, composeMatrix, createChaseSeat, createHorizonTracker, headingOfHead, headingOfNose, quatConjugate,
  quatFromMatrix, quatFromYaw, quatMultiply, quatRotate, rigMatrix, transformPoint, twistAboutY, wrapAngle,
} from "../src/game/vr/pose.js";
import { FEET_PER_METRE } from "../src/shared/scene-frame.js";

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const nearVec = (a, b, eps = 1e-9) => a.every((v, i) => near(v, b[i], eps));
const axisAngle = (axis, angle) => {
  const n = Math.hypot(...axis), s = Math.sin(angle / 2) / n;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};
const pitch = (a) => axisAngle([1, 0, 0], a), roll = (a) => axisAngle([0, 0, 1], a);
const deg = Math.PI / 180;

test("a metre is 3.28084 scene feet", () => {
  assert.ok(near(FEET_PER_METRE, 3.280839895, 1e-8));
});

test("headings: zero looks down -z and a positive heading turns left", () => {
  assert.ok(near(headingOfNose(quatFromYaw(0)), 0));
  assert.ok(nearVec(quatRotate(quatFromYaw(Math.PI / 2), [0, 0, -1]), [-1, 0, 0]));
  assert.ok(near(headingOfNose(quatFromYaw(0.7)), 0.7));
  assert.ok(near(wrapAngle(3 * Math.PI), Math.PI));
  assert.ok(near(wrapAngle(-Math.PI), Math.PI));
});

test("quaternions and matrices agree", () => {
  const q = quatMultiply(quatFromYaw(0.4), quatMultiply(pitch(-0.3), roll(1.1)));
  const m = composeMatrix([1, 2, 3], q);
  assert.ok(nearVec(quatFromMatrix(m), q, 1e-12));
  assert.ok(nearVec(transformPoint(m, [0.5, -2, 4]), quatRotate(q, [0.5, -2, 4]).map((v, i) => v + [1, 2, 3][i]), 1e-12));
  assert.ok(nearVec(quatMultiply(q, quatConjugate(q)), [0, 0, 0, 1], 1e-12));
  // Every branch of the matrix to quaternion conversion.
  for (const r of [axisAngle([1, 0, 0], 3), axisAngle([0, 1, 0], 3), axisAngle([0, 0, 1], 3)]) {
    const back = quatFromMatrix(composeMatrix([0, 0, 0], r));
    assert.ok(nearVec(back, r, 1e-12) || nearVec(back, r.map((v) => -v), 1e-12));
  }
});

test("a head's heading ignores looking up or down", () => {
  const head = quatMultiply(quatFromYaw(0.6), pitch(-80 * deg));
  assert.ok(near(headingOfHead(head), 0.6, 1e-12));
  // The nose rule would be close to losing it there.
  assert.ok(near(headingOfHead(quatMultiply(quatFromYaw(-2), pitch(89.9 * deg))), -2, 1e-9));
});

test("calibration puts the calibrated head on the seat, facing the seat's way, at life size", () => {
  const headPosition = [0.3, 1.25, -0.2], headQuaternion = quatMultiply(quatFromYaw(0.9), pitch(-0.2));
  const cal = calibrate(headPosition, headQuaternion);
  const seatPosition = [4000, 110, -3000], seatQuaternion = quatMultiply(quatFromYaw(-1.3), roll(0.25));
  const rig = rigMatrix(seatPosition, seatQuaternion, cal, FEET_PER_METRE);
  assert.ok(nearVec(transformPoint(rig, headPosition), seatPosition, 1e-9));
  // The head's level forward maps onto the seat's forward.
  const levelForward = quatRotate(quatFromYaw(0.9), [0, 0, -1]);
  const ahead = transformPoint(rig, headPosition.map((v, i) => v + levelForward[i]));
  const seatForward = quatRotate(seatQuaternion, [0, 0, -1]);
  assert.ok(nearVec(ahead.map((v, i) => v - seatPosition[i]), seatForward.map((v) => v * FEET_PER_METRE), 1e-9));
  // Leaning 10 cm to the right moves the eyes 0.328 ft along the seat's right.
  const right = quatRotate(quatFromYaw(0.9), [1, 0, 0]);
  const leaned = transformPoint(rig, headPosition.map((v, i) => v + right[i] * 0.1));
  const seatRight = quatRotate(seatQuaternion, [1, 0, 0]);
  assert.ok(nearVec(leaned.map((v, i) => v - seatPosition[i]), seatRight.map((v) => v * 0.1 * FEET_PER_METRE), 1e-9));
});

test("horizon lock: on its wheels the level heading is the nose's", () => {
  const tracker = createHorizonTracker();
  let yaw = 0;
  for (let i = 0; i <= 600; i++) {
    const heading = Math.sin(i / 60) * 2.5;
    // A truck weaving on a side slope, bouncing a little.
    const q = quatMultiply(quatFromYaw(heading), quatMultiply(pitch(0.15 * Math.sin(i / 7)), roll(0.3)));
    yaw = tracker.update(q, 1 / 60);
    assert.ok(Math.abs(wrapAngle(yaw - headingOfNose(q))) < 1.5 * deg, `frame ${i}`);
  }
  assert.equal(tracker.yaw, yaw);
});

test("horizon lock: a back flip does not swing the view round", () => {
  const tracker = createHorizonTracker();
  const heading = 0.4;
  let worst = 0, previous = tracker.update(quatFromYaw(heading), 1 / 60);
  for (let i = 1; i <= 240; i++) {
    const q = quatMultiply(quatFromYaw(heading), pitch((i / 240) * 2 * Math.PI));
    const yaw = tracker.update(q, 1 / 60);
    worst = Math.max(worst, Math.abs(wrapAngle(yaw - previous)));
    previous = yaw;
    assert.ok(Math.abs(wrapAngle(yaw - heading)) < 1 * deg, `frame ${i}: ${yaw}`);
  }
  assert.ok(worst < 0.5 * deg);
});

test("horizon lock: a barrel roll keeps the heading too, and a turn while upside down is followed", () => {
  const tracker = createHorizonTracker();
  tracker.update(quatFromYaw(-1), 1 / 60);
  for (let i = 1; i <= 120; i++) {
    const yaw = tracker.update(quatMultiply(quatFromYaw(-1), roll((i / 120) * Math.PI)), 1 / 60);
    assert.ok(Math.abs(wrapAngle(yaw + 1)) < 1 * deg);
  }
  // On its roof, spinning about the vertical: the view turns with it, with no jump.
  let previous = tracker.yaw;
  for (let i = 1; i <= 120; i++) {
    const yaw = tracker.update(quatMultiply(quatFromYaw(-1 + i * 0.01), roll(Math.PI)), 1 / 60);
    assert.ok(Math.abs(wrapAngle(yaw - previous)) < 1.2 * deg);
    previous = yaw;
  }
  assert.ok(Math.abs(wrapAngle(previous - 0.2)) < 3 * deg);
});

test("horizon lock: landing on the wheels facing backwards brings the view round to the nose", () => {
  const tracker = createHorizonTracker();
  tracker.update(quatFromYaw(0), 1 / 60);
  // Half a back flip, then half a roll: on the wheels again, the nose where the tail was.
  for (let i = 1; i <= 60; i++) tracker.update(pitch((i / 60) * Math.PI), 1 / 60);
  assert.ok(Math.abs(tracker.yaw) < 1 * deg, "upside down, tail first: no swing yet");
  const flipped = pitch(Math.PI);
  for (let i = 1; i <= 60; i++) tracker.update(quatMultiply(flipped, roll((i / 60) * Math.PI)), 1 / 60);
  for (let i = 0; i < 120; i++) tracker.update(quatMultiply(flipped, roll(Math.PI)), 1 / 60);
  assert.ok(Math.abs(wrapAngle(tracker.yaw - Math.PI)) < 1 * deg);
});

test("twist about the vertical is the turn a rotation makes about +y", () => {
  assert.ok(near(twistAboutY(quatFromYaw(0.3)), 0.3));
  assert.ok(near(twistAboutY(quatFromYaw(0.3).map((v) => -v)), 0.3));
  assert.ok(near(twistAboutY(pitch(1)), 0));
  assert.ok(near(twistAboutY(roll(-2)), 0));
});

test("chase seat: settles behind and above the truck, facing it, and snaps after a teleport", () => {
  const seat = createChaseSeat();
  const offsets = { back: 28, up: 8 };
  let s = seat.update([100, 10, -200], 0, offsets, 1 / 72);
  assert.ok(nearVec(s.position, [100, 18, -172]));
  assert.equal(s.yaw, 0);
  // The truck drives off to the left of where it faced; the seat follows and turns to face it.
  let truck = [100, 10, -200];
  for (let i = 0; i < 720; i++) {
    truck = [truck[0] - 0.5, truck[1], truck[2]];
    s = seat.update(truck, Math.PI / 2, offsets, 1 / 72);
  }
  assert.ok(Math.abs(wrapAngle(s.yaw - Math.PI / 2)) < 2 * deg);
  assert.ok(near(s.position[1], 18, 0.05));
  // Trailing behind a moving truck by back plus speed over the follow rate (36 ft/s, 4 per second).
  assert.ok(Math.abs(s.position[0] - truck[0] - (28 + 9)) < 0.5, `gap ${s.position[0] - truck[0]}`);
  s = seat.update([5000, 10, -5000], 0, offsets, 1 / 72);
  assert.ok(nearVec(s.position, [5000, 18, -4972]));
});
