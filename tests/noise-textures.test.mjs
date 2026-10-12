/*
  The puff noise (render/puff-noise.js). The bytes are the gradient noise the texture used to
  build one texel at a time, with the gradient at each lattice point worked out inside every sample.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { puffNoiseBytes } from "../src/render/puff-noise.js";

/** The noise as it was built before the lattice gradients were kept: one hash per corner of every sample. */
function cubeNoise(x, y, z, period, seed) {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  const tx = x - bx, ty = y - by, tz = z - bz;
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const sx = fade(tx), sy = fade(ty), sz = fade(tz);
  let total = 0;
  for (let corner = 0; corner < 8; corner++) {
    const cx = corner & 1, cy = (corner >> 1) & 1, cz = corner >> 2;
    const ix = (bx + cx) % period, iy = (by + cy) % period, iz = (bz + cz) % period;
    let h = Math.imul(ix, 0x8da6b343) ^ Math.imul(iy, 0xd8163841) ^ Math.imul(iz, 0xcb1ab31f) ^ Math.imul(seed, 0x27d4eb2d);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = (h ^ (h >>> 13)) >>> 0;
    const g = h & 15, u = g < 8 ? tx - cx : ty - cy, v = g < 4 ? ty - cy : g === 12 || g === 14 ? tx - cx : tz - cz;
    const dot = ((g & 1) ? -u : u) + ((g & 2) ? -v : v);
    total += dot * (cx ? sx : 1 - sx) * (cy ? sy : 1 - sy) * (cz ? sz : 1 - sz);
  }
  return total;
}

function referenceBytes() {
  const side = 64, data = new Uint8Array(side * side * side * 2);
  const byte = (v) => Math.max(0, Math.min(255, Math.round((0.5 + v * 0.55) * 255)));
  for (let z = 0; z < side; z++) {
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const at = (n) => [(x * n) / side, (y * n) / side, (z * n) / side];
        const o = ((z * side + y) * side + x) * 2;
        data[o] = byte(cubeNoise(...at(4), 4, 501) * 0.65 + cubeNoise(...at(8), 8, 502) * 0.35);
        data[o + 1] = byte(cubeNoise(...at(8), 8, 511) * 0.6 + cubeNoise(...at(16), 16, 512) * 0.4);
      }
    }
  }
  return data;
}

test("puff noise bytes match the per-sample gradient noise", () => {
  const made = puffNoiseBytes();
  const reference = referenceBytes();
  assert.equal(made.length, reference.length);
  for (let i = 0; i < made.length; i++) {
    if (made[i] !== reference[i]) assert.equal(made[i], reference[i], `byte ${i}`);
  }
});
