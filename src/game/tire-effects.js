/*
  Dust, tire tracks and sparks (MONSTER_EXE_ANALYSIS.md 14). The dust follows the game's own rules
  (0x4de010 spawns a puff into a pool of 96, 0x4deab0 decides per tire, 0x4de390 draws it); the tire
  tracks and the sparks are the port's additions (the game reads `tireTrackFlag` but never uses it, and its
  `0x531e40` only throws sparks from a hull contact that the port draws). Pure, so it runs under Node.
*/
export const MPH_PER_FTS = 0.681818;
/** The game puffs only within 512 ft of the camera (squared distance 262144); the port puffs for every truck. */
export const DUST_RANGE_FT = Infinity;
/** One puff a tire above this speed, a second at its pair with even odds above the faster one, mph. */
export const DUST_SLOW_MPH = 10, DUST_FAST_MPH = 20;
// The game's pool holds 96; the port's longer, larger dust from every truck needs far more.
export const PUFF_POOL = 640, PUFF_FRAMES = 12;
/** How often a tire's dust is decided, seconds (the game decides every frame, its pool of 96 limiting it). */
export const DUST_TICK_S = 1 / 15;

/** A puff lives 1.5 to 3.5 seconds. */
export const puffLife = (random) => 1.5 + 2 * random;
/** A puff's half size at birth, feet: 384 to 640 units of 1/256 ft. */
export const puffSize = (random) => 1.5 + random;
/** How far through its frames a puff is at fraction `p` of its life: quick at first, then slowing so the last frames linger. */
export const puffProgress = (p) => 1 - (1 - Math.min(1, Math.max(0, p))) ** 2;
/** The frame (0 to 11, PUFF2_01 to PUFF2_12) a puff of `life` seconds shows after `age`; -1 when it is over. */
export const puffFrame = (age, life) => {
  if (age >= life || age < 0) return -1;
  return Math.min(PUFF_FRAMES - 1, Math.floor(PUFF_FRAMES * puffProgress(age / life)));
};
/** A hull contact makes smoke only once it has lasted this long, seconds, and then a puff this often. */
export const SMOKE_AFTER_S = 0.25, SMOKE_EVERY_S = 0.15;
/** Contact is over when no report has come for this long. */
export const CONTACT_GAP_S = 0.6;
/** The puff grows by a foot over its life. */
export const puffHalfSize = (size, age, life) => size + Math.min(1, age / life);

/** The surfaces that raise dust: dirt, grass and gravel (the sound families), not concrete, ice or rock. */
export const raisesDust = (family) => family === "dirt" || family === "gravel";
/** The surfaces that keep a tread: the soft ones and snow (type 9). */
export const keepsTread = (family, type) => family === "dirt" || family === "gravel" || type === 9;

/**
 * Which tires puff this tick: each tire on a dusty surface above 10 mph, plus a second puff at its place
 * with even odds above 20 mph. Returns a list of tire indices (a repeated index is the second puff).
 */
export function dustPuffs({ speedFtS, onGround, dusty, random }) {
  if (!dusty) return [];
  const mph = Math.abs(speedFtS) * MPH_PER_FTS;
  if (mph <= DUST_SLOW_MPH) return [];
  const out = [];
  onGround.forEach((on, i) => {
    if (!on) return;
    out.push(i);
    if (mph > DUST_FAST_MPH && random() < 0.5) out.push(i);
  });
  return out;
}

/**
 * Tire tracks: a mark every `TRACK_STEP_FT` of travel, as wide as the tire, held in a ring of `TRACK_POOL` pieces. No
 * clock wipes a track: it stays until the ring comes round to it, and fades over the oldest `TRACK_FADE_SHARE` of the
 * ring, so it is gone before its place is taken. With few trucks a track lasts for minutes; with a full field, as long
 * as the ring holds.
 */
export const TRACK_STEP_FT = 3, TRACK_WIDTH_FT = 2.2, TRACK_POOL = 65536, TRACK_FADE_SHARE = 0.125;
export const TRACK_FADE_PIECES = Math.round(TRACK_POOL * TRACK_FADE_SHARE);
/**
 * Where tracks come among the see-through things a scene draws (three.js's render order): after the level's water
 * (0), whose ice a rut can lie on, so the rut is over it; before the shade under a truck (1) and what is thrown (3).
 */
export const TRACK_ORDER = 0.5;
/** Every truck lays tracks wherever it is (no distance limit). */
export const TRACK_RANGE_FT = Infinity;
/** A jump longer than this between marks (a reset, the helicopter) starts a new strip. */
export const TRACK_BREAK_FT = 10;
/**
 * A piece is laid only where every point of it lies within this of the ground under the tire, feet: a track never
 * hangs off a bridge's deck into the gully under it, or bridges a ledge (`trackLevel`).
 */
export const TRACK_LEDGE_FT = 2;
/** Whether the points of a piece's edge (`[x, height, z, ...]` each) all lie within `TRACK_LEDGE_FT` of `floorFt`, the ground under the tire. */
export const trackLevel = (edge, floorFt) => edge.every((point) => Math.abs(point[1] - floorFt) <= TRACK_LEDGE_FT);

/**
 * How much of a piece of track is shown when `behind` pieces have been laid since it (0 for the newest): all of it,
 * then fading to nothing as the ring comes round to it. The piece whose place is taken next (`pool - 1` behind) shows
 * nothing.
 */
export const trackShown = (behind, pool = TRACK_POOL, fade = TRACK_FADE_PIECES) => Math.min(1, Math.max(0, (pool - 1 - behind) / fade));

/**
 * While a tire runs on straight over even ground, the piece it is laying is drawn on to where the tire is instead of a
 * new one being begun: up to `TRACK_LONGEST_FT` long, while it presses within `TRACK_PRESS_SAME` of how it pressed
 * when the piece began, and while every place the piece has passed lies within `TRACK_TRUE_FT` of where the longer
 * piece would draw it (`edgeHolds`). So a track takes fewer pieces where it runs straight, and the ring holds more of it.
 */
export const TRACK_LONGEST_FT = 15, TRACK_TRUE_FT = 0.03, TRACK_PRESS_SAME = 0.05;

/**
 * Whether a piece drawn straight from edge `from` to edge `to` still passes through edge `passed`, which a tire laid on
 * the way. Each edge is a list of the same points across the track, `[x, height, z, snowDepth]` each (game feet). A
 * passed point must lie within `trueFt` of the line from its fellow on `from` to its fellow on `to`: across, in height
 * and in the snow's depth there.
 */
export function edgeHolds(from, to, passed, trueFt = TRACK_TRUE_FT) {
  for (let k = 0; k < passed.length; k++) {
    const a = from[k], b = to[k], p = passed[k];
    const abx = b[0] - a[0], abz = b[2] - a[2], long2 = abx * abx + abz * abz;
    if (!(long2 > 1e-9)) return false;
    const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * abx + (p[2] - a[2]) * abz) / long2));
    if (Math.hypot(p[0] - a[0] - abx * t, p[2] - a[2] - abz * t) > trueFt) return false;
    if (Math.abs(p[1] - (a[1] + (b[1] - a[1]) * t)) > trueFt) return false;
    if (Math.abs((p[3] ?? 0) - ((a[3] ?? 0) + ((b[3] ?? 0) - (a[3] ?? 0)) * t)) > trueFt) return false;
  }
  return true;
}

/**
 * Sparks, uneven and not many while scraping (the rates are the port's own): while a hull contact scrapes faster than
 * `SPARK_MIN_SPEED`, each `SPARK_INTERVAL_S` of contact has a `SPARK_CHANCE` of throwing one (about four a second);
 * a hit harder than `SPARK_HIT_FORCE` throws a burst of ten at most, each of its sparks with `SPARK_HIT_CHANCE`.
 * A tire against a tire throws them too, at `TIRE_SPARK_SHARE` of those chances. Steel strikes sparks from stone only
 * at a fair speed (0x531e40): a truck that leans on a wall with its throttle open, or creeps on after a crash, presses
 * as hard as one that hits it and throws none. So a scrape needs `SPARK_MIN_SPEED` of slide, feet a second (about
 * 8 mph; the game says only "while the truck is moving"), and a hit `SPARK_HIT_SPEED` as well as its force, with
 * fewer sparks the slower it is.
 */
export const SPARK_INTERVAL_S = 0.125, SPARK_CHANCE = 0.5, SPARK_MIN_SPEED = 12, SPARK_HIT_SPEED = 9, SPARK_POOL = 320, SPARK_HIT_FORCE = 800, SPARK_HIT_CHANCE = 0.7;
export const TIRE_SPARK_SHARE = 0.2;
/**
 * How many sparks a hit of `force` throws. With a function second argument it is thrown unevenly: up to ten sparks
 * (never a shower), each with `SPARK_HIT_CHANCE` times `share`. With a speed (or none) it is counted from the force
 * and the speed, all of them from 30 ft/s on. Either way, none below `SPARK_HIT_FORCE`, and with a speed, none below
 * `SPARK_HIT_SPEED`.
 */
export function sparksForHit(force, speedOrRandom = Infinity, share = 1) {
  if (typeof speedOrRandom === "function") {
    if (force < SPARK_HIT_FORCE) return 0;
    const random = speedOrRandom;
    let thrown = 0;
    for (let n = Math.min(10, 2 + Math.floor(force / 1500)); n > 0; n--) if (random() < SPARK_HIT_CHANCE * share) thrown++;
    return thrown;
  }
  const speedFtS = speedOrRandom;
  if (force < SPARK_HIT_FORCE || speedFtS < SPARK_HIT_SPEED) return 0;
  return Math.round(Math.min(28, 6 + force / 250) * Math.min(1, 0.35 + speedFtS / 45));
}
/** A truck's hits throw a burst no more often than this, seconds: a contact that lasts is one hit, not one a frame. */
export const SPARK_BURST_GAP_S = 0.35;
export const puffsForHit = (force) => (force < 600 ? 0 : Math.min(5, 1 + Math.floor(force / 1500)));

/**
 * Advance a contact's scrape timer by `seconds` of contact; returns `{ timer, sparks }`: how many sparks to
 * throw now. Below the scrape speed the timer starts over. `share` scales the chance (a tire's contact).
 */
export function scrapeSparks(timer, seconds, speedFtS, random = Math.random, share = 1) {
  if (speedFtS < SPARK_MIN_SPEED) return { timer: 0, sparks: 0 };
  let t = timer + seconds, sparks = 0;
  while (t >= SPARK_INTERVAL_S) { t -= SPARK_INTERVAL_S; if (random() < SPARK_CHANCE * share) sparks += 1; }
  return { timer: t, sparks };
}
