/*
  MTM2's truck reflections, "Truck reflections" in Options (MONSTER_EXE_ANALYSIS.md "Reflections", 0x5225d0): each body
  face that faces the eye drawn again in CLOUDENV, translucent at 128 of 255, the texel for a vertex worked out from the
  view and not from the face: `e` the way from the eye to the vertex, `n` the camera's view axis,
  `r = 2 (e . n) e - n`, and the texel `(0.5 + 0.5 r.x, 0.5 + 0.5 r.z)` on the game's axes (z forward; the scene's is
  mirrored). None in Foggy, Dense Fog and Pitch Black, and none in the water's mirrored picture.
*/
import * as THREE from "three";
import { addShaderHook } from "./shader-hooks.js";

/** The weathers in which the game draws no truck reflection. */
export const NO_TRUCK_REFLECTION = new Set([2, 3, 8]);
const OPACITY = 128 / 255;

function envTexture({ width, height, rgba }) {
  const texture = new THREE.DataTexture(new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** `image` is the worker's `envMap` for the race's weather; null makes nothing. */
export function createTruckReflections(image) {
  if (!image) return null;
  const viewAxis = { value: new THREE.Vector3(0, 0, -1) };
  /*
    The game's body under the overlay is lit no brighter than its texture, so half and half with CLOUDENV brightens it.
    The port's sun lights a body past that, and the same mix would pull it down to the unlit clouds: the truck looked
    darker with its reflection than without. A screen blend, `cloud x 128/255 + body x (1 - cloud x 128/255)`, is the
    game's mix over a body of the game's brightness and never darkens a brighter one.
  */
  const material = new THREE.MeshBasicMaterial({
    map: envTexture(image), transparent: true, opacity: OPACITY, depthWrite: false, depthFunc: THREE.LessEqualDepth,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, side: THREE.FrontSide,
    premultipliedAlpha: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcColorFactor,
  });
  addShaderHook(material, "truck-reflection", 10, (shader) => {
    shader.uniforms.uEnvAxis = viewAxis;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uEnvAxis;\nvarying vec2 vEnvUv;")
      .replace("#include <project_vertex>", `#include <project_vertex>
  vec3 envWay = normalize( ( modelMatrix * vec4( transformed, 1.0 ) ).xyz - cameraPosition );
  vec3 envBack = 2.0 * dot( envWay, uEnvAxis ) * envWay - uEnvAxis;
  // The game's z is the scene's mirrored.
  vEnvUv = 0.5 + 0.5 * vec2( envBack.x, - envBack.z );`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vEnvUv;")
      .replace("#include <map_fragment>", "diffuseColor *= texture2D( map, vEnvUv );");
  });
  const overlays = new Set();
  let shown = true;
  return {
    /** Give a truck (render/truck-object.js) its reflection: each body mesh drawn again over itself. */
    dress(object) {
      object?.traverse((group) => {
        if (!group.userData?.body) return;
        for (const mesh of [...group.children]) {
          if (!mesh.isMesh || mesh.userData.reflection) continue;
          const overlay = new THREE.Mesh(mesh.geometry, material);
          overlay.userData.reflection = true;
          overlay.renderOrder = (mesh.renderOrder ?? 0) + 1;
          overlay.visible = shown;
          mesh.add(overlay);
          overlays.add(overlay);
        }
      });
    },
    /** Once a frame: the camera's view axis, and whether `weather` has them. */
    update(camera, weather) {
      camera.getWorldDirection(viewAxis.value);
      const on = !NO_TRUCK_REFLECTION.has(weather);
      if (on !== shown) { shown = on; for (const overlay of overlays) overlay.visible = on; }
    },
    /** Shown or hidden for one picture (the water's mirrored one has none). */
    setVisible(on) { for (const overlay of overlays) overlay.visible = on && shown; },
    /** A new texture for a new weather. */
    setImage(next) {
      if (!next) return;
      material.map?.dispose();
      material.map = envTexture(next);
      material.needsUpdate = true;
    },
    dispose() {
      for (const overlay of overlays) overlay.removeFromParent();
      overlays.clear();
      material.map?.dispose();
      material.dispose();
    },
  };
}
