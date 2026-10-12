/*
  A pair of VR controllers as the game's analog joystick, and as the keys a menu needs
  (docs/VR.md, "Controllers"). Pure: it reads plain snapshots of the controllers' gamepads, so the
  mapping is tested under Node.

  The gamepads follow WebXR's "xr-standard" layout: buttons 0 trigger, 1 squeeze, 2 touchpad,
  3 thumbstick, 4 and 5 the face buttons (A and B on the right hand, X and Y on the left); axes 0
  and 1 the touchpad, 2 and 3 the thumbstick, y negative when pushed away.

  Driving, the game's joystick mode (MONSTER_EXE_ANALYSIS.md section 7): x steers, y is the pedal
  axis with negative forward.
    steer        the left thumbstick (the right one with only a right controller), or the hands
                 held as on a wheel (the road wheels then turn in proportion to the hands)
    throttle     the right trigger            brake and reverse    the left trigger
    pedals       with no trigger pulled, the right thumbstick's y (the left one's when it is alone)
    shift        right squeeze up, left squeeze down
    right hand   A horn, B helicopter, thumbstick press recentre
    left hand    X next view, Y pause, thumbstick press YeeHaw
*/

const TRIGGER = 0, SQUEEZE = 1, STICK_PRESS = 3, FACE_LOW = 4, FACE_HIGH = 5;
/** The stick's dead zone, as the gamepad's (input/gamepad.js); the simulation applies it. */
export const STICK_DEAD_ZONE = 0.12;
/** Hands as on a wheel: full lock at this tilt of the line between them, and a small dead zone. */
export const WHEEL_LOCK_RAD = 70 * Math.PI / 180;
export const WHEEL_DEAD_ZONE = 0.04;
/** Closer together than this, in metres, the hands are not on a wheel. */
const WHEEL_MIN_SPAN_M = 0.12;
/** Hands held level never are, quite: this share of the lock about the middle counts as straight ahead. */
export const WHEEL_REST = 0.03;
/**
 * The game's joystick curve (MONSTER_EXE_ANALYSIS.md section 7): past the dead zone the stick
 * reaches full lock at 90% of its throw (a gain of 1.11), raised to about the third power.
 */
const JOYSTICK_GAIN = 1.11, JOYSTICK_EXPONENT = 3;
/** A trigger counts as pulled past this. */
const TRIGGER_THRESHOLD = 0.02;

const pressed = (hand, i) => !!hand?.buttons?.[i]?.pressed;
const value = (hand, i) => hand?.buttons?.[i]?.value ?? 0;
/** The thumbstick, or the touchpad on a controller that has no stick. */
function stick(hand) {
  const a = hand?.axes ?? [];
  return a.length >= 4 ? [a[2] ?? 0, a[3] ?? 0] : [a[0] ?? 0, a[1] ?? 0];
}

/**
 * The steer the hands ask for, held as on a wheel in front of the driver: -1 to 1, right
 * positive, from the tilt of the line from the left hand to the right. `left` and `right` are
 * positions in seat space, metres (x right, y up). Null when the hands are too close to tell.
 */
export function wheelSteer(left, right) {
  if (!left || !right) return null;
  const dx = right[0] - left[0], dy = right[1] - left[1];
  if (Math.hypot(dx, dy) < WHEEL_MIN_SPAN_M) return null;
  // Turning right lowers the right hand. Hands crossed over count as full lock.
  const tilt = Math.atan2(dy, dx);
  // Adding zero turns the -0 of level hands into 0.
  return Math.max(-1, Math.min(1, -tilt / WHEEL_LOCK_RAD)) + 0;
}

/**
 * The stick position the simulation turns into `steer`, a share of full lock from -1 to 1. The
 * simulation puts the joystick's x through the game's curve, which suits a thumbstick: small
 * pushes steer finely. Hands on a wheel should turn the road wheels in proportion, so their steer
 * is sent as the stick position that curve makes it from: the curve undone, the dead zone too.
 */
export function stickForSteer(steer, deadZone) {
  const share = Math.min(1, Math.abs(Number(steer) || 0));
  if (share === 0) return 0;
  return Math.sign(steer) * (deadZone + (1 - deadZone) * share ** (1 / JOYSTICK_EXPONENT) / JOYSTICK_GAIN);
}

/** The hands' steer with the play about the middle taken out. */
function rested(steer) {
  return Math.sign(steer) * Math.max(0, Math.abs(steer) - WHEEL_REST) / (1 - WHEEL_REST) + 0;
}

/** The memory `xrDriveInput` and `xrMenuInput` keep between frames. */
export function createXrInputMemory() {
  return { held: {}, repeatAt: 0, direction: null };
}

/** True on the frame `now` turns on. */
function edge(memory, name, now) {
  const before = !!memory.held[name];
  memory.held[name] = now;
  return now && !before;
}

/**
 * The controllers as driving input.
 * @param {{ left?: object|null, right?: object|null }} hands each `{ buttons: [{ pressed, value }], axes: number[], position?: number[] }`
 * @param {ReturnType<typeof createXrInputMemory>} memory
 * @param {{ steering?: "stick" | "wheel" }} [options]
 * @returns {{ joystick: { x: number, y: number, deadZone: number, shiftUp: boolean, shiftDown: boolean } | null,
 *   actions: Record<"horn" | "helicopter" | "camera" | "pause" | "recenter" | "yeehaw", boolean> }}
 */
export function xrDriveInput(hands, memory, { steering = "stick" } = {}) {
  const left = hands?.left ?? null, right = hands?.right ?? null;
  const actions = {
    horn: edge(memory, "horn", pressed(right, FACE_LOW)),
    helicopter: edge(memory, "helicopter", pressed(right, FACE_HIGH)),
    recenter: edge(memory, "recenter", pressed(right, STICK_PRESS)),
    camera: edge(memory, "camera", pressed(left, FACE_LOW)),
    pause: edge(memory, "pause", pressed(left, FACE_HIGH)),
    yeehaw: edge(memory, "yeehaw", pressed(left, STICK_PRESS)),
  };
  const shiftUp = edge(memory, "shiftUp", pressed(right, SQUEEZE));
  const shiftDown = edge(memory, "shiftDown", pressed(left, SQUEEZE));
  if (!left && !right) return { joystick: null, actions };

  const steerHand = left ?? right, pedalHand = right ?? left;
  const wheel = steering === "wheel" ? wheelSteer(left?.position, right?.position) : null;
  const x = wheel === null ? stick(steerHand)[0] : stickForSteer(rested(wheel), WHEEL_DEAD_ZONE);
  const throttle = value(right, TRIGGER), brake = value(left, TRIGGER);
  const y = throttle > TRIGGER_THRESHOLD || brake > TRIGGER_THRESHOLD ? brake - throttle : stick(pedalHand)[1];
  return { joystick: { x, y, deadZone: wheel === null ? STICK_DEAD_ZONE : WHEEL_DEAD_ZONE, shiftUp, shiftDown }, actions };
}

/** A stick counts as pushed past this, and a held push repeats after these seconds. */
const MENU_PUSH = 0.6, MENU_FIRST_REPEAT_S = 0.4, MENU_REPEAT_S = 0.15;

/**
 * The controllers as menu keys: either thumbstick moves (held, it repeats); a trigger is `select`
 * (it chooses what its beam is on, when it is on something); the low face button (A, X) is
 * `confirm` (it chooses the highlighted item); the high one (B, Y) goes back. `time` is in seconds.
 * @returns {{ up: boolean, down: boolean, left: boolean, right: boolean, select: boolean, confirm: boolean, back: boolean }}
 */
export function xrMenuInput(hands, memory, time) {
  const both = [hands?.left, hands?.right].filter(Boolean);
  const out = { up: false, down: false, left: false, right: false };
  let direction = null;
  for (const hand of both) {
    const [sx, sy] = stick(hand);
    if (Math.abs(sy) >= MENU_PUSH && Math.abs(sy) >= Math.abs(sx)) direction = sy < 0 ? "up" : "down";
    else if (Math.abs(sx) >= MENU_PUSH) direction = sx < 0 ? "left" : "right";
    if (direction) break;
  }
  if (direction && (direction !== memory.direction || time >= memory.repeatAt)) {
    out[direction] = true;
    memory.repeatAt = time + (direction !== memory.direction ? MENU_FIRST_REPEAT_S : MENU_REPEAT_S);
  }
  memory.direction = direction;
  const any = (i) => both.some((hand) => pressed(hand, i));
  return {
    ...out,
    select: edge(memory, "menuSelect", any(TRIGGER)),
    confirm: edge(memory, "menuConfirm", any(FACE_LOW)),
    back: edge(memory, "menuBack", any(FACE_HIGH)),
  };
}

/** A plain snapshot of an XRInputSource's gamepad, for the functions above; null without one. */
export function snapshotGamepad(gamepad) {
  if (!gamepad) return null;
  return {
    buttons: Array.from(gamepad.buttons ?? [], (b) => ({ pressed: !!b.pressed, value: Number(b.value) || 0 })),
    axes: Array.from(gamepad.axes ?? [], (v) => Number(v) || 0),
  };
}
