/*
  4x4 Evolution's tire particles (docs/EVO2_EXE_ANALYSIS.md 5), "Evo particles" in Options: debris of the ground's own
  colour thrown back from spinning and sliding tires, its kind and amount by the surface, and on AUTUMN leaves.

  What the game does (4x42.exe):
    - Emission runs at 15 Hz (0x4fd850), for each tire within half a foot of the ground. Two gates per tire, each with its
      own timer re-armed to a random 0 to 0.2 s once it fires: wheelspin (the tire turning faster than 3 rad/s either
      way with some wheelspin, 0x4fc3b0) and sliding (any sideways speed, 0x4fc470).
    - The kind by the tire's surface (0x4fc500): Cement none, Gravel 1, Grass 2 one time in 7 (else 0), Sand 3, Mud 4,
      Snow 5, anything else 0; Mud, Sand and Snow throw half as many again.
    - The strength is min(1, wheelspin * 3 / 100); the particles fly back from the tire within a 20 degree spread, up
      to the emitter's speeds times that strength.
    - Colour: the ground's texel under the spawn point, at full or three-quarter brightness at random; snow is white.
    - Sizes by kind (0x4fbce0): uniform [0.3, 0.9] ft for dirt, gravel and grass, [0.25, 0.8] sand, [0.15, 0.5] mud,
      [0.2, 0.4] snow.
    - The particles are chunk models (ptcle1.smf, ptcle2.smf, in 4x4 Evolution's STARTUP.POD, not in Evo 2's) about 0.4
      and 0.6 ft across, scaled by the size: a particle is 0.06 to 0.55 ft across, not the size in feet.
    - AUTUMN (0x4fe530, 0x4fe830): a truck faster than 15 ft/s, every tick, 4 leaves from every tire on the ground over
      the water, into a pool of 100 that takes no more while full. A leaf is a square of half-size uniform [0.04, 0.4]
      ft, turning at up to 60 degrees a second on each axis; it rises at uniform [3, 8] ft/s to uniform [0.03, 0.2]
      times the truck's speed above its start (10 ft at most), then falls at the same speed, drifting up to half a foot a
      second either way, and is gone at the ground.

  The port's choices, where the game's values are not traced: the emitter's base count (3 a burst) and speeds (20 ft/s
  back, 15 ft/s up), a particle's life (1.5 s, falling at g, gone when it lands), a chunk drawn as a square of its
  footprint, turning. Leaves come from no tire on Cement, as in the game's videos, fewer of them (`LEAF_POOL_SIZE`,
  `LEAVES_PER_TICK`), each a leaf's shape 0.2 to 0.5 ft long in place of the game's square of up to 0.8 ft. Under MTM physics, which has no
  wheelspin value, the strength comes from the tire's sideways speed.

  Pure: the rules and the pool; render/evo-particles.js draws them.
*/

export const EMIT_TICK_S = 1 / 15;
export const POOL_SIZE = 300;
/**
 * The leaves the port keeps, and throws each tick from a tire: the game's 100 and 4 are a cloud of them around a truck,
 * more than its videos show, so the port keeps 40 and throws 1.
 */
export const LEAF_POOL_SIZE = 40, LEAVES_PER_TICK = 1;
export const BASE_COUNT = 3, BACK_SPEED = 20, UP_SPEED = 15, LIFE_S = 1.5, GRAVITY = 32.174;

/** Kinds: 0 dirt, 1 gravel, 2 grass, 3 sand, 4 mud, 5 snow, 7 leaf. */
export const KIND = Object.freeze({ DIRT: 0, GRAVEL: 1, GRASS: 2, SAND: 3, MUD: 4, SNOW: 5, LEAF: 7 });
const SIZES = { 0: [0.3, 0.9], 1: [0.3, 0.9], 2: [0.3, 0.9], 3: [0.25, 0.8], 4: [0.15, 0.5], 5: [0.2, 0.4] };
/** A square of the footprint of ptcle1.smf and ptcle2.smf at scale 1, feet a side. */
export const CHUNK_FT = Object.freeze([0.25, 0.39]);

/** The kind a surface type throws, or null for none (0x4fc500). */
export function particleKind(type, random = Math.random) {
  switch (type) {
    case 1: return null;
    case 7: return KIND.GRAVEL;
    case 6: return Math.floor(random() * 7) === 0 ? KIND.GRASS : KIND.DIRT;
    case 5: return KIND.SAND;
    case 4: return KIND.MUD;
    case 9: return KIND.SNOW;
    default: return KIND.DIRT;
  }
}

/** How many a burst throws: half as many again on mud, sand and snow. */
export const burstCount = (kind) => Math.round(BASE_COUNT * (kind === KIND.MUD || kind === KIND.SAND || kind === KIND.SNOW ? 1.5 : 1));

/** The strength of a tire's burst: min(1, wheelspin * 3 / 100), or from the sideways speed when there is no wheelspin value. */
export function burstStrength(slip, vLat) {
  if (slip > 0) return Math.min(1, (slip * 3) / 100);
  return Math.min(1, Math.abs(vLat) * 3 / 100);
}

/** The game's scale on a chunk model (0x4fbce0). */
export function particleScale(kind, random = Math.random) {
  const [lo, hi] = SIZES[kind] ?? SIZES[0];
  return lo + (hi - lo) * random();
}

/** A particle's side in feet: its scale on one of the two chunks, at random. */
export const particleSize = (kind, random = Math.random) => particleScale(kind, random) * CHUNK_FT[random() < 0.5 ? 0 : 1];

/** The two gates of one tire (0x4fc3b0, 0x4fc470): each fires once its timer passes a random 0 to 0.2 s. */
export function createTireGates(random = Math.random) {
  return { spin: { t: 0, next: random() * 0.2 }, slide: { t: 0, next: random() * 0.2 } };
}

/** Whether each gate fires this tick, for a tire's `spin` (rad/s), `slip` and sideways speed. */
export function stepGates(gates, dt, { spin, slip, vLat }, random = Math.random) {
  const fire = (gate, open) => {
    gate.t += dt;
    if (!open || gate.t <= gate.next) return false;
    gate.t = 0;
    gate.next = random() * 0.2;
    return true;
  };
  return {
    spin: fire(gates.spin, Math.abs(spin) > 3 && slip > 0),
    slide: fire(gates.slide, Math.abs(vLat) > 0),
  };
}

/**
 * A particle's velocity, game feet per second: back from the tire's heading (`back`, a level unit vector) turned by a
 * random angle within 10 degrees either way, up to `BACK_SPEED` along and `UP_SPEED` up, times the strength.
 */
export function burstVelocity(back, strength, random = Math.random) {
  const turn = (random() - 0.5) * (20 * Math.PI / 180);
  const c = Math.cos(turn), s = Math.sin(turn);
  const bx = back[0] * c - back[2] * s, bz = back[0] * s + back[2] * c;
  const along = random() * BACK_SPEED * strength;
  return [bx * along, random() * UP_SPEED * strength, bz * along];
}

const particle = () => ({ life: 0, pos: [0, 0, 0], vel: [0, 0, 0], colour: [1, 1, 1], size: 0.5, kind: 0, angle: 0, spin: 0, top: 0 });

/** A ring of particles, the newest taking the oldest's place. */
export function createPool(size, random = Math.random) {
  const particles = Array.from({ length: size }, particle);
  let next = 0;
  return {
    particles,
    add(pos, vel, colour, side, kind, life) {
      const p = particles[next];
      next = (next + 1) % size;
      p.life = life;
      p.pos[0] = pos[0]; p.pos[1] = pos[1]; p.pos[2] = pos[2];
      p.vel[0] = vel[0]; p.vel[1] = vel[1]; p.vel[2] = vel[2];
      p.colour[0] = colour[0]; p.colour[1] = colour[1]; p.colour[2] = colour[2];
      p.size = side; p.kind = kind;
      p.angle = random() * Math.PI * 2; p.spin = (random() - 0.5) * 4 * Math.PI;
    },
    /** Fall at g; gone on landing or at the end of their life. */
    step(dt, ground) {
      for (const p of particles) {
        if (p.life <= 0) continue;
        p.vel[1] -= GRAVITY * dt;
        p.pos[0] += p.vel[0] * dt; p.pos[1] += p.vel[1] * dt; p.pos[2] += p.vel[2] * dt;
        p.angle += p.spin * dt;
        p.life -= dt;
        if (p.vel[1] < 0 && p.pos[1] < ground(p.pos[0], p.pos[2])) p.life = 0;
      }
    },
  };
}

/** Uniform [a, b]. */
const uniform = (a, b, random) => a + (b - a) * random();

/** AUTUMN's leaves (0x4fe530, 0x4fe830): a pool of `LEAF_POOL_SIZE` that takes no more while full. */
export function createLeafPool(random = Math.random) {
  const particles = Array.from({ length: LEAF_POOL_SIZE }, particle);
  return {
    particles,
    /** A leaf from `pos`, under a truck at `speed` ft/s; false when the pool is full. */
    add(pos, colour, speed) {
      const p = particles.find((q) => q.life <= 0);
      if (!p) return false;
      p.life = Infinity;
      p.pos[0] = pos[0]; p.pos[1] = pos[1]; p.pos[2] = pos[2];
      // Rising, then (past `top`) falling at the same speed.
      p.vel[0] = uniform(-0.5, 0.5, random); p.vel[1] = uniform(3, 8, random); p.vel[2] = uniform(-0.5, 0.5, random);
      p.top = pos[1] + Math.min(10, uniform(0.03 * speed, 0.2 * speed, random));
      p.colour[0] = colour[0]; p.colour[1] = colour[1]; p.colour[2] = colour[2];
      p.size = uniform(0.2, 0.5, random); p.kind = KIND.LEAF;
      p.angle = random() * Math.PI * 2; p.spin = uniform(-60, 60, random) * Math.PI / 180;
      return true;
    },
    step(dt, ground) {
      for (const p of particles) {
        if (p.life <= 0) continue;
        p.pos[1] += p.vel[1] * dt;
        p.pos[0] += p.vel[0] * dt; p.pos[2] += p.vel[2] * dt;
        if (p.vel[1] > 0 && p.pos[1] >= p.top) p.vel[1] = -p.vel[1];
        p.angle += p.spin * dt;
        if (p.pos[1] <= ground(p.pos[0], p.pos[2])) p.life = 0;
      }
    },
  };
}
