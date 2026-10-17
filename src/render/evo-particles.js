/*
  "Evo particles" drawn (the rules are game/evo-particles.js; docs/EVO2_EXE_ANALYSIS.md 5): each particle a small square
  facing the camera, in its ground colour, turning as it flies. The game draws its debris as two small chunk models
  (ptcle1.smf, ptcle2.smf) that only 4x4 Evolution's STARTUP.POD ships, so the port draws squares of their footprint.
  The world wraps: particles are drawn at the copy nearest the eye.
*/
import * as THREE from "three";
import { groundTexel } from "../game/mtm1-particles.js";
import {
  EMIT_TICK_S, KIND, LEAF_POOL_SIZE, LEAVES_PER_TICK, LIFE_S, POOL_SIZE, burstCount, burstStrength, burstVelocity, createLeafPool, createPool,
  createTireGates, particleKind, particleSize, stepGates,
} from "../game/evo-particles.js";

const WORLD_FT = 8192;
const nearest = (v, to) => v + Math.round((to - v) / WORLD_FT) * WORLD_FT;
const LEAF_COLOURS = [[176, 92, 32], [196, 140, 40], [140, 60, 28], [120, 110, 40]];
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
/** Nothing is drawn nearer the eye than this, feet: a leaf at the lens would fill the view. */
const NEAREST_FT = 2.5;

/**
 * The particles' shapes, white with the shape in alpha: the left half solid (a chunk), the right half a leaf, pointed at
 * both ends and fuller toward its stem.
 */
function shapeTexture() {
  const side = 32, data = new Uint8Array(side * 2 * side * 4).fill(255);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const u = (x + 0.5) / side * 2 - 1, v = (y + 0.5) / side * 2 - 1;
      const half = 0.42 * Math.sqrt(Math.max(0, 1 - u * u)) * (1 - 0.25 * u);
      const stem = u < -0.8 && Math.abs(v) < 0.05;
      data[(y * side * 2 + side + x) * 4 + 3] = Math.abs(v) <= half || stem ? 255 : 0;
    }
  }
  const texture = new THREE.DataTexture(data, side * 2, side, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
const SOLID_UV = [0.1, 0.1, 0.4, 0.1, 0.4, 0.9, 0.1, 0.9], LEAF_UV = [0.5, 0, 1, 0, 1, 1, 0.5, 1];

/**
 * `ground(x, z)` is the ground's height in game feet; `atlas` and `clr` the level's ground art and CLR words for the
 * colour; `leaves` throws AUTUMN's leaves, from tires over `waterLevelFt` (null for no water).
 */
export function createEvoParticles({ scene, ground, atlas, clr, leaves = false, waterLevelFt = null, random = Math.random }) {
  const pool = createPool(POOL_SIZE, random), leafPool = createLeafPool(random);
  const capacity = POOL_SIZE + LEAF_POOL_SIZE;
  const positions = new Float32Array(capacity * 4 * 3), colours = new Float32Array(capacity * 4 * 3);
  const indices = new Uint32Array(capacity * 6);
  for (let q = 0; q < capacity; q++) indices.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3).setUsage(THREE.DynamicDrawUsage));
  const uvs = new Float32Array(capacity * 8);
  for (let q = 0; q < capacity; q++) uvs.set(q < POOL_SIZE ? SOLID_UV : LEAF_UV, q * 8);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, map: shapeTexture(), alphaTest: 0.5, side: THREE.DoubleSide, fog: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "evo-particles";
  mesh.frustumCulled = false;
  scene.add(mesh);
  const states = new Map();
  const colour = new THREE.Color();
  const right = new THREE.Vector3(), up = new THREE.Vector3();
  let clock = 0;

  function emit(t, state) {
    const hubs = t.tires.map((_, k) => t.object.tireHub(k));
    let fx = hubs[0][0] + hubs[1][0] - hubs[2][0] - hubs[3][0], fz = hubs[0][2] + hubs[1][2] - hubs[2][2] - hubs[3][2];
    const len = Math.hypot(fx, fz) || 1;
    fx /= len; fz /= len;
    const back = [-fx, 0, -fz];
    const speed = Math.abs(t.pose?.speed ?? 0);
    t.tires.forEach((tire, k) => {
      const hub = hubs[k];
      const at = [hub[0], ground(hub[0], hub[2]), hub[2]];
      if (!tire.onGround || hub[1] - (t.radius ?? 1.5) - at[1] > 0.5) return;
      const type = Math.floor((tire.surface ?? 0) / 100);
      const fired = stepGates(state.gates[k], EMIT_TICK_S, tire, random);
      if (fired.spin || fired.slide) {
        const kind = particleKind(type, random);
        if (kind !== null) {
          const strength = burstStrength(tire.slip ?? 0, tire.vLat ?? 0);
          const texel = kind === KIND.SNOW ? [255, 255, 255] : groundTexel(atlas, clr, at[0], at[2]) ?? [80, 55, 0];
          const light = kind === KIND.SNOW ? 1 : random() < 0.5 ? 1 : 0.75;
          for (let n = 0; n < burstCount(kind); n++) {
            const from = [at[0] + (random() - 0.5) * 0.5, at[1] + 0.2, at[2] + (random() - 0.5) * 0.5];
            pool.add(from, burstVelocity(back, strength, random), texel.map((v) => (v / 255) * light), particleSize(kind, random), kind, LIFE_S);
          }
        }
      }
      // Leaves (0x4fd850; the port throws fewer): from a tire over the water, half a foot aside; none from Cement (type 1).
      if (leaves && speed > 15 && type !== 1 && (waterLevelFt === null || at[1] > waterLevelFt)) {
        for (let n = 0; n < LEAVES_PER_TICK; n++) {
          const tone = LEAF_COLOURS[Math.floor(random() * LEAF_COLOURS.length)];
          if (!leafPool.add([at[0] + 0.5, at[1], at[2]], tone.map((v) => v / 255), speed)) break;
        }
      }
    });
  }

  return {
    /** Once a frame. `trucks` as the tire effects take them: `{ object, pose, tires, radius }`. */
    update({ dt, trucks, camera }) {
      clock += dt;
      const ticks = Math.floor(clock / EMIT_TICK_S);
      clock -= ticks * EMIT_TICK_S;
      trucks.forEach((t, i) => {
        if (!t?.object || !t.tires) return;
        let state = states.get(i);
        if (!state) { state = { gates: t.tires.map(() => createTireGates(random)) }; states.set(i, state); }
        for (let n = 0; n < Math.min(ticks, 2); n++) emit(t, state);
      });
      pool.step(dt, ground);
      leafPool.step(dt, ground);
      camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
      const eyeX = camera.position.x, eyeZ = -camera.position.z;
      let q = 0;
      for (const list of [pool.particles, leafPool.particles]) {
        for (const p of list) {
          const o = q * 12;
          const near = p.life > 0 && (p.pos[0] - eyeX) ** 2 + (p.pos[1] - camera.position.y) ** 2 + (p.pos[2] - eyeZ) ** 2 < NEAREST_FT * NEAREST_FT;
          if (p.life <= 0 || near) { positions.fill(0, o, o + 12); positions[o + 1] = positions[o + 4] = positions[o + 7] = positions[o + 10] = -1e6; q++; continue; }
          const x = nearest(p.pos[0], eyeX), y = p.pos[1], z = -nearest(p.pos[2], eyeZ), s = p.size * 0.5;
          // The square turned in the view by the particle's angle.
          const ca = Math.cos(p.angle) * s, sa = Math.sin(p.angle) * s;
          CORNERS.forEach(([a, b], c) => {
            const u = a * ca - b * sa, v = a * sa + b * ca;
            positions[o + c * 3] = x + right.x * u + up.x * v;
            positions[o + c * 3 + 1] = y + right.y * u + up.y * v;
            positions[o + c * 3 + 2] = z + right.z * u + up.z * v;
          });
          colour.setRGB(p.colour[0], p.colour[1], p.colour[2], THREE.SRGBColorSpace);
          for (let c = 0; c < 4; c++) colours.set([colour.r, colour.g, colour.b], o + c * 3);
          q++;
        }
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.map?.dispose();
      material.dispose();
      mesh.removeFromParent();
    },
  };
}
