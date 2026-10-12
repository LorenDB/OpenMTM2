/*
  The bytes of the puff noise (render/noise-textures.js `puffNoise`): a cube 64 texels a side, red the
  broad lumps and green the finer ones, each 0 to 1 about a half. Built once on the main thread.

  The value at a texel is the same gradient noise as before. What changed is the work around it: the
  gradient at each lattice point is worked out once per octave, and a texel no longer builds an array
  to pass its coordinates. The noise itself is unchanged.
*/

const SIDE = 64;

/** Gradient index (0 to 15) at every lattice point of a cube that repeats every `period` cells. */
function latticeGradients(period, seed) {
  const grads = new Uint8Array(period * period * period);
  for (let iz = 0; iz < period; iz++) {
    for (let iy = 0; iy < period; iy++) {
      const row = (iz * period + iy) * period;
      for (let ix = 0; ix < period; ix++) {
        let h = Math.imul(ix, 0x8da6b343) ^ Math.imul(iy, 0xd8163841) ^ Math.imul(iz, 0xcb1ab31f) ^ Math.imul(seed, 0x27d4eb2d);
        h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
        h = (h ^ (h >>> 13)) >>> 0;
        grads[row + ix] = h & 15;
      }
    }
  }
  return grads;
}

/** Gradient noise in a repeating cube, about -1 to 1, at lattice coordinates. `grads` is `latticeGradients`. */
function cubeAt(grads, period, x, y, z) {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  const tx = x - bx, ty = y - by, tz = z - bz;
  const sx = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
  const sy = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
  const sz = tz * tz * tz * (tz * (tz * 6 - 15) + 10);
  let total = 0;
  for (let corner = 0; corner < 8; corner++) {
    const cx = corner & 1, cy = (corner >> 1) & 1, cz = corner >> 2;
    const g = grads[(((bz + cz) % period) * period + ((by + cy) % period)) * period + ((bx + cx) % period)];
    const u = g < 8 ? tx - cx : ty - cy, v = g < 4 ? ty - cy : g === 12 || g === 14 ? tx - cx : tz - cz;
    const dot = ((g & 1) ? -u : u) + ((g & 2) ? -v : v);
    total += dot * (cx ? sx : 1 - sx) * (cy ? sy : 1 - sy) * (cz ? sz : 1 - sz);
  }
  return total;
}

const byte = (v) => Math.max(0, Math.min(255, Math.round((0.5 + v * 0.55) * 255)));

/** RG bytes, 64 texels a side. Red is broad (periods 4 and 8), green finer (8 and 16). */
export function puffNoiseBytes() {
  const broad = latticeGradients(4, 501), mid = latticeGradients(8, 502);
  const fine = latticeGradients(8, 511), finer = latticeGradients(16, 512);
  const data = new Uint8Array(SIDE * SIDE * SIDE * 2);
  for (let z = 0; z < SIDE; z++) {
    const z4 = (z * 4) / SIDE, z8 = (z * 8) / SIDE, z16 = (z * 16) / SIDE;
    for (let y = 0; y < SIDE; y++) {
      const y4 = (y * 4) / SIDE, y8 = (y * 8) / SIDE, y16 = (y * 16) / SIDE;
      let o = (z * SIDE + y) * SIDE * 2;
      for (let x = 0; x < SIDE; x++) {
        const x4 = (x * 4) / SIDE, x8 = (x * 8) / SIDE, x16 = (x * 16) / SIDE;
        data[o++] = byte(cubeAt(broad, 4, x4, y4, z4) * 0.65 + cubeAt(mid, 8, x8, y8, z8) * 0.35);
        data[o++] = byte(cubeAt(fine, 8, x8, y8, z8) * 0.6 + cubeAt(finer, 16, x16, y16, z16) * 0.4);
      }
    }
  }
  return data;
}
