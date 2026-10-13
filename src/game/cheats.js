/*
  The typed cheat codes (MONSTER_EXE_ANALYSIS.md 15): the game keeps the last 8 keys typed and
  compares them with each code. Pure, so it runs under Node.

  DANCE and TREX are Monster Truck Madness 1's (MTM1_MONSTER_EXE_ANALYSIS.md 3, 0x42f900): an
  oscilloscope of the sound mixer's output across the screen, and the player's truck drawn as the
  dinosaur REX.BIN.
*/
export const CHEAT_CODES = Object.freeze(["GOLD", "FRAME", "DANCE", "TREX"]);

/**
 * TREX, as MTM1 sets the truck up for it: the tires 24 ft under the truck's origin, at x 4 ft either side and z 5.67 ft
 * ahead and 4 ft behind, and the hull's radius 30 ft. The port draws the dinosaur that high over the wheels' hubs.
 */
export const TREX = Object.freeze({ model: "REX.BIN", tireDropFt: 24, tireXFt: 4, frontZFt: 5.67, rearZFt: -4, radiusFt: 30 });
export const MAX_TYPED = 8;

/** The code the typed letters end with, or null. */
export function cheatTyped(typed) {
  return CHEAT_CODES.find((code) => typed.endsWith(code)) ?? null;
}

/** The typed letters after one more key (`code` is a KeyboardEvent.code), the last 8 kept. */
export function typeKey(typed, code) {
  return /^Key[A-Z]$/.test(code) ? (typed + code.slice(3)).slice(-MAX_TYPED) : typed;
}
