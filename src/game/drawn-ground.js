/*
  The ground as it is drawn, read back off its mesh (docs/VISUALS.md, "The mesh").

  The drawn ground is a smooth surface (game/terrain-relief.js), and its mesh is that surface
  cut into triangles as finely as a budget allows (worker/relief-mesh.js): within a tolerance of
  it, which on a rough track is some inches and here and there a foot. What follows a truck
  can follow the surface, and be a little over the mesh or under it without harm. What is laid
  flat on the ground cannot: a tire's track a few inches under the mesh is not seen at all, and
  one a few inches over it floats. Such things ask the mesh itself, here: the height of the
  triangle that is drawn at a place, and the depth of settled snow the mesh has there, which
  is what the renderer lifts the ground by (render/ground-surface.js).

  The mesh's fine level is what is asked, since what lies on the ground is only seen near the
  eye, where the fine level is drawn.

  Pure, so it runs under Node.
*/
import { SNOW_DEPTH_SCALE_FT } from "./snow-cover.js";
import { CELL_FT, GRID, WORLD_FT } from "./terrain-relief.js";

const MASK = GRID - 1;
/** How far outside a triangle a point may lie and still count as on it, as a share of the triangle: two that share an edge both claim it. */
const EDGE = 1e-4;

/**
 * @param {{ positions: Float32Array, indices: Uint32Array, snow?: Uint8Array|null }} mesh
 *   One level of the drawn ground's mesh as the asset worker makes it: vertices in the scene's
 *   axes (x, y up, z the game's mirrored), triangles cell after cell, and for a race in Snow
 *   each vertex's settled snow as a byte of `SNOW_DEPTH_SCALE_FT`.
 * @returns the reader, or null for a mesh whose triangles do not come cell after cell
 */
export function createDrawnGround({ positions, indices, snow = null }) {
  const triangles = indices.length / 3;
  // Each cell's triangles are a run of the list: where it starts and how long it is.
  const first = new Int32Array(GRID * GRID).fill(-1), count = new Uint16Array(GRID * GRID);
  for (let t = 0; t < triangles; t++) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
    // A triangle's middle lies inside its cell, whichever of the cell's edges its corners are on.
    const x = (positions[a] + positions[b] + positions[c]) / 3, z = -(positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3;
    const cell = (Math.floor(z / CELL_FT) & MASK) * GRID + (Math.floor(x / CELL_FT) & MASK);
    if (first[cell] < 0) first[cell] = t;
    else if (first[cell] + count[cell] !== t) return null;
    count[cell]++;
  }
  const wrap = (v) => { const w = v % WORLD_FT; return w < 0 ? w + WORLD_FT : w; };
  const found = { height: 0, snow: 0 };

  /** The drawn triangle at game (x, z): its height and settled snow into `found`. False where nothing is drawn. */
  function find(x, z) {
    const wx = wrap(x), wz = wrap(z);
    const cell = (Math.floor(wz / CELL_FT) & MASK) * GRID + (Math.floor(wx / CELL_FT) & MASK);
    for (let t = first[cell], end = t + count[cell]; t >= 0 && t < end; t++) {
      const ia = indices[t * 3], ib = indices[t * 3 + 1], ic = indices[t * 3 + 2];
      const ax = positions[ia * 3], az = -positions[ia * 3 + 2], bx = positions[ib * 3], bz = -positions[ib * 3 + 2], cx = positions[ic * 3], cz = -positions[ic * 3 + 2];
      const area = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(area) < 1e-9) continue;
      const u = ((bz - cz) * (wx - cx) + (cx - bx) * (wz - cz)) / area, v = ((cz - az) * (wx - cx) + (ax - cx) * (wz - cz)) / area, w = 1 - u - v;
      if (u < -EDGE || v < -EDGE || w < -EDGE) continue;
      found.height = u * positions[ia * 3 + 1] + v * positions[ib * 3 + 1] + w * positions[ic * 3 + 1];
      found.snow = snow ? ((u * snow[ia] + v * snow[ib] + w * snow[ic]) / 255) * SNOW_DEPTH_SCALE_FT : 0;
      return true;
    }
    return false;
  }

  return {
    /** The height of the drawn ground at game (x, z), feet, without its snow; null where nothing is drawn (outside a stadium's floor). */
    heightAt: (x, z) => (find(x, z) ? found.height : null),
    /** How deep the mesh has the settled snow at game (x, z), feet: 0 without snow in the mesh, or where nothing is drawn. */
    snowAt: (x, z) => (find(x, z) ? found.snow : 0),
    /** Whether the mesh carries the snow's depth. */
    hasSnow: !!snow,
  };
}
