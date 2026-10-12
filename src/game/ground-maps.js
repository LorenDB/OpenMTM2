/*
  Two maps of the ground for the renderer's shaders (docs/VISUALS.md), each a square of samples
  over the whole world, sample (i, j) at the middle of its square so a texture of it reads right.

  The ground map is the drawn ground's height. The water finds its depth in it (where the shore
  is, how dark the deep is) and the rain and snow find where to stop.

  The puddle map is how deep rain stands, and it is worked out the way water would do it. Every
  sample drains to its lowest neighbour, which sorts the ground into basins, each around one low
  point. A basin holds more the more ground drains into it, and fills from its low point until
  the water reaches the lowest saddle to a neighbouring basin. There it either joins that
  basin's pool, if both have reached the saddle, and the two go on filling as one, or it runs
  over into it and stops rising. So the foot of a slope gathers a pond, a dimple on a flat
  gathers a puddle, and ground that slopes holds nothing.

  The game's ground is flat to the last bit where it is flat, which has no low points at all, so
  a relief of a few inches that is never drawn is added first: it stands for the unevenness real
  ground has, and decides where on a flat the puddles lie. Some stretches of ground hold their
  water better than others, so puddles come in patches.

  The map keeps, per sample, how far the ground lies under its pool's surface or above it, so
  that a shader reading between samples finds the waterline where it really falls.

  Pure, so it runs in the asset worker and under Node.
*/
import { WORLD_FT, worldNoise } from "./terrain-relief.js";

export const GROUND_MAP_SIDE = 1024;
/**
 * The puddle map's byte: `PUDDLE_WATERLINE` where the ground meets the water, 255 where it lies
 * `PUDDLE_RANGE_FT` or more under it and 0 where it stands that far or more above.
 */
export const PUDDLE_RANGE_FT = 0.25, PUDDLE_WATERLINE = 128;

/**
 * What a basin holds above its low point, feet: a little anywhere (`hold`, 0 to 1, is how well
 * the ground there keeps it), and more by the ground that drains into it (square feet).
 */
export function basinDepthFt(areaSqFt, hold = 1) {
  return Math.min(0.8, 0.004 + 0.045 * hold * hold + 0.07 * Math.max(0, Math.log2(Math.max(1, areaSqFt) / 60000)));
}

/** Saddles are sorted in steps of this, feet. */
const SADDLE_STEP_FT = 1 / 64;

/**
 * The height of the ground at each sample, feet: `heightAt(x, z)` in game feet, sampled
 * `side` x `side`, row j along z.
 */
export function buildGroundMap(heightAt, side = GROUND_MAP_SIDE) {
  const out = new Float32Array(side * side), step = WORLD_FT / side;
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) out[j * side + i] = heightAt((i + 0.5) * step, (j + 0.5) * step);
  return out;
}

/** The unevenness added to the ground before the basins are found, feet: dimples some fifty feet apart, so a puddle is a few strides across. */
export function unevennessFt(x, z) {
  return 0.2 * worldNoise(x, z, 164, 72) + 0.07 * worldNoise(x, z, 330, 73);
}

/** How well the ground at a point keeps its water, 0 to 1: it varies over a few hundred feet. */
export function holdAt(x, z) {
  return Math.min(1, Math.max(0, (worldNoise(x, z, 23, 71) + 0.2) / 0.55));
}

/**
 * Where rain stands: per sample, the ground's depth under its pool's surface as a byte around
 * `PUDDLE_WATERLINE`.
 *
 * @param {Float32Array} ground `buildGroundMap`'s heights
 * @param {{ side?: number, waterLevelFt?: number|null, wraps?: boolean }} [options] ground under
 *   the level's water holds no puddle and takes whatever runs into it; `wraps` false is a
 *   stadium, whose edge drains away
 */
export function buildPuddleMap(ground, { side = Math.round(Math.sqrt(ground.length)), waterLevelFt = null, wraps = true } = {}) {
  const count = side * side, step = WORLD_FT / side, mask = side - 1;
  if (side & mask) throw new RangeError("the puddle map's side must be a power of two");
  const height = new Float32Array(count);
  // Basin 0 is everything that takes water and keeps none: the level's water, and a stadium's edge.
  const drain = new Uint8Array(count);
  let lowest = Infinity, highest = -Infinity;
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const at = j * side + i;
      const h = ground[at] + unevennessFt((i + 0.5) * step, (j + 0.5) * step);
      height[at] = h;
      if (h < lowest) lowest = h;
      if (h > highest) highest = h;
      if (waterLevelFt !== null && ground[at] < waterLevelFt + 0.05) drain[at] = 1;
      if (!wraps && (i === 0 || j === 0 || i === mask || j === mask)) drain[at] = 1;
    }
  }

  // Each sample's lowest neighbour of eight, or itself at a low point.
  const down = new Int32Array(count);
  for (let j = 0; j < side; j++) {
    const up = ((j - 1) & mask) * side, here = j * side, below = ((j + 1) & mask) * side;
    for (let i = 0; i < side; i++) {
      const at = here + i;
      if (drain[at]) { down[at] = at; continue; }
      const left = (i - 1) & mask, right = (i + 1) & mask;
      let best = at, least = height[at];
      for (const other of [up + left, up + i, up + right, here + left, here + right, below + left, below + i, below + right]) {
        if (height[other] < least) { least = height[other]; best = other; }
      }
      down[at] = best;
    }
  }

  // Basins: one per low point, found by walking downhill.
  const basin = new Int32Array(count).fill(-1);
  let basins = 1;
  for (let at = 0; at < count; at++) if (down[at] === at) basin[at] = drain[at] ? 0 : basins++;
  for (let at = 0; at < count; at++) {
    if (basin[at] >= 0) continue;
    let walk = at;
    while (basin[walk] < 0) walk = down[walk];
    const found = basin[walk];
    for (walk = at; basin[walk] < 0;) { const next = down[walk]; basin[walk] = found; walk = next; }
  }
  const low = new Float64Array(basins).fill(Infinity), area = new Float64Array(basins), lowAt = new Int32Array(basins);
  for (let at = 0; at < count; at++) {
    const b = basin[at];
    area[b] += step * step;
    if (height[at] < low[b]) { low[b] = height[at]; lowAt[b] = at; }
  }
  low[0] = -Infinity;
  // How high each basin's water would stand with nowhere to run: its low point and what its ground gathers.
  const full = new Float64Array(basins);
  for (let b = 1; b < basins; b++) {
    const i = lowAt[b] % side, j = (lowAt[b] - i) / side;
    full[b] = low[b] + basinDepthFt(area[b], holdAt((i + 0.5) * step, (j + 0.5) * step));
  }

  // The saddles between basins, lowest first (a counting sort over their heights).
  const buckets = Math.ceil((highest - lowest) / SADDLE_STEP_FT) + 2;
  const starts = new Int32Array(buckets + 1);
  const eachPair = (visit) => {
    for (let j = 0; j < side; j++) {
      const here = j * side, below = ((j + 1) & mask) * side;
      for (let i = 0; i < side; i++) {
        const at = here + i, right = (i + 1) & mask, left = (i - 1) & mask;
        for (const other of [here + right, below + i, below + right, below + left]) {
          if (basin[other] !== basin[at]) visit(at, other, Math.floor((Math.max(height[at], height[other]) - lowest) / SADDLE_STEP_FT));
        }
      }
    }
  };
  eachPair((_a, _b, bucket) => { starts[bucket + 1]++; });
  for (let b = 0; b < buckets; b++) starts[b + 1] += starts[b];
  const pairA = new Int32Array(starts[buckets]), pairB = new Int32Array(starts[buckets]);
  const next = starts.slice(0, buckets);
  eachPair((a, b, bucket) => { const slot = next[bucket]++; pairA[slot] = a; pairB[slot] = b; });

  // Pools: basins joined where both reach a saddle, closed where one runs over.
  const parent = new Int32Array(basins);
  for (let b = 0; b < basins; b++) parent[b] = b;
  const find = (b) => {
    let root = b;
    while (parent[root] !== root) root = parent[root];
    while (parent[b] !== root) { const up = parent[b]; parent[b] = root; b = up; }
    return root;
  };
  const level = new Float64Array(basins).fill(NaN);
  level[0] = -Infinity;
  for (let n = 0; n < pairA.length; n++) {
    const a = find(basin[pairA[n]]), b = find(basin[pairB[n]]);
    if (a === b) continue;
    const saddle = Math.max(height[pairA[n]], height[pairB[n]]);
    const openA = Number.isNaN(level[a]), openB = Number.isNaN(level[b]);
    if (openA && openB && saddle < full[a] && saddle < full[b]) {
      // Both pools reach the saddle: one pool from here on, filling as far as the better fed of the two would.
      // (Not further: were joined pools to pool their ground too, level ground would join up into one sheet.)
      parent[b] = a;
      if (full[b] > full[a]) full[a] = full[b];
    } else {
      // A pool that reaches the saddle runs over it and rises no further; one that does not is as full as it gets.
      if (openA) level[a] = Math.min(saddle, full[a]);
      if (openB) level[b] = Math.min(saddle, full[b]);
    }
  }

  const out = new Uint8Array(count);
  for (let at = 0; at < count; at++) {
    if (drain[at]) continue;
    const root = find(basin[at]);
    const depth = (Number.isNaN(level[root]) ? full[root] : level[root]) - height[at];
    out[at] = Math.max(0, Math.min(255, Math.round(PUDDLE_WATERLINE + (depth / PUDDLE_RANGE_FT) * 127)));
  }
  return out;
}

/*
  Cover (docs/VISUALS.md, "Under cover"). Some tracks build bridges and tunnels of models, and
  rain and snow fall out of the sky: under a bridge there is neither. The cover map is the
  height of the highest thing that stands over each sample of the ground map, and the shelter
  map says, from it and the ground, where the ground lies under cover.
*/
/** The cover map's height where nothing stands, feet: lower than any ground. */
export const NO_COVER_FT = -1000;
/** What stands this far or more over the ground shelters it, feet: lower than that it stands on the ground, and is not a roof. */
export const COVER_CLEAR_FT = 5;
/** A thing narrower than this across its own footprint, feet, shelters nothing: a gantry's bar, a pole, a sign. */
export const COVER_MIN_WIDTH_FT = 14;

/**
 * The height of the highest thing over each sample, feet (`NO_COVER_FT` where there is none):
 * `side` x `side` samples, row j along z, as `buildGroundMap`. `shapes` are sets of triangles in
 * the scene's axes (x, y up, z the game's mirrored): `positions` three numbers a point,
 * `indices` three a triangle (or none: every three points are one), `matrix` a 4 x 4 in column
 * order that places them (or none). A sample is under a triangle that any part of its square
 * lies under, and takes the triangle's highest point: cover is never missed between samples.
 */
export function buildCoverMap(shapes, side = GROUND_MAP_SIDE) {
  const out = new Float32Array(side * side).fill(NO_COVER_FT), step = WORLD_FT / side;
  const p = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
  for (const { positions, indices = null, matrix = null } of shapes) {
    const count = indices ? indices.length : positions.length / 3;
    for (let t = 0; t + 2 < count; t += 3) {
      for (let k = 0; k < 3; k++) {
        const v = (indices ? indices[t + k] : t + k) * 3;
        const x = positions[v], y = positions[v + 1], z = positions[v + 2];
        // To the map's own measure: samples across (game x) and down (game z, the scene's mirrored).
        if (matrix) {
          p[k][0] = (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / step;
          p[k][1] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
          p[k][2] = -(matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / step;
        } else { p[k][0] = x / step; p[k][1] = y; p[k][2] = -z / step; }
      }
      const top = Math.max(p[0][1], p[1][1], p[2][1]);
      const i0 = Math.floor(Math.min(p[0][0], p[1][0], p[2][0])), i1 = Math.floor(Math.max(p[0][0], p[1][0], p[2][0]));
      const j0 = Math.floor(Math.min(p[0][2], p[1][2], p[2][2])), j1 = Math.floor(Math.max(p[0][2], p[1][2], p[2][2]));
      // A triangle on edge as seen from above covers nothing; one far larger than the world is not a thing in it.
      const area = (p[1][0] - p[0][0]) * (p[2][2] - p[0][2]) - (p[2][0] - p[0][0]) * (p[1][2] - p[0][2]);
      if (Math.abs(area) < 1e-6 || i1 - i0 > side || j1 - j0 > side) continue;
      const sign = area > 0 ? 1 : -1;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          // The sample's middle, taken as inside when it is within half a square of each edge.
          const cx = i + 0.5, cz = j + 0.5;
          let inside = true;
          for (let k = 0; k < 3 && inside; k++) {
            const a = p[k], b = p[(k + 1) % 3];
            const ex = b[0] - a[0], ez = b[2] - a[2];
            inside = sign * (ex * (cz - a[2]) - ez * (cx - a[0])) >= -0.5 * (Math.abs(ex) + Math.abs(ez));
          }
          if (!inside) continue;
          const at = (((j % side) + side) % side) * side + (((i % side) + side) % side);
          if (top > out[at]) out[at] = top;
        }
      }
    }
  }
  return out;
}

/**
 * Where the ground lies under cover: a byte a sample, 255 under cover and 0 in the open, with
 * the edge between them spread over a sample or so either way (rain and snow blow in a little
 * under an edge). `cover` is `buildCoverMap`'s; `heightAt(x, z)` the ground. Null where nothing
 * on the track gives shelter.
 */
export function buildShelterMap(cover, heightAt, side = GROUND_MAP_SIDE) {
  const hard = new Uint8Array(side * side), step = WORLD_FT / side;
  let any = false;
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const top = cover[j * side + i];
      if (top <= NO_COVER_FT || top - heightAt((i + 0.5) * step, (j + 0.5) * step) < COVER_CLEAR_FT) continue;
      hard[j * side + i] = 1;
      any = true;
    }
  }
  if (!any) return null;
  const out = new Uint8Array(side * side);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      let sum = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) sum += hard[((j + dj + side) % side) * side + ((i + di + side) % side)] * (di === 0 ? 2 : 1) * (dj === 0 ? 2 : 1);
      out[j * side + i] = Math.round((sum / 16) * 255);
    }
  }
  return out;
}

/** How much of the sky a place is under cover from, 0 to 1, read between the shelter map's samples (which lie at the middle of their squares). */
export function shelterAt(shelter, x, z, side = GROUND_MAP_SIDE) {
  if (!shelter) return 0;
  const step = WORLD_FT / side, wrap = (v) => ((v % side) + side) % side;
  const u = x / step - 0.5, v = z / step - 0.5, i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
  const at = (a, b) => shelter[wrap(b) * side + wrap(a)];
  return ((at(i, j) * (1 - fu) + at(i + 1, j) * fu) * (1 - fv) + (at(i, j + 1) * (1 - fu) + at(i + 1, j + 1) * fu) * fv) / 255;
}

/**
 * How deep a full puddle is at game (x, z), feet (`puddles` the puddle map, `{ depth, side }`),
 * read between the map's samples as the ground's shader reads them; less than nothing where the
 * ground stands over its pool. The map holds no more than `PUDDLE_RANGE_FT` either way.
 */
export function puddleDepthAt(puddles, x, z) {
  if (!puddles) return -PUDDLE_RANGE_FT;
  const { depth, side } = puddles, step = WORLD_FT / side, wrap = (v) => ((v % side) + side) % side;
  const u = x / step - 0.5, v = z / step - 0.5, i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
  const at = (a, b) => depth[wrap(b) * side + wrap(a)];
  const byte = (at(i, j) * (1 - fu) + at(i + 1, j) * fu) * (1 - fv) + (at(i, j + 1) * (1 - fu) + at(i + 1, j + 1) * fu) * fv;
  return ((byte - PUDDLE_WATERLINE) / 127) * PUDDLE_RANGE_FT;
}
