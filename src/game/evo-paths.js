/*
  4x4 Evolution 2's object paths (docs/EVO2_EXE_ANALYSIS.md 6.7; `CObjectPath`, 4x42.exe 0x4f2840 read, 0x4f3680 stepped):
  a .SIT placement moved through its path's points (OpenPhotex `EvoSit.paths`). Pure: it runs in the simulation worker.
  Game feet, y up; orientations are the boxes' (pitch, roll, heading) and matrices row-major, body to world.

  The path's parameter `t` is the segment (its whole part, `0x4f3cf0`: modulo the points, or back and forth with
  `direction` 1) and the place along it (its fraction, by length: a curve is measured over 64 samples, `0x4f4950`).
  Each step, unless stopped (`stopFlag`, which a script's startPathObject and stopPathObject clear and set):
    - the object is put at `t` (`0x4f3e30`): a cardinal spline through the segment's two points and their neighbours,
      of the path's tension (`0x5c7780`, Catmull-Rom at 0), or with `segmentFlag` a straight line; with
      `followTerrainFlag` on the ground, its bottom on it;
    - it is turned (`0x4f3ee0`): with `orientFlag` from the point's orientation to the next's, else along its way (the
      curve's tangent or the line), with `followTerrainFlag` to the ground's slope;
    - `t` moves on (`0x4f39a0`): with a path `time` over its pauses, the path's length over that time; else with a point
      `time`, a segment in that time; else at the point's `vel` (mph, 1.46667 ft/s each), blended to the next point's
      unless `velFlag`. A point with a `pauseTime` holds the object there that long first. Reaching a point, the step's
      rest carries on from it.
  A path going round (`direction` 0) closes from its last point back to its first; type 1 (every stock path) goes round for
  ever, type 0 `cycles` times and stops. A segment of no length does not move on. A path needs 4 points or more.

  `animationFlag`, `lightFlag` and `AIFlag` are never read by 4x42.exe (editor data); the point sounds are not played.
  The object's own frames run as its class has them, on a path or not.
*/

import * as mtm2Sim from "../vendor/openphotex/sim/mtm2/index.js";

const MPH = 1.46667;
const SAMPLES = 64;

/** A (pitch, roll, heading) orientation as the simulation's matrix. */
const eulerMatrix = (theta, phi, psi) => mtm2Sim.eulerToMatrix(theta, phi, psi, new Array(9));

function quatFromMatrix(m) {
  const tr = m[0] + m[4] + m[8];
  let w, x, y, z;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = 0.25 * s; x = (m[7] - m[5]) / s; y = (m[2] - m[6]) / s; z = (m[3] - m[1]) / s; }
  else if (m[0] > m[4] && m[0] > m[8]) { const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2; w = (m[7] - m[5]) / s; x = 0.25 * s; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s; }
  else if (m[4] > m[8]) { const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2; w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = 0.25 * s; z = (m[5] + m[7]) / s; }
  else { const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2; w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = 0.25 * s; }
  return [w, x, y, z];
}

function matrixFromQuat([w, x, y, z]) {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bb = d < 0 ? b.map((v) => -v) : b;
  d = Math.abs(d);
  if (d > 0.9995) {
    const q = a.map((v, i) => v + (bb[i] - v) * t);
    const l = Math.hypot(...q) || 1;
    return q.map((v) => v / l);
  }
  const th = Math.acos(d), s = Math.sin(th);
  const ka = Math.sin((1 - t) * th) / s, kb = Math.sin(t * th) / s;
  return a.map((v, i) => v * ka + bb[i] * kb);
}

/** The cardinal basis at u for tension `tension` (0x5c7780): weights of the four points and of their tangent. */
function basis(u, tension) {
  const s = (1 - tension) * 0.5, u2 = u * u, u3 = u2 * u;
  return {
    w: [-s * u3 + 2 * s * u2 - s * u, (2 - s) * u3 + (s - 3) * u2 + 1, (s - 2) * u3 + (3 - 2 * s) * u2 + s * u, s * u3 - s * u2],
    d: [-3 * s * u2 + 4 * s * u - s, 3 * (2 - s) * u2 + 2 * (s - 3) * u, 3 * (s - 2) * u2 + 2 * (3 - 2 * s) * u + s, 3 * s * u2 - 2 * s * u],
  };
}

/** Pitch (nose up negative) and heading of a direction (0x5e98a0). */
function anglesOf(d) {
  if (d[0] === 0 && d[2] === 0) return [d[1] > 0 ? -Math.PI / 2 : Math.PI / 2, 0, 0];
  return [-Math.atan2(d[1], Math.hypot(d[0], d[2])), 0, Math.atan2(d[0], d[2])];
}

/**
 * One path's runner. `path` is OpenPhotex's EvoPath; `ground` `{ height(x, z), normal(x, z) }`; `bottom` how far the
 * object's bottom is under its origin (for `followTerrainFlag`). Null for a path that cannot run (under 4 points).
 */
export function createEvoPathRunner(path, { ground = null, bottom = 0 } = {}) {
  const points = path.points ?? [];
  const n = points.length;
  if (n < 4) return null;
  const wrap = (i) => (i < 0 ? n - 1 : i > n - 1 ? i % n : i);
  const segPoints = (i) => [points[wrap(i - 1)], points[wrap(i)], points[wrap(i + 1)], points[wrap(i + 2)]];
  const splineAt = (i, u) => {
    const { w } = basis(u, path.tension ?? 0);
    const p = segPoints(i);
    return [0, 1, 2].map((a) => p[0].position[a] * w[0] + p[1].position[a] * w[1] + p[2].position[a] * w[2] + p[3].position[a] * w[3]);
  };
  const tangentAt = (i, u) => {
    const { d } = basis(u, path.tension ?? 0);
    const p = segPoints(i);
    return [0, 1, 2].map((a) => p[0].position[a] * d[0] + p[1].position[a] * d[1] + p[2].position[a] * d[2] + p[3].position[a] * d[3]);
  };
  // Segment lengths and the curves' length tables (0x4f2840, 0x4f4950, 0x4f44e0): every segment of a path going round
  // (`direction` 0), the last back to the first; all but the last (which stays 0) of one going back and forth.
  const lengths = new Array(n).fill(0);
  const tables = points.map(() => null);
  const measured = path.direction === 0 ? n : n - 1;
  for (let i = 0; i < measured; i++) {
    if (points[i].segmentFlag === 0) {
      const table = new Float64Array(SAMPLES + 1);
      let prev = splineAt(i, 0), sum = 0;
      for (let k = 1; k <= SAMPLES; k++) {
        const p = splineAt(i, k / SAMPLES);
        sum += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
        table[k] = sum;
        prev = p;
      }
      tables[i] = table;
      lengths[i] = sum;
    } else {
      const a = points[i].position, b = points[wrap(i + 1)].position;
      lengths[i] = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
  }
  const totalLength = lengths.reduce((s, v) => s + v, 0);
  const totalPause = points.reduce((s, p) => s + (p.pauseTime ?? 0), 0);
  /** The curve's parameter at a distance along segment i (0x4f3d60). */
  const paramAt = (i, distance) => {
    const table = tables[i];
    if (!table) return 0;
    let k = 0;
    while (k < SAMPLES && table[k + 1] <= distance) k++;
    const span = k < SAMPLES ? table[k + 1] - table[k] : 0;
    return span > 0 ? (k + (distance - table[k]) / span) / SAMPLES : k / SAMPLES;
  };
  /** The end of a type 0 path (0x4f3c90). */
  const end = (path.direction === 1 ? (n - 1) * 2 : n) * (path.type === 0 ? path.cycles : 1);
  const segmentOf = (t) => {
    if (path.direction === 0) return Math.floor(t) % n;
    if (path.direction === 1) {
      const span = (n - 1) * 2;
      const i = Math.floor(t) % span;
      return i > n - 1 ? span - i : i;
    }
    return 0;
  };

  // `normal`: the ground's normal as the object feels it, smoothed over about a second (0x4f4e20).
  const state = { t: path.t ?? 0, pause: path.pauseTimeElapsed ?? 0, stopped: !!path.stopFlag, normal: null };

  /** The object's position and orientation at `t` (0x4f3e30, 0x4f3ee0). */
  function pose() {
    const i = segmentOf(state.t), frac = state.t - Math.floor(state.t), point = points[i], next = points[wrap(i + 1)];
    const curve = point.segmentFlag === 0;
    const u = curve ? paramAt(i, frac * lengths[i]) : frac;
    const pos = curve ? splineAt(i, u) : [0, 1, 2].map((a) => point.position[a] + (next.position[a] - point.position[a]) * frac);
    if (point.followTerrainFlag && ground) pos[1] = ground.height(pos[0], pos[2]) + bottom;
    let matrix;
    if (point.orientFlag === 1) {
      const qa = quatFromMatrix(eulerMatrix(...point.orient)), qb = quatFromMatrix(eulerMatrix(...next.orient));
      matrix = matrixFromQuat(slerp(qa, qb, frac));
    } else {
      const dir = curve ? tangentAt(i, u) : [0, 1, 2].map((a) => next.position[a] - point.position[a]);
      if (point.followTerrainFlag && ground) {
        // Along its way over the ground's slope, smoothed (0x4f4e20): up the smoothed normal, forward its way laid on it.
        const up = state.normal ?? ground.normal(pos[0], pos[2]);
        const along = Math.hypot(...dir) || 1;
        const f = dir.map((v) => v / along);
        let r = [up[1] * f[2] - up[2] * f[1], up[2] * f[0] - up[0] * f[2], up[0] * f[1] - up[1] * f[0]];
        const lr = Math.hypot(...r) || 1;
        r = r.map((v) => v / lr);
        const fw = [r[1] * up[2] - r[2] * up[1], r[2] * up[0] - r[0] * up[2], r[0] * up[1] - r[1] * up[0]];
        matrix = [r[0], up[0], fw[0], r[1], up[1], fw[1], r[2], up[2], fw[2]];
      } else matrix = eulerMatrix(...anglesOf(dir));
    }
    return { pos, matrix };
  }

  /** How far `t` moves in `dt` from segment i at fraction `frac` (0x4f39a0). */
  function advance(i, frac, dt) {
    const point = points[i], len = lengths[i];
    if (path.time > totalPause) {
      if (len > 0) state.t += ((totalLength / (path.time - totalPause)) * dt) / len;
    } else if (point.time > 0) {
      state.t += dt / point.time;
    } else {
      const v = (point.velFlag === 0 ? point.vel + (points[wrap(i + 1)].vel - point.vel) * frac : point.vel) * MPH;
      if (len > 0) state.t += (v * dt) / len;
    }
  }

  return {
    get stopped() { return state.stopped; },
    start() { state.stopped = false; },
    stop() { state.stopped = true; },
    toggle() { state.stopped = !state.stopped; },
    pose,
    /** One step of `dt` seconds (0x4f3680); false when the path does not move. */
    step(dt) {
      if (path.type === 0 && end <= state.t) state.stopped = true;
      if (state.stopped) return false;
      // The ground's normal followed at the rate of dt a second (0x4f4e20: now * dt + before * (1 - dt), made unit).
      // The game keeps one such normal for every path that follows the ground; here each path keeps its own.
      if (ground && points[segmentOf(state.t)].followTerrainFlag) {
        const { pos } = pose();
        const now = ground.normal(pos[0], pos[2]);
        const k = Math.min(1, dt);
        const s = state.normal ? state.normal.map((v, a) => now[a] * k + v * (1 - k)) : [...now];
        const l = Math.hypot(...s) || 1;
        state.normal = s.map((v) => v / l);
      }
      const before = state.t, whole = Math.floor(before);
      const i = segmentOf(before), frac = before - whole;
      const pauseTime = points[i].pauseTime ?? 0;
      if (pauseTime > 0 && frac === 0) {
        state.pause += dt;
        const rest = state.pause - pauseTime;
        if (rest > 0) advance(i, frac, rest);
      } else advance(i, frac, dt);
      // Reaching the next point: the object starts from it with the step's rest, or waits there.
      if (whole + 1 <= state.t && state.t !== before) {
        const rest = dt * ((state.t - (whole + 1)) / (state.t - before));
        state.t = whole + 1;
        const j = segmentOf(state.t);
        if ((points[j].pauseTime ?? 0) <= 0) {
          state.pause = 0;
          advance(j, 0, rest);
        } else state.pause = rest;
      }
      return state.t !== before;
    },
  };
}
