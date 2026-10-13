/*
  The fly-by camera's keys (game/fly-camera.js), by control scheme. Pure: `flyInput` turns the set
  of keys held (KeyboardEvent.code) into the camera's input.

  "traxx" is JSTrackViewer's layout. "tv" is the flight engine's own default layout, which
  Monster Truck Madness still carries in its INI code (MTM1_MONSTER_EXE_ANALYSIS.md 3: leftKey,
  rightKey, upKey, downKey, throttleUpKey, throttleDownKey, rollLeftKey, rollRightKey, with the
  scan codes of the arrows, A, Z, Home and Page Up). As in a flight game, Up puts the nose down.
  "hb" is Hellbender's layout as the user gave it (docs/PLAN.md 1.3): the arrows, X and Z for the
  speed, F for the turbo thrust, and no roll keys.
*/
const FLIGHT = Object.freeze({
  pitch: [["ArrowDown", 1], ["ArrowUp", -1]],
  yaw: [["ArrowRight", 1], ["ArrowLeft", -1]],
  roll: [["PageUp", 1], ["Home", -1]],
  throttle: [["KeyA", 1], ["KeyZ", -1]],
});

export const FLY_KEYS = Object.freeze({
  traxx: Object.freeze({
    move: [["ArrowUp", 1], ["ArrowDown", -1]],
    yaw: [["ArrowRight", 1], ["ArrowLeft", -1]],
    climb: [["KeyA", 1], ["KeyZ", -1]],
    pitch: [["PageUp", 1], ["PageDown", -1]],
  }),
  tv: FLIGHT,
  hb: Object.freeze({
    pitch: FLIGHT.pitch,
    yaw: FLIGHT.yaw,
    throttle: [["KeyX", 1], ["KeyZ", -1]],
    turbo: [["KeyF", 1]],
  }),
});

/** One line saying how a scheme is flown, for the caption and the console. */
export const FLY_HELP = Object.freeze({
  traxx: "Arrows move and turn, A and Z climb and sink, Page Up and Page Down tilt, drag the mouse to look, wheel to zoom",
  tv: "Arrows steer (Up is nose down), A and Z throttle, Home and Page Up roll",
  hb: "Arrows steer (Up is nose down), X and Z speed up and slow down, F is the turbo thrust",
});

/** Whether the mouse looks around and the wheel zooms in this scheme. */
export const flyUsesMouse = (scheme) => scheme === "traxx";

/** The camera's input from the keys held. */
export function flyInput(scheme, held) {
  const out = {};
  for (const [axis, keys] of Object.entries(FLY_KEYS[scheme] ?? FLY_KEYS.traxx)) {
    let v = 0;
    for (const [code, sign] of keys) if (held.has(code)) v += sign;
    out[axis] = v;
  }
  return out;
}

/** Every key a scheme uses, so the page does not scroll with them. */
export function flyKeyCodes(scheme) {
  return new Set(Object.values(FLY_KEYS[scheme] ?? FLY_KEYS.traxx).flat().map(([code]) => code));
}

const KEY_NAMES = Object.freeze({ ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", PageUp: "Page Up", PageDown: "Page Down" });
const keyName = (code) => KEY_NAMES[code] ?? code.replace(/^Key/, "");
/** What each axis's two keys do, the positive one first, by scheme. */
const AXIS_WORDS = Object.freeze({
  traxx: Object.freeze({ move: ["forward", "back"], yaw: ["turn right", "turn left"], climb: ["climb", "sink"], pitch: ["tilt up", "tilt down"] }),
  craft: Object.freeze({ pitch: ["nose up", "nose down"], yaw: ["turn right", "turn left"], roll: ["roll right", "roll left"], throttle: ["faster", "slower"], turbo: ["turbo thrust"] }),
});

/**
 * The keys of a scheme as lines for the screen (the fly-by's O key), "Up: forward", and after them the keys every
 * scheme has. `following` adds what the keys do while the camera follows the course.
 */
export function flyKeyLines(scheme, { following = false, course = true } = {}) {
  const table = FLY_KEYS[scheme] ?? FLY_KEYS.traxx, words = AXIS_WORDS[scheme === "traxx" ? "traxx" : "craft"];
  const lines = [];
  for (const [axis, keys] of Object.entries(table)) {
    keys.forEach(([code, sign]) => { const word = words[axis]?.[sign > 0 ? 0 : 1]; if (word) lines.push(`${keyName(code)}: ${word}`); });
  }
  if (flyUsesMouse(scheme)) lines.push("Mouse drag: look", "Mouse wheel: zoom");
  if (following) lines.push("Up, Down: follow faster, slower");
  lines.push("C: change the controls");
  if (course) lines.push(`T: ${following ? "stop following" : "follow"} the course`);
  lines.push("O: show or hide this list", "Esc: pause");
  return lines;
}
