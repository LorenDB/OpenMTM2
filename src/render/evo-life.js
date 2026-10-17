/*
  4x4 Evolution's AI life drawn (the rules are game/evo-life.js): each bird the level's BIRD.SMF, turned along its flight,
  its wing frame a blend of the model's frames (morph targets, worker/evo-models.js). The world wraps: a bird is drawn at
  the copy nearest the eye.
*/
import * as THREE from "three";
import { createEvoLife } from "../game/evo-life.js";
import { toSceneMatrix } from "../shared/scene-frame.js";
import { createModelLibrary } from "./track-scene.js";

const WORLD_FT = 8192;
const nearest = (v, to) => v + Math.round((to - v) / WORLD_FT) * WORLD_FT;

/**
 * `life` is the build's `life` (worker/evo-track-build.js): `{ model, path, checkpoints }`; `models` and `textures` the
 * build's; `ground(x, z)` the height a bird stands on. Null when the level has none.
 */
export function createEvoLifeScene({ scene, life, models, textures, look, ground }) {
  const model = life && models?.[life.model];
  if (!model?.meshes?.length) return null;
  const frames = model.keyframes?.length ?? 1;
  const state = createEvoLife({ path: life.path, checkpoints: life.checkpoints, frames });
  if (!state) return null;
  const library = createModelLibrary({ [life.model]: model }, textures, look);
  const parts = library.get(life.model) ?? [];
  const group = new THREE.Group();
  group.name = "evo-life";
  const birds = [];
  for (const flock of state.flocks) {
    for (const bird of flock.birds) {
      const object = new THREE.Group();
      object.matrixAutoUpdate = false;
      const meshes = parts.map(({ geometry, material }) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        if (frames > 1) mesh.updateMorphTargets();
        object.add(mesh);
        return mesh;
      });
      group.add(object);
      birds.push({ bird, object, meshes });
    }
  }
  scene.add(group);
  const m = new THREE.Matrix4(), scratch = new Array(16);
  return {
    /** Once a frame: `vehicles` the trucks' positions in game feet. */
    update(dt, camera, vehicles) {
      state.step(dt, ground, vehicles);
      const eyeX = camera.position.x, eyeZ = -camera.position.z;
      for (const { bird, object, meshes } of birds) {
        // The body's axes in the game's frame: forward along the flight, its nose up or down by the pitch.
        const ch = Math.cos(bird.heading), sh = Math.sin(bird.heading), cp = Math.cos(bird.pitch), sp = Math.sin(bird.pitch);
        const forward = [sh * cp, -sp, ch * cp], right = [ch, 0, -sh];
        const up = [forward[1] * right[2] - forward[2] * right[1], forward[2] * right[0] - forward[0] * right[2], forward[0] * right[1] - forward[1] * right[0]];
        const matrix = [right[0], up[0], forward[0], right[1], up[1], forward[1], right[2], up[2], forward[2]];
        const pos = [nearest(bird.pos[0], eyeX), bird.pos[1], nearest(bird.pos[2], eyeZ)];
        m.fromArray(toSceneMatrix(matrix, pos, scratch));
        object.matrix.copy(m);
        object.matrixWorldNeedsUpdate = true;
        if (frames > 1) {
          // Frame 0 is the mesh: the targets take the rest.
          const at = Math.max(0, Math.min(frames - 1, bird.frame));
          for (const mesh of meshes) {
            const weights = mesh.morphTargetInfluences;
            weights.fill(0);
            const from = Math.floor(at), to = Math.min(frames - 1, from + 1), t = at - from;
            if (from > 0) weights[from - 1] += 1 - t;
            if (to > 0) weights[to - 1] += t;
          }
        }
      }
    },
    dispose() {
      group.removeFromParent();
    },
  };
}
