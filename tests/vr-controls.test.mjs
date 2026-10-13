import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STICK_DEAD_ZONE, WHEEL_DEAD_ZONE, WHEEL_LOCK_RAD, WHEEL_REST, createXrInputMemory, snapshotGamepad, stickForSteer, wheelSteer,
  xrDriveInput, xrMenuInput,
} from "../src/game/vr/controls.js";
import { createMenu, cycle, itemUsable, itemValue } from "../src/game/vr/menu.js";

/** A controller snapshot in the xr-standard layout: buttons by index, the thumbstick on axes 2 and 3. */
function hand({ trigger = 0, squeeze = false, stickPress = false, low = false, high = false, stick = [0, 0], position } = {}) {
  const b = (on, v = on ? 1 : 0) => ({ pressed: !!on, value: v });
  return {
    buttons: [b(trigger > 0.5, trigger), b(squeeze), b(false), b(stickPress), b(low), b(high)],
    axes: [0, 0, stick[0], stick[1]], position,
  };
}

test("driving: the left stick steers, the right trigger is the throttle, the left the brake", () => {
  const m = createXrInputMemory();
  let { joystick } = xrDriveInput({ left: hand({ stick: [0.5, 0.9] }), right: hand({ trigger: 0.8 }) }, m);
  assert.deepEqual(joystick, { x: 0.5, y: -0.8, deadZone: STICK_DEAD_ZONE, shiftUp: false, shiftDown: false });
  ({ joystick } = xrDriveInput({ left: hand({ trigger: 1, stick: [-1, 0] }), right: hand({ trigger: 0.25 }) }, m));
  assert.equal(joystick.x, -1);
  assert.equal(joystick.y, 0.75);
});

test("driving: with no trigger pulled the right stick is the pedal axis, forward the throttle", () => {
  const m = createXrInputMemory();
  const { joystick } = xrDriveInput({ left: hand({ stick: [0.2, 0.9] }), right: hand({ stick: [0.7, -0.6] }) }, m);
  assert.equal(joystick.x, 0.2);
  assert.equal(joystick.y, -0.6);
});

test("driving: one controller alone steers and works the pedals; none gives no joystick", () => {
  const m = createXrInputMemory();
  assert.deepEqual(xrDriveInput({ right: hand({ stick: [0.3, -1] }) }, m).joystick, { x: 0.3, y: -1, deadZone: STICK_DEAD_ZONE, shiftUp: false, shiftDown: false });
  assert.equal(xrDriveInput({ left: hand({ stick: [-0.4, 0.5] }) }, m).joystick.y, 0.5);
  assert.equal(xrDriveInput({}, m).joystick, null);
  assert.equal(xrDriveInput(null, m).joystick, null);
});

test("driving: a controller with a touchpad and no stick uses the pad", () => {
  const pad = { buttons: [], axes: [0.6, -0.2] };
  assert.equal(xrDriveInput({ left: pad }, createXrInputMemory()).joystick.x, 0.6);
});

test("driving: squeezes shift and the buttons act once per press", () => {
  const m = createXrInputMemory();
  const down = { left: hand({ squeeze: true, low: true, high: true, stickPress: true }), right: hand({ squeeze: true, low: true, high: true, stickPress: true }) };
  let r = xrDriveInput(down, m);
  assert.deepEqual([r.joystick.shiftUp, r.joystick.shiftDown], [true, true]);
  assert.deepEqual(r.actions, { horn: true, helicopter: true, recenter: true, camera: true, pause: true, yeehaw: true });
  r = xrDriveInput(down, m);
  assert.deepEqual([r.joystick.shiftUp, r.joystick.shiftDown], [false, false]);
  assert.ok(Object.values(r.actions).every((v) => v === false), "held buttons do not repeat");
  xrDriveInput({ left: hand(), right: hand() }, m);
  r = xrDriveInput({ left: hand(), right: hand({ low: true }) }, m);
  assert.equal(r.actions.horn, true);
  assert.equal(r.actions.camera, false);
});

test("wheel steering: the tilt of the line between the hands, full lock at 70 degrees", () => {
  assert.equal(wheelSteer([-0.2, 1, -0.4], [0.2, 1, -0.4]), 0);
  // The right hand lower: turning right.
  const tilt = 35 * Math.PI / 180;
  const right = wheelSteer([-0.2 * Math.cos(tilt), 1 + 0.2 * Math.sin(tilt), -0.4], [0.2 * Math.cos(tilt), 1 - 0.2 * Math.sin(tilt), -0.4]);
  assert.ok(Math.abs(right - tilt / WHEEL_LOCK_RAD) < 1e-9);
  assert.equal(wheelSteer([-0.2, 0.8, 0], [0.2, 1.6, 0]) < 0, true, "the right hand higher turns left");
  assert.equal(wheelSteer([0, 1.3, 0], [0, 0.9, 0]), 1, "past full lock stays at full lock");
  assert.equal(wheelSteer([0, 1, 0], [0.05, 1, 0]), null, "hands together are not on a wheel");
  assert.equal(wheelSteer(undefined, [0, 1, 0]), null);

  const m = createXrInputMemory();
  const hands = { left: hand({ stick: [1, 0], position: [-0.2, 1.1, -0.4] }), right: hand({ position: [0.2, 0.9, -0.4] }) };
  const wheel = xrDriveInput(hands, m, { steering: "wheel" }).joystick;
  assert.equal(wheel.deadZone, WHEEL_DEAD_ZONE);
  // What the game's curve makes of it is the hands' own turn, less the play about the middle.
  const turn = wheelSteer(hands.left.position, hands.right.position);
  assert.ok(Math.abs(gameSteer(wheel.x, wheel.deadZone) - (turn - WHEEL_REST) / (1 - WHEEL_REST)) < 1e-9);
  assert.equal(xrDriveInput(hands, m, { steering: "stick" }).joystick.x, 1);
  // Without positions the stick still steers.
  assert.equal(xrDriveInput({ left: hand({ stick: [0.5, 0] }), right: hand() }, m, { steering: "wheel" }).joystick.x, 0.5);
  // Level hands, and hands a degree off level, steer straight ahead.
  const level = (dy) => xrDriveInput({ left: hand({ position: [-0.2, 1, -0.4] }), right: hand({ position: [0.2, 1 + dy, -0.4] }) }, m, { steering: "wheel" }).joystick.x;
  assert.equal(level(0), 0);
  assert.equal(level(0.4 * Math.tan(1 * Math.PI / 180)), 0);
  assert.ok(level(-0.4 * Math.tan(10 * Math.PI / 180)) > 0);
});

/** The game's joystick curve at low speed with the default response (exe analysis 7): the share of full lock a stick position gives. */
function gameSteer(x, nullZone) {
  const past = Math.max(0, Math.abs(x) - nullZone) / (1 - nullZone);
  return Math.sign(x) * Math.min(1, past * 1.11) ** 3;
}

test("hands on a wheel turn the road wheels in proportion: the game's joystick curve is undone", () => {
  for (const n of [0, WHEEL_DEAD_ZONE, 0.12]) {
    for (const steer of [-1, -0.6, -0.25, -0.01, 0, 0.01, 0.1, 0.5, 0.9, 1]) {
      assert.ok(Math.abs(gameSteer(stickForSteer(steer, n), n) - steer) < 1e-9, `steer ${steer} with a dead zone of ${n}`);
    }
  }
  // The stick alone is far from in proportion: half its throw is a sixth of the lock.
  assert.ok(gameSteer(0.5, 0) < 0.18);
  // Never beyond the stick's own throw, whatever is asked.
  assert.equal(stickForSteer(7, 0.04), stickForSteer(1, 0.04));
  assert.ok(stickForSteer(1, 0.04) <= 1 && stickForSteer(-1, 0.04) >= -1);
  assert.equal(stickForSteer(NaN, 0.04), 0);
});

test("menus: a stick push moves once, repeats when held; the trigger selects, A or X confirms, B or Y goes back", () => {
  const m = createXrInputMemory();
  const idle = { left: hand(), right: hand() }, pushDown = { left: hand(), right: hand({ stick: [0.1, 0.9] }) };
  assert.deepEqual(xrMenuInput(idle, m, 0), { up: false, down: false, left: false, right: false, select: false, confirm: false, back: false });
  assert.equal(xrMenuInput(pushDown, m, 1).down, true);
  assert.equal(xrMenuInput(pushDown, m, 1.1).down, false);
  assert.equal(xrMenuInput(pushDown, m, 1.41).down, true, "first repeat after 0.4 s");
  assert.equal(xrMenuInput(pushDown, m, 1.5).down, false);
  assert.equal(xrMenuInput(pushDown, m, 1.57).down, true, "then every 0.15 s");
  assert.equal(xrMenuInput({ left: hand({ stick: [-0.9, 0.2] }), right: hand() }, m, 2).left, true);
  assert.equal(xrMenuInput({ left: hand({ stick: [0, -0.9] }), right: hand() }, m, 2.01).up, true, "a new direction acts at once");
  let r = xrMenuInput({ left: hand(), right: hand({ trigger: 1 }) }, m, 3);
  assert.deepEqual([r.select, r.confirm], [true, false]);
  r = xrMenuInput({ left: hand({ high: true }), right: hand({ trigger: 1 }) }, m, 3.1);
  assert.deepEqual([r.select, r.back], [false, true], "a held trigger does not repeat");
  r = xrMenuInput({ left: hand({ low: true }), right: hand() }, m, 3.2);
  assert.deepEqual([r.select, r.confirm, r.back], [false, true, false]);
});

test("a gamepad snapshot is plain data", () => {
  assert.equal(snapshotGamepad(null), null);
  const snap = snapshotGamepad({ buttons: [{ pressed: true, value: 0.5, touched: true }], axes: new Float32Array([0, 0, 0.25, -1]) });
  assert.deepEqual(snap, { buttons: [{ pressed: true, value: 0.5 }], axes: [0, 0, 0.25, -1] });
});

test("menu: moving skips what cannot be chosen, values step, and selecting runs the item", () => {
  const log = [];
  let laps = 3;
  const menu = createMenu({
    title: "Pause", lines: ["Paused"],
    items: [
      { label: "Just text" },
      { label: "Resume", action: () => log.push("resume") },
      { label: "Greyed", action: () => log.push("never"), disabled: true },
      { label: "Laps", value: () => laps, change: (d) => { laps += d; } },
    ],
    back: () => log.push("back"),
  });
  assert.equal(menu.index, 1, "the first usable item is highlighted");
  assert.equal(menu.change(1), false, "an action has no value to step");
  menu.move(1);
  assert.equal(menu.index, 3);
  assert.equal(menu.change(-1), true);
  assert.equal(itemValue(menu.items[3]), "2");
  menu.select();
  assert.equal(laps, 3, "selecting a value steps it up");
  menu.move(1);
  assert.equal(menu.index, 1, "wraps");
  menu.move(-1);
  assert.equal(menu.index, 3);
  assert.equal(menu.hover(2), false);
  assert.equal(menu.hover(1), true);
  menu.select();
  menu.back();
  assert.deepEqual(log, ["resume", "back"]);
  assert.equal(itemUsable(menu.items[0]), false);
  assert.equal(itemValue({ value: null }), "");
});

test("menu: one with nothing to choose stays inert", () => {
  const menu = createMenu({ title: "Loading", lines: ["Farm Road 29"] });
  assert.equal(menu.index, -1);
  menu.move(1);
  assert.equal(menu.select(), false);
  assert.equal(menu.back(), false);
});

test("cycle steps through a list both ways and wraps", () => {
  assert.equal(cycle(["a", "b", "c"], "a", 1), "b");
  assert.equal(cycle(["a", "b", "c"], "a", -1), "c");
  assert.equal(cycle(["a", "b", "c"], "z", 1), "a");
  assert.equal(cycle([], "z", 1), "z");
});
