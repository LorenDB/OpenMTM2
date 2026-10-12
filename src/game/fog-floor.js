/*
  Where the fog lies, for "Volumetric weather" (docs/VISUALS.md, "Where the fog lies").

  Fog is a layer on the land: thick up to some height and thinning above it. That height has to
  be somewhere in the world, not wherever the eye happens to be, or the fog climbs every hill
  with the truck and seems to fly about. And it has to follow the land as a whole, not the
  ground foot by foot, or no hill would ever stand out of it.

  So the fog has a floor: a map of heights over the world, far smoother than the ground.

   - Without a course it is the land's own lie taken broadly: the ground's height averaged
     over some thirteen hundred feet, leaning toward its low places, where fog gathers.
   - Along the course it is the course's own height averaged along the course, over about a
     quarter of a mile of it. A crest the trucks are over in a few seconds stands above that
     average, and they come out of the fog on it. A stretch that stays high for longer than
     the window carries the average up with it, and the fog with it: a road along a ridge is
     in the fog, though the valleys either side lie far below.
   - Fog lies level, as water does, and it fills what lies below it. The course's height runs
     on out over the land about it as the floor: a valley or a bay beside the course is full of
     fog up to the course's own level, so from a crest it is a sea of cloud, and land that
     stands higher than that stands up out of it, clear. (Land far off once kept a film of fog
     of its own, at its own lie: seen from over the fog a distant hill was a flat grey shape of
     itself against a clear sky.) A track without a course has the land's lie alone.

  The renderer keeps the map as a texture and thickens the fog from its floor upward
  (render/atmosphere.js).

  Pure, so it runs under Node.
*/
import { WORLD_FT } from "./terrain-relief.js";

/**
 * The map is `side` samples across the world (128 ft apart). The land's lie is the ground
 * averaged over `landRadiusFt` either way, `low` of the way from its mean to its lowest. The
 * course's height is averaged over `courseWindowFt` of its own length, a point every
 * `courseStepFt`, and run on out over the land, each point of the course counting by how near
 * it is.
 */
export const FOG_FLOOR = Object.freeze({ side: 64, landRadiusFt: 640, low: 0.35, courseStepFt: 32, courseWindowFt: 1400 });

const wrap = (v) => { const w = v % WORLD_FT; return w < 0 ? w + WORLD_FT : w; };
/** The shorter way round the wrapped world from `a` to `b`, feet. */
const across = (a, b) => { const d = Math.abs(wrap(a) - wrap(b)); return Math.min(d, WORLD_FT - d); };

/** A square map averaged over `radius` samples either way, wrapping at its edges. */
function averaged(map, side, radius) {
  const pass = (from, stride, other) => {
    const out = new Float32Array(side * side);
    for (let line = 0; line < side; line++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += from[line * other + ((k + side) % side) * stride];
      for (let i = 0; i < side; i++) {
        out[line * other + i * stride] = sum / (2 * radius + 1);
        sum += from[line * other + ((i + radius + 1) % side) * stride] - from[line * other + ((i - radius + side) % side) * stride];
      }
    }
    return out;
  };
  return pass(pass(map, 1, side), side, 1);
}

/**
 * The course as points every `FOG_FLOOR.courseStepFt`, each with the course's height there
 * averaged along the course: `[{ x, z, height }]`. `segments` are the course's straights
 * (`{ startFt, endFt }`, game feet), `heightAt(x, z)` the ground.
 */
export function courseProfile(segments, heightAt) {
  const points = [];
  for (const segment of segments ?? []) {
    const [x0, , z0] = segment.startFt, [x1, , z1] = segment.endFt;
    const length = Math.hypot(x1 - x0, z1 - z0), steps = Math.max(1, Math.round(length / FOG_FLOOR.courseStepFt));
    for (let i = 0; i < steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps, z = z0 + ((z1 - z0) * i) / steps;
      points.push({ x, z, ground: heightAt(x, z), height: 0 });
    }
  }
  if (!points.length) return points;
  // A circuit comes back to where it began, and its average runs round the join; a course that does not is averaged up to its ends.
  const first = points[0], last = points[points.length - 1];
  const loops = Math.hypot(across(first.x, last.x), across(first.z, last.z)) < 4 * FOG_FLOOR.courseStepFt + 200;
  const half = Math.max(1, Math.round(FOG_FLOOR.courseWindowFt / FOG_FLOOR.courseStepFt / 2)), n = points.length;
  for (let i = 0; i < n; i++) {
    let sum = 0, count = 0;
    for (let k = -half; k <= half; k++) {
      const j = loops ? (((i + k) % n) + n) % n : i + k;
      if (j < 0 || j >= n) continue;
      sum += points[j].ground; count++;
    }
    points[i].height = sum / count;
  }
  return points;
}

/**
 * The fog's floor over the world.
 * @param {{ heightAt: (x: number, z: number) => number, segments?: { startFt: number[], endFt: number[] }[] }} land
 *   `heightAt` is the ground's height at game (x, z), feet; `segments` the course's straights.
 * @returns {{ side: number, data: Float32Array, at: (x: number, z: number) => number }}
 *   `data` is the floor at `side` x `side` samples, row by row along z, the first at the world's
 *   corner; `at` reads it between them, wrapping with the world.
 */
export function buildFogFloor({ heightAt, segments = [] }) {
  const { side } = FOG_FLOOR, step = WORLD_FT / side;
  const floor = new Float32Array(side * side);
  const course = courseProfile(segments, heightAt);
  if (course.length) {
    // The course's own level, run on out over the land: it fills what is lower, and what is higher stands out of it.
    for (let row = 0; row < side; row++) {
      for (let col = 0; col < side; col++) {
        const x = col * step, z = row * step;
        // Every point of the course counts by how near it is, the nearest by far the most, so the floor has no seams.
        let sum = 0, weights = 0;
        for (const point of course) {
          const d2 = across(x, point.x) ** 2 + across(z, point.z) ** 2;
          const weight = 1 / (d2 + 150 * 150) ** 2;
          sum += point.height * weight; weights += weight;
        }
        floor[row * side + col] = sum / weights;
      }
    }
  } else {
    // The land: each sample's own mean and lowest ground, from a few places about it, taken broadly.
    const mean = new Float32Array(side * side), lowest = new Float32Array(side * side);
    for (let row = 0; row < side; row++) {
      for (let col = 0; col < side; col++) {
        let sum = 0, low = Infinity;
        for (let j = 0; j < 4; j++) {
          for (let i = 0; i < 4; i++) {
            const h = heightAt((col + (i - 1.5) / 4) * step, (row + (j - 1.5) / 4) * step);
            sum += h;
            if (h < low) low = h;
          }
        }
        mean[row * side + col] = sum / 16;
        lowest[row * side + col] = low;
      }
    }
    const radius = Math.max(1, Math.round(FOG_FLOOR.landRadiusFt / step));
    const broadMean = averaged(mean, side, radius), broadLow = averaged(lowest, side, radius);
    for (let i = 0; i < floor.length; i++) floor[i] = broadMean[i] + (broadLow[i] - broadMean[i]) * FOG_FLOOR.low;
  }
  const data = averaged(floor, side, 1);
  return {
    side, data,
    at(x, z) {
      const u = wrap(x) / step, v = wrap(z) / step;
      const col = Math.floor(u) % side, row = Math.floor(v) % side, col1 = (col + 1) % side, row1 = (row + 1) % side;
      const fu = u - Math.floor(u), fv = v - Math.floor(v);
      return (data[row * side + col] * (1 - fu) + data[row * side + col1] * fu) * (1 - fv) + (data[row1 * side + col] * (1 - fu) + data[row1 * side + col1] * fu) * fv;
    },
  };
}
