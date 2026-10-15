/*
  MTM2's water reflections, "Water reflections" in Options (MONSTER_EXE_ANALYSIS.md "Reflections", 0x52f3a0): with the
  eye above the water the game first draws the world mirrored in the water's plane, then the frame over it, so the
  translucent water shows the world upside down. Here the mirrored world is drawn into a picture of its own, from the
  eye reflected in the water's plane, with everything under the plane cut away; the game's water shows it where it
  shows what is under it. The water itself is not in the mirrored picture, nor are the trucks' reflections.

  For the game's own water (render/water-effects.js `createWaterSurface`). "Reflective water" has a mirror of its own.
*/
import * as THREE from "three";
import { addShaderHook } from "./shader-hooks.js";

/** How the mirrored picture's size compares with the screen's. */
const SCALE = 0.5;
/** A little of the clip plane's offset, so the water's own edge is not drawn into it. */
const CLIP_BIAS = 0.003;

/**
 * `levelAt()` gives the water's height now (scene units are feet), or null when the level has none; `hide` the objects to
 * leave out of the mirrored picture (the water and anything only of the real one). Returns null without a renderer.
 */
export function createWaterMirror({ renderer, scene, levelAt, hide = () => [] }) {
  if (!renderer) return null;
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
  target.texture.generateMipmaps = false;
  const mirrorCamera = new THREE.PerspectiveCamera();
  mirrorCamera.matrixAutoUpdate = true;
  const uniforms = { uMirror: { value: target.texture }, uMirrorMatrix: { value: new THREE.Matrix4() }, uMirrorOn: { value: 0 } };
  const normal = new THREE.Vector3(0, 1, 0), point = new THREE.Vector3(), eye = new THREE.Vector3(), view = new THREE.Vector3();
  const rotation = new THREE.Matrix4(), lookAt = new THREE.Vector3(), aim = new THREE.Vector3(), plane = new THREE.Plane();
  const clip = new THREE.Vector4(), q = new THREE.Vector4(), size = new THREE.Vector2();
  const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

  /** The mirrored picture for `camera`, drawn before the frame; false when there is none to draw (the eye under the water). */
  function render(camera) {
    const level = levelAt();
    eye.setFromMatrixPosition(camera.matrixWorld);
    if (level === null || eye.y <= level) { uniforms.uMirrorOn.value = 0; return false; }
    renderer.getDrawingBufferSize(size);
    const w = Math.max(1, Math.round(size.x * SCALE)), h = Math.max(1, Math.round(size.y * SCALE));
    if (target.width !== w || target.height !== h) target.setSize(w, h);

    // The eye, where it looks and its up, reflected in the plane y = level (three.js's Reflector does the same).
    point.set(eye.x, level, eye.z);
    view.subVectors(point, eye).reflect(normal).negate().add(point);
    rotation.extractRotation(camera.matrixWorld);
    lookAt.set(0, 0, -1).applyMatrix4(rotation).add(eye);
    aim.subVectors(point, lookAt).reflect(normal).negate().add(point);
    mirrorCamera.position.copy(view);
    mirrorCamera.up.set(0, 1, 0).applyMatrix4(rotation).reflect(normal);
    mirrorCamera.lookAt(aim);
    mirrorCamera.far = camera.far;
    mirrorCamera.updateMatrixWorld();
    mirrorCamera.projectionMatrix.copy(camera.projectionMatrix);
    uniforms.uMirrorMatrix.value.copy(bias).multiply(mirrorCamera.projectionMatrix).multiply(mirrorCamera.matrixWorldInverse);

    // What lies under the water is cut away by the projection itself (an oblique near plane).
    plane.setFromNormalAndCoplanarPoint(normal, point).applyMatrix4(mirrorCamera.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const p = mirrorCamera.projectionMatrix.elements;
    q.set((Math.sign(clip.x) + p[8]) / p[0], (Math.sign(clip.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    p[2] = clip.x; p[6] = clip.y; p[10] = clip.z + 1 - CLIP_BIAS; p[14] = clip.w;

    const hidden = hide().filter((object) => object?.visible);
    for (const object of hidden) object.visible = false;
    const before = renderer.getRenderTarget(), xr = renderer.xr.enabled, shadows = renderer.shadowMap.autoUpdate;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, mirrorCamera);
    renderer.setRenderTarget(before);
    renderer.xr.enabled = xr;
    renderer.shadowMap.autoUpdate = shadows;
    for (const object of hidden) object.visible = true;
    uniforms.uMirrorOn.value = 1;
    return true;
  }

  /**
   * Have the game's water show the mirrored picture where it would show what is under it: the water's colour at its own
   * opacity over the world mirrored, and opaque.
   */
  function dress(material) {
    addShaderHook(material, "water-mirror", 30, (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform mat4 uMirrorMatrix;\nvarying vec4 vMirrorCoord;")
        .replace("#include <project_vertex>", "#include <project_vertex>\n\tvMirrorCoord = uMirrorMatrix * modelMatrix * vec4( transformed, 1.0 );");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform sampler2D uMirror;\nuniform float uMirrorOn;\nvarying vec4 vMirrorCoord;")
        .replace("#include <opaque_fragment>", `#include <opaque_fragment>
  if ( uMirrorOn > 0.5 ) {
    vec3 mirrored = texture2DProj( uMirror, vMirrorCoord ).rgb;
    gl_FragColor = vec4( mix( mirrored, gl_FragColor.rgb, gl_FragColor.a ), 1.0 );
  }`);
    });
    material.needsUpdate = true;
  }

  return { render, dress, dispose() { target.dispose(); } };
}
