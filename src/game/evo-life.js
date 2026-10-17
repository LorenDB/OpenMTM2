/*
  4x4 Evolution's "AI life" (docs/EVO2_EXE_ANALYSIS.md 6.5; `CAILife`, ..\core\ailife.cpp, 4x42.exe 0x407770 to 0x40a270):
  4 flocks of 8 birds (LIFE.POD's BIRD.SMF) on every level while the game's `ailife` setting is on. Pure: the rules; the
  drawing is render/evo-life.js. Game feet, y up.

  A flock (0x408b80 set up, 0x408d80 stepped, only on a level of 3 checkpoints or more):
    - starts at a random point of the computer drivers' line (else a random checkpoint), 20 ft up;
    - every uniform [60, 120] s picks one of 5 modes (0x409390): 0 and 1 fly along the line, forward or back, its target
      moving a point at a time at a random 20 to 39 ft/s (a point's time is its length to the next over that speed); 2
      and 3 stay; 4 brings the target down to the ground under it (the birds land);
    - its birds' mean velocity is what each aligns to.
  A bird (0x407770 set up, 0x4080f0 stepped):
    - starts within 40 ft of the flock's target each way, with a velocity of up to 20 ft/s on each axis, a separation
      distance of 3 to 23 ft and a random wing frame;
    - flying: its velocity takes the pull to the target (0.3), toward the flock's mean velocity (0.1) and away from
      vehicles within twice their size (at least 5 ft) or, with none near, from its mates within its separation distance
      (0.3), each times dt, held within +-24 ft/s on each axis; then 20 ft/s^2 more toward the target when it is over 64 ft
      off it on x or z, up under 10 ft above the ground (or water), down over 48;
    - under the ground it sits (0x407d30): still, for uniform [0, 12] s, and takes off (2 ft/s up) when that runs out or
      a vehicle comes within twice its size;
    - the wings: frames run back and forth between 0.5 and the last less 0.5, at (k * 10 + 2) * frames a second, where k
      is the climb (the pitch over 90 degrees, while not diving more than 0.25 rad) plus, under 7 ft, 1 less a seventh of
      the height; over 7 ft and not climbing the bird glides, its wings held.
  The port's choices: the vehicles' size is a truck's (`VEHICLE_SIZE_FT`); the flock steps every frame (the game every
  0.15 s while out of sight).
*/

export const FLOCKS = 4, BIRDS = 8;
const TARGET_K = 0.3, ALIGN_K = 0.1, SEPARATE_K = 0.3, MAX_SPEED = 24;
const TARGET_BOX_FT = 64, STEER = 20, LOW_FT = 10, HIGH_FT = 48, GLIDE_FT = 7, FLAP_K = 10, FLAP_BASE = 2;
/** A vehicle's size for the birds (the game's per-vehicle figure is not traced): about a truck's length. */
export const VEHICLE_SIZE_FT = 8;
const WORLD_FT = 8192;

const uniform = (a, b, random) => a + (b - a) * random();

/**
 * The life of a level, or null where it has none (fewer than 3 checkpoints, as the game).
 * `path`: the computer drivers' line, `[x, y, z][]`; `checkpoints`: `[x, y, z][]`; `frames`: the bird model's frame count.
 */
export function createEvoLife({ path = [], checkpoints = [], frames = 1, random = Math.random }) {
  if (checkpoints.length < 3) return null;
  const lengths = path.map((p, i) => { const q = path[(i + 1) % path.length]; return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]); });
  const wrap = (i) => ((i % path.length) + path.length) % path.length;
  const pickMode = (flock) => {
    flock.mode = Math.floor(random() * 5);
    flock.modeTime = uniform(60, 120, random);
  };
  const flocks = Array.from({ length: FLOCKS }, () => {
    const flock = { mode: 0, modeTime: 0, segmentTime: 0, index: 0, target: [0, 0, 0], meanVel: [0, 0, 0], birds: [] };
    pickMode(flock);
    if (path.length) {
      flock.index = Math.floor(random() * path.length);
      flock.target = [...path[flock.index]];
    } else flock.target = [...checkpoints[Math.floor(random() * checkpoints.length)]];
    flock.target[1] += 20;
    for (let b = 0; b < BIRDS; b++) {
      flock.birds.push({
        pos: flock.target.map((v) => v + uniform(-40, 40, random)),
        vel: [uniform(0, 20, random), uniform(0, 20, random), uniform(0, 20, random)],
        separation: uniform(3, 23, random), frame: Math.floor(random() * 8), opening: false,
        sitting: false, sitTime: 0, pitch: 0, height: 0, heading: random() * Math.PI * 2,
      });
    }
    return flock;
  });

  function stepFlock(flock, dt, ground) {
    flock.modeTime -= dt;
    flock.segmentTime -= dt;
    if (flock.modeTime < 0) pickMode(flock);
    if (flock.mode === 0 || flock.mode === 1) {
      if (!path.length) pickMode(flock);
      else if (flock.segmentTime < 0) {
        const speed = 20 + Math.floor(random() * 20);
        flock.segmentTime = lengths[wrap(flock.index)] / speed;
        flock.index = wrap(flock.index + (flock.mode === 0 ? 1 : -1));
        flock.target = [...path[flock.index]];
      }
    } else if (flock.mode === 4) {
      flock.target[0] = ((flock.target[0] % WORLD_FT) + WORLD_FT) % WORLD_FT;
      flock.target[2] = ((flock.target[2] % WORLD_FT) + WORLD_FT) % WORLD_FT;
      flock.target[1] = ground(flock.target[0], flock.target[2]);
    }
    flock.meanVel = [0, 1, 2].map((a) => flock.birds.reduce((s, b) => s + b.vel[a], 0) / flock.birds.length);
  }

  function takeOff(bird) {
    bird.sitting = false;
    bird.sitTime = 0;
    bird.vel = [0, 2, 0];
  }

  function stepBird(bird, flock, dt, ground, vehicles) {
    const reach = Math.max(25, (VEHICLE_SIZE_FT * 2) ** 2);
    const nearVehicle = (v) => (bird.pos[0] - v[0]) ** 2 + (bird.pos[1] - v[1]) ** 2 + (bird.pos[2] - v[2]) ** 2 <= reach;
    if (bird.sitting) {
      if (bird.sitTime <= 0 || vehicles.some(nearVehicle)) takeOff(bird);
      else bird.sitTime -= dt;
      return;
    }
    // Apart from the vehicles near it, or with none near, from its mates.
    const apart = [0, 0, 0];
    let near = false;
    for (const v of vehicles) if (nearVehicle(v)) { near = true; for (let a = 0; a < 3; a++) apart[a] += bird.pos[a] - v[a]; }
    if (!near) {
      for (const mate of flock.birds) {
        if (mate === bird) continue;
        const d2 = (mate.pos[0] - bird.pos[0]) ** 2 + (mate.pos[1] - bird.pos[1]) ** 2 + (mate.pos[2] - bird.pos[2]) ** 2;
        if (d2 <= bird.separation ** 2) for (let a = 0; a < 3; a++) apart[a] += bird.pos[a] - mate.pos[a];
      }
    }
    for (let a = 0; a < 3; a++) {
      bird.vel[a] += ((flock.target[a] - bird.pos[a]) * TARGET_K + (flock.meanVel[a] - bird.vel[a]) * ALIGN_K + apart[a] * SEPARATE_K) * dt;
      bird.vel[a] = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, bird.vel[a]));
      bird.pos[a] += bird.vel[a] * dt;
    }
    const floor = ground(bird.pos[0], bird.pos[2]);
    bird.height = bird.pos[1] - floor;
    const pull = STEER * dt;
    if (bird.pos[0] > flock.target[0] + TARGET_BOX_FT) bird.vel[0] -= pull;
    if (bird.pos[0] < flock.target[0] - TARGET_BOX_FT) bird.vel[0] += pull;
    if (bird.pos[2] > flock.target[2] + TARGET_BOX_FT) bird.vel[2] -= pull;
    if (bird.pos[2] < flock.target[2] - TARGET_BOX_FT) bird.vel[2] += pull;
    if (bird.height > HIGH_FT) bird.vel[1] -= pull;
    if (bird.height < LOW_FT) bird.vel[1] += pull;
    const across = Math.hypot(bird.vel[0], bird.vel[2]);
    if (across > 0.01) bird.heading = Math.atan2(bird.vel[0], bird.vel[2]);
    // Nose up is negative, as the game's pitch.
    bird.pitch = -Math.atan2(bird.vel[1], across);
    if (bird.height < 0) {
      bird.sitting = true;
      bird.sitTime = uniform(0, 12, random);
      bird.vel = [0, 0, 0];
      bird.pos[1] = floor + 0.1;
      bird.pitch = 0;
      return;
    }
    // The wings.
    const climbing = bird.pitch > -1.57 && bird.pitch < 0.25;
    let k = climbing ? Math.abs(bird.pitch / (Math.PI / 2)) : 0;
    if (bird.height < GLIDE_FT) k += 1 - bird.height / GLIDE_FT;
    if (bird.height >= GLIDE_FT && !climbing) return;
    const rate = (k * FLAP_K * frames + frames * FLAP_BASE) * dt;
    if (!bird.opening) {
      if (bird.frame >= 0.5) bird.frame -= rate; else bird.opening = true;
    } else if (bird.frame <= frames - 0.5) bird.frame += rate;
    else bird.opening = false;
  }

  return {
    flocks,
    /**
     * Once a frame: `ground(x, z)` the height a bird stands on (the ground, or the water over it), `vehicles` the trucks'
     * positions.
     */
    step(dt, ground, vehicles = []) {
      if (!(dt > 0)) return;
      for (const flock of flocks) {
        stepFlock(flock, dt, ground);
        for (const bird of flock.birds) stepBird(bird, flock, dt, ground, vehicles);
      }
    },
  };
}
