/*
  Where the player's head goes in VR (docs/VR.md, "The rig"). Pure: plain arrays, no three.js, so
  the rules are tested under Node.

  Frames. Everything here is in the scene frame (shared/scene-frame.js): right-handed, y up, a
  body looking down its own -z. A heading is a turn about +y, zero looking down -z, positive to
  the left. Quaternions are [x, y, z, w]; matrices are 4x4, column-major (three.js layout).

  The headset reports poses in its tracking space, in metres. `rigMatrix` places that space in the
  scene so that the head position the player calibrated sits on a seat, facing the seat's way.
*/

export const quatConjugate = (q) => [-q[0], -q[1], -q[2], q[3]];

/** a * b: the rotation b, then a. */
export function quatMultiply(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** The vector `v` turned by `q`. */
export function quatRotate(q, v) {
  const [x, y, z, w] = q;
  // t = 2 q x v, v' = v + w t + q x t
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}

export const quatFromYaw = (yaw) => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];

/** The rotation of a rigid column-major 4x4 as a quaternion. */
export function quatFromMatrix(m) {
  const m00 = m[0], m10 = m[1], m20 = m[2], m01 = m[4], m11 = m[5], m21 = m[6], m02 = m[8], m12 = m[9], m22 = m[10];
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

/** A column-major 4x4 from a position, a rotation and one scale for every axis. */
export function composeMatrix(position, q, scale = 1, out = new Array(16)) {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  out[0] = (1 - 2 * (yy + zz)) * scale; out[1] = 2 * (xy + wz) * scale; out[2] = 2 * (xz - wy) * scale; out[3] = 0;
  out[4] = 2 * (xy - wz) * scale; out[5] = (1 - 2 * (xx + zz)) * scale; out[6] = 2 * (yz + wx) * scale; out[7] = 0;
  out[8] = 2 * (xz + wy) * scale; out[9] = 2 * (yz - wx) * scale; out[10] = (1 - 2 * (xx + yy)) * scale; out[11] = 0;
  out[12] = position[0]; out[13] = position[1]; out[14] = position[2]; out[15] = 1;
  return out;
}

/** A point through a column-major 4x4. */
export function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** An angle brought into (-pi, pi]. */
export function wrapAngle(a) {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t <= 0 ? t + 2 * Math.PI : t) - Math.PI;
}

const smoothstep = (lo, hi, x) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** The heading a body with attitude `q` points its nose at. Undefined with the nose straight up or down. */
export function headingOfNose(q) {
  const f = quatRotate(q, [0, 0, -1]);
  return Math.atan2(-f[0], -f[2]);
}

/**
 * The heading of a head: taken from its right-hand axis, which stays level while the player
 * looks up or down, so calibrating while glancing at the dashboard does not skew the seat.
 */
export function headingOfHead(q) {
  const r = quatRotate(q, [1, 0, 0]);
  return Math.atan2(-r[2], r[0]);
}

/** How far a rotation turns about the vertical: the twist of `q` about +y, in (-pi, pi]. */
export function twistAboutY(q) {
  const sign = q[3] < 0 ? -1 : 1;
  return wrapAngle(2 * Math.atan2(q[1] * sign, q[3] * sign));
}

/**
 * The player's driving position: where the head is and which way it faces when they recentre.
 * Only the heading is kept of the head's attitude, so the horizon stays where gravity puts it.
 */
export function calibrate(headPosition, headQuaternion) {
  return { position: [headPosition[0], headPosition[1], headPosition[2]], yaw: headingOfHead(headQuaternion) };
}

export const NO_CALIBRATION = Object.freeze({ position: Object.freeze([0, 0, 0]), yaw: 0 });

/**
 * The tracking space placed in the scene:
 *
 *     rig = seat * S(scale) * Ry(-yaw0) * T(-head0)
 *
 * `seatPosition` and `seatQuaternion` are the seat in the scene, `calibration` the head pose
 * that belongs on it, and `scale` the scene units in one metre.
 */
export function rigMatrix(seatPosition, seatQuaternion, calibration, scale, out = new Array(16)) {
  const turn = quatMultiply(seatQuaternion, quatFromYaw(-calibration.yaw));
  const h = calibration.position;
  const offset = quatRotate(turn, [-h[0] * scale, -h[1] * scale, -h[2] * scale]);
  return composeMatrix([seatPosition[0] + offset[0], seatPosition[1] + offset[1], seatPosition[2] + offset[2]], turn, scale, out);
}

/** How fast the level heading closes on the nose's heading, 1/s. */
const HEADING_RATE = 12;
/** A truck that moved this far in one frame was put somewhere else (a reset, the helicopter). */
export const TELEPORT_FT = 20;

/**
 * The heading a level camera follows (docs/VR.md, "Horizon lock").
 *
 * The nose's heading is the obvious choice, but it turns half a circle the moment the truck
 * goes end over end through the vertical, and it means nothing while the nose points at the sky.
 * So the heading is integrated from the truck's own turning about the vertical, and pulled to
 * the nose's heading only as far as that can be trusted: fully on the wheels, not at all with the
 * nose straight up or down, and on the roof toward whichever end is already ahead.
 */
export function createHorizonTracker() {
  let yaw = null, last = null;
  return {
    reset() { yaw = null; last = null; },
    get yaw() { return yaw ?? 0; },
    /** @param {number[]} q the truck's attitude @param {number} dt seconds since the last call */
    update(q, dt) {
      const forward = quatRotate(q, [0, 0, -1]);
      const flat = Math.hypot(forward[0], forward[2]);
      const nose = Math.atan2(-forward[0], -forward[2]);
      if (yaw === null) {
        yaw = flat > 1e-3 ? nose : 0;
        last = q.slice();
        return yaw;
      }
      yaw += twistAboutY(quatMultiply(q, quatConjugate(last)));
      last = q.slice();
      let error = wrapAngle(nose - yaw);
      const inverted = quatRotate(q, [0, 1, 0])[1] < 0;
      if (inverted && Math.abs(error) > Math.PI / 2) error = wrapAngle(error + Math.PI);
      yaw = wrapAngle(yaw + error * smoothstep(0.25, 0.6, flat) * (1 - Math.exp(-dt * HEADING_RATE)));
      return yaw;
    },
  };
}

/** How fast a chase view closes on its place behind the truck, and turns to face it, 1/s. */
const CHASE_FOLLOW_RATE = 4, CHASE_TURN_RATE = 8;

/**
 * A level seat that trails the truck: `back` feet behind along its heading and `up` feet above,
 * eased, always facing the truck. Returns the seat's position and heading.
 */
export function createChaseSeat() {
  let position = null, yaw = 0;
  return {
    reset() { position = null; },
    update(truck, heading, { back, up }, dt) {
      const want = [truck[0] + Math.sin(heading) * back, truck[1] + up, truck[2] + Math.cos(heading) * back];
      const jumped = position && Math.hypot(want[0] - position[0], want[1] - position[1], want[2] - position[2]) > back + 10 * TELEPORT_FT;
      if (!position || jumped) {
        position = want;
        yaw = heading;
        return { position, yaw };
      }
      const k = 1 - Math.exp(-dt * CHASE_FOLLOW_RATE);
      position = [position[0] + (want[0] - position[0]) * k, position[1] + (want[1] - position[1]) * k, position[2] + (want[2] - position[2]) * k];
      const dx = truck[0] - position[0], dz = truck[2] - position[2];
      const facing = Math.hypot(dx, dz) > 1 ? Math.atan2(-dx, -dz) : heading;
      yaw = wrapAngle(yaw + wrapAngle(facing - yaw) * (1 - Math.exp(-dt * CHASE_TURN_RATE)));
      return { position, yaw };
    },
  };
}
