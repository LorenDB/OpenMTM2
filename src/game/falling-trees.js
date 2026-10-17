/*
  4x4 Evolution's trees falling (docs/EVO2_EXE_ANALYSIS.md 2.5), drawn: a knocked tree turns about its base, away from
  the truck that hit it, until it lies almost flat. The game's fall motion is not traced; this is the port's: the angle
  grows as a body falling under g about its base would start to, reaching 85 degrees in about a second and a half.

  Pure (no three.js): column-major 4x4 scene matrices in and out, as render/track-scene.js `moveObjects` takes them.
*/
export const FALL_END = (85 * Math.PI) / 180;
const FALL_RATE = 0.8; // rad/s² of the angle's growth

/** A fall of the object drawn with `matrix` (scene, column-major) from `base` and `dir` in game feet (x, z). */
export function createFall(id, matrix, base, dir) {
  const len = Math.hypot(dir[0], dir[1]);
  // The scene mirrors z: a game direction (x, z) is (x, -z) there. Without a speed, the tree falls along +x.
  const dx = len > 1 ? dir[0] / len : 1, dz = len > 1 ? -dir[1] / len : 0;
  // The axis up x dir, so that turning about it carries the top along dir.
  return { id, matrix: matrix.slice(), base: [base[0], base[1], -base[2]], axis: [dz, 0, -dx], t: 0, angle: 0, done: false };
}

/** Advance a fall by `dt`; its current matrix (column-major, scene), or null when it no longer changes. */
export function stepFall(fall, dt) {
  if (fall.done) return null;
  fall.t += dt;
  fall.angle = Math.min(FALL_END, FALL_RATE * fall.t * fall.t + 0.3 * fall.t);
  if (fall.angle >= FALL_END) fall.done = true;
  const [ax, ay, az] = fall.axis, c = Math.cos(fall.angle), s = Math.sin(fall.angle), k = 1 - c;
  // Rotation about the axis (Rodrigues), row-major R[r][c].
  const R = [
    [c + ax * ax * k, ax * ay * k - az * s, ax * az * k + ay * s],
    [ay * ax * k + az * s, c + ay * ay * k, ay * az * k - ax * s],
    [az * ax * k - ay * s, az * ay * k + ax * s, c + az * az * k],
  ];
  const m = fall.matrix, out = new Array(16).fill(0);
  // out = T(base) R T(-base) M: the linear part R M, the translation R (t - base) + base.
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 3; row++) {
      out[col * 4 + row] = R[row][0] * m[col * 4] + R[row][1] * m[col * 4 + 1] + R[row][2] * m[col * 4 + 2];
    }
  }
  const [bx, by, bz] = fall.base, tx = m[12] - bx, ty = m[13] - by, tz = m[14] - bz;
  out[12] = R[0][0] * tx + R[0][1] * ty + R[0][2] * tz + bx;
  out[13] = R[1][0] * tx + R[1][1] * ty + R[1][2] * tz + by;
  out[14] = R[2][0] * tx + R[2][1] * ty + R[2][2] * tz + bz;
  out[15] = 1;
  return out;
}
