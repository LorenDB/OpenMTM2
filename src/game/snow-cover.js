/*
  Snow on the ground as a depth (docs/VISUALS.md, "Snow"), for "Snow cover": how deep it lies at
  each place once it has all settled. The game leaves the ground bare in Snow (its ice is on the
  water, MONSTER_EXE_ANALYSIS.md section 13), so all of this is the port's.

  Snow lies deep where the ground is level and thins out as it steepens, to none on a face too
  steep to hold it. It drifts, deeper in some stretches than others. Along the course it is
  kept thin, so the road shows through it and a truck on it stands on the ground it drives on;
  just beyond the course's edge it rises to a low bank and settles to the depth of the open
  ground. Where a ground box stands there is none: the box's top is not the ground. The snow on
  the box's top is kept thin along the course as the road's is (`courseShareAt`).

  The renderer lifts the ground by this depth as the snow settles (render/ground-surface.js), so
  the snow has thickness: tires sink into it off the course and the road runs between its banks.

  Pure, so the asset worker builds the mesh with it and the main thread asks it where the
  snow's surface is.
*/
import { shelterAt } from "./ground-maps.js";
import { CELL_FT, GRID, WORLD_FT, indexCircles, worldNoise } from "./terrain-relief.js";

/** The depth on level, open ground where it drifts deepest, feet. */
export const SNOW_MAX_FT = 0.85;
/** Along the course the snow is this share of what lies beside it. */
export const SNOW_TRACK_SHARE = 0.04;
/** From the course's edge the snow rises over this many feet to a bank this much deeper than the open ground, and settles to it over as many again. */
export const SNOW_BANK_FT = 16, SNOW_BANK_SHARE = 1.1;
/** Ground holds all of its snow up to the first slope (rise over run) and none from the second. */
export const SNOW_HOLD_SLOPE = 0.12, SNOW_BARE_SLOPE = 0.8;
/**
 * Where the snow ends (render/ground-surface.js). The depth is known at the mesh's points and
 * runs in straight lines between them, so a line drawn where it reaches nothing would follow
 * the mesh's cells. Instead snow shows where it lies deeper than a depth that wanders from
 * place to place, between `showsFromFt` and `showsToFt`, over some `wanderFt / 4` feet; the
 * line's edge is frayed by `frayDepthFt` of depth over inches (one repeat of that noise is
 * `frayFt`). Ground within `dampDepthFt` of showing snow is damp from it, `damp` darker.
 * Snow does not end at that line: for `softDepthFt` of depth short of it the snow lies thin,
 * as specks and then as a broken sheet the ground shows through.
 * The depths are the snow's once it has all settled: the line stays where it is while the snow
 * deepens, but for the first `creepsUntil` of a fall, when it creeps out from where the snow
 * will lie deepest.
 */
export const SNOW_LINE = Object.freeze({ showsFromFt: 0.05, showsToFt: 0.36, softDepthFt: 0.2, wanderFt: 210, frayFt: 6, frayDepthFt: 0.14, damp: 0.18, dampDepthFt: 0.3, creepsUntil: 0.1 });
/**
 * Whether snow that will settle `settledFt` deep shows where the wandering reads `wander` (0 to
 * 1), with `down` of it fallen (0 to 1): all of it from `showsToFt`, none under `showsFromFt`.
 */
export function snowShows(settledFt, wander, down = 1) {
  const need = SNOW_LINE.showsFromFt + (SNOW_LINE.showsToFt - SNOW_LINE.showsFromFt) * Math.min(1, Math.max(0, wander));
  return (settledFt * down) / Math.max(down, SNOW_LINE.creepsUntil) > need;
}
/** The mesh keeps a vertex's depth as a byte of this many feet. */
export const SNOW_DEPTH_SCALE_FT = 2;
/** Slopes are taken across this many feet either side: the mesh's own sample spacing (worker/relief-mesh.js). */
const SLOPE_STEP_FT = CELL_FT / 8;
const MASK = GRID - 1;

const smoothstep = (a, b, v) => {
  const t = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
  return t * t * (3 - 2 * t);
};
const wrapFt = (v) => {
  const w = v % WORLD_FT;
  return w < 0 ? w + WORLD_FT : w;
};

/** How much of its snow ground of a slope holds, 1 to 0. */
export const snowHold = (slope) => 1 - smoothstep(SNOW_HOLD_SLOPE, SNOW_BARE_SLOPE, slope);

/** How deep the drifts lie at a place, against the deepest: 0.44 to 1, over a hundred feet or so. */
export const snowDrift = (x, z) => 0.72 + 0.28 * Math.max(-1, Math.min(1, 0.7 * worldNoise(x, z, 60, 81) + 0.3 * worldNoise(x, z, 150, 82)));

/** The snow's share of the open ground's, by how far a place lies beyond the course's clear edge, feet (negative on the course). */
export function snowBesideCourse(beyondFt) {
  if (beyondFt <= 0) return SNOW_TRACK_SHARE;
  if (beyondFt < SNOW_BANK_FT) return SNOW_TRACK_SHARE + (SNOW_BANK_SHARE - SNOW_TRACK_SHARE) * smoothstep(0, SNOW_BANK_FT, beyondFt);
  return SNOW_BANK_SHARE + (1 - SNOW_BANK_SHARE) * smoothstep(SNOW_BANK_FT, 2 * SNOW_BANK_FT, beyondFt);
}

/**
 * @param {{ relief: { heightAt: (x: number, z: number) => number }, calm?: Float32Array, held?: Uint8Array|null, shelter?: Uint8Array|null }} ground
 *   `relief` is the drawn ground (game/terrain-relief.js); `calm` its points along the course and
 *   `held` its corners where something stands on the ground (`buildReliefData`'s `calm` and
 *   `smooth`); `shelter` where the ground lies under cover (game/ground-maps.js
 *   `buildShelterMap`): under a bridge or in a tunnel no snow falls.
 */
export function createSnowCover({ relief, calm = new Float32Array(0), held = null, shelter = null }) {
  const course = indexCircles(calm);

  /**
   * The settled depth at game (x, z), feet. `slope` is the drawn ground's there (rise over run),
   * worked out from the ground when not given.
   */
  function depthAt(x, z, slope = slopeAt(x, z)) {
    const hold = snowHold(slope);
    if (hold <= 0) return 0;
    const wx = wrapFt(x), wz = wrapFt(z);
    const col = Math.floor(wx / CELL_FT) & MASK, row = Math.floor(wz / CELL_FT) & MASK;
    const cell = row * GRID + col;
    let share = 1;
    if (held) {
      const u = wx / CELL_FT - col, v = wz / CELL_FT - row, col1 = (col + 1) & MASK, row1 = ((row + 1) & MASK) * GRID;
      share = (held[cell] * (1 - u) * (1 - v) + held[row * GRID + col1] * u * (1 - v) + held[row1 + col] * (1 - u) * v + held[row1 + col1] * u * v) / 255;
      if (share <= 0) return 0;
    }
    if (course.reaches(cell)) share *= snowBesideCourse(course.beyond(cell, wx, wz));
    if (shelter) share *= 1 - shelterAt(shelter, wx, wz);
    return SNOW_MAX_FT * hold * snowDrift(wx, wz) * share;
  }

  /** The drawn ground's slope at (x, z), as the mesh takes it: across its sample spacing, in single precision. */
  function slopeAt(x, z) {
    const dx = (Math.fround(relief.heightAt(x + SLOPE_STEP_FT, z)) - Math.fround(relief.heightAt(x - SLOPE_STEP_FT, z))) / (2 * SLOPE_STEP_FT);
    const dz = (Math.fround(relief.heightAt(x, z + SLOPE_STEP_FT)) - Math.fround(relief.heightAt(x, z - SLOPE_STEP_FT))) / (2 * SLOPE_STEP_FT);
    return Math.hypot(dx, dz);
  }

  return {
    depthAt,
    /**
     * How much of the open ground's snow the course leaves at game (x, z) (`snowBesideCourse`), whatever the ground
     * does there: what lies on a ground box's top, a bridge's deck, which is out in the weather and as much a part of the
     * course as the road it carries.
     */
    courseShareAt(x, z) {
      const wx = wrapFt(x), wz = wrapFt(z);
      const cell = (Math.floor(wz / CELL_FT) & MASK) * GRID + (Math.floor(wx / CELL_FT) & MASK);
      return course.reaches(cell) ? snowBesideCourse(course.beyond(cell, wx, wz)) : 1;
    },
    /** Whether the course passes near cell (row, col): there the snow's surface has its bank, and the mesh is cut to show it. */
    nearCourse: (row, col) => course.reaches((row & MASK) * GRID + (col & MASK)),
  };
}
