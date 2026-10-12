/*
  The shade under a truck (docs/VISUALS.md, "Light"), with "Natural light". The sky lights the
  ground from every side, and a truck standing on it keeps a good part of the sky off the
  ground beneath it: that patch is darker whatever the sun does. Under an overcast sky, in
  fog, rain and snow, where the sun's own shadows are faint, it is what stands a truck on the
  ground instead of over it.

  It is one soft dark patch a truck, laid on the drawn ground under it and turned with it,
  fainter as the truck leaves the ground. Nothing is drawn twice for it.
*/
import * as THREE from "three";
import { standOnFt } from "../game/ice.js";
import { contactShade } from "../game/lighting.js";
const SNOW = 5;
/** The patch reaches this far beyond the truck's wheels, feet, as the sky is kept off the ground a little beyond its sides. */
const MARGIN_FT = 2.5;
/** It lies this far over the ground, feet, so the ground does not cut it. */
const LIFT_FT = 0.12;

/** A soft patch: dark in the middle, fading to nothing before the square's edge. */
function patchTexture() {
  const side = 64, canvas = document.createElement("canvas");
  canvas.width = canvas.height = side;
  const g = canvas.getContext("2d");
  const fade = g.createRadialGradient(side / 2, side / 2, side * 0.12, side / 2, side / 2, side / 2);
  fade.addColorStop(0, "rgba(0,0,0,1)");
  fade.addColorStop(0.55, "rgba(0,0,0,0.55)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = fade;
  g.fillRect(0, 0, side, side);
  return new THREE.CanvasTexture(canvas);
}

/**
 * @param {{ scene: THREE.Scene, trucks: { hubs: number[][], radius: number }[], ground: (x: number, z: number) => number }} env
 *   `trucks` gives each truck's wheel anchors (body axes, feet) and tire radius; `ground` the
 *   height of what is drawn under a point, in game feet.
 */
export function createContactShade({ scene, trucks, ground: groundAt }) {
  const map = patchTexture();
  const root = new THREE.Group();
  root.name = "contact-shade";
  scene.add(root);
  const patches = trucks.map(({ hubs, radius }) => {
    const xs = hubs.map((hub) => Math.abs(hub[0])), zs = hubs.map((hub) => hub[2]);
    const width = Math.max(...xs) * 2 + radius + MARGIN_FT * 2, length = Math.max(...zs) - Math.min(...zs) + radius * 2 + MARGIN_FT * 2;
    const material = new THREE.MeshBasicMaterial({ map, color: 0x000000, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material);
    mesh.scale.set(width, 1, length);
    mesh.renderOrder = 1;
    mesh.visible = false;
    root.add(mesh);
    return { mesh, material, middle: (Math.max(...zs) + Math.min(...zs)) / 2, hubY: Math.min(...hubs.map((hub) => hub[1])) - radius, reach: Math.max(width, length) / 2 };
  });
  const up = new THREE.Vector3(), forward = new THREE.Vector3(), side = new THREE.Vector3(), basis = new THREE.Matrix4();

  return {
    /**
     * Once a frame: `poses` are the drawn trucks' poses (game feet: `pos`, `euler[2]` the
     * heading), `sunShadow` how dark the sun's own shadows are, 0 to 1 (the patch is fainter
     * where they already do the work; game/lighting.js `contactShade`), and `iceFt` the level of
     * the ice in Snow (null without): over the level's water a truck stands on the ice, and the
     * patch lies on it, not on the bed under it.
     */
    update(poses, sunShadow = 1, iceFt = null) {
      const ground = iceFt === null ? groundAt : (x, z) => standOnFt(groundAt(x, z), SNOW, iceFt);
      patches.forEach((patch, i) => {
        const pose = poses[i];
        patch.mesh.visible = !!pose;
        if (!patch.mesh.visible) return;
        const yaw = pose.euler[2], sin = Math.sin(yaw), cos = Math.cos(yaw);
        // The patch's middle is under the middle of the wheels.
        const x = pose.pos[0] + sin * patch.middle, z = pose.pos[2] + cos * patch.middle;
        const y = ground(x, z);
        // The ground's lie there, from a point ahead and one to the side.
        const d = patch.reach * 0.6;
        const ahead = ground(x + sin * d, z + cos * d) - ground(x - sin * d, z - cos * d), across = ground(x + cos * d, z - sin * d) - ground(x - cos * d, z + sin * d);
        // Game axes to the scene's: z is mirrored.
        forward.set(sin * 2 * d, ahead, -cos * 2 * d).normalize();
        side.set(cos * 2 * d, across, sin * 2 * d).normalize();
        up.crossVectors(side, forward).normalize();
        if (up.y < 0) up.negate();
        side.crossVectors(forward, up).normalize();
        basis.makeBasis(side, up, forward);
        patch.mesh.quaternion.setFromRotationMatrix(basis);
        patch.mesh.position.set(x, y + LIFT_FT, -z);
        // How far the wheels' undersides are off the ground: a truck in the air shades nothing.
        patch.material.opacity = contactShade(pose.pos[1] + patch.hubY - y, sunShadow);
      });
    },
    dispose() {
      scene.remove(root);
      map.dispose();
      for (const patch of patches) { patch.mesh.geometry.dispose(); patch.material.dispose(); }
    },
  };
}
