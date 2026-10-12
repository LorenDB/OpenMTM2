/*
  The lens (docs/VISUALS.md, "Lens"), when "Lens effects" is on: bright lights glow.

  The scene is drawn first into a picture that can hold light brighter than white (half
  floats), so the sun, its glint on water and on paint, a headlight's lens and a flash of
  lightning keep how bright they are. How many samples a point that picture takes is the
  anti-aliasing choice (game/aa.js): four for MSAA, two above five million points, and one
  for every other choice. What is brighter than the screen can show is then spread into a
  glow around it (three.js's bloom: the bright parts blurred at five sizes and added back),
  and the whole is put on the screen through the same curve the materials would have used
  (render/light-rig.js), with its corners a little darkened as a lens leaves them.

  The glow is a pass over the finished picture, and so is anti-aliasing when an optional
  method is chosen (render/aa.js). Both are the flat screen's only: a headset draws each eye
  straight to its own display, and the race draws there without them (docs/VR.md).

  While it draws, colours leave the materials as light, not yet encoded for the screen, and
  the fog's colours are given the same way (render/atmosphere.js `output`).

  What is drawn `over` the scene (the puffs of dust and smoke, render/particles.js) is drawn
  after it, into a picture of its own laid over the scene's, and reads how far away the scene
  is at each point (the scene's depth, kept as a texture): so a puff stops where the ground, a
  truck or a wall stands in it, softly, instead of being cut by it. Without the lens (a
  headset) the same things are drawn after the scene straight over it, and are cut where the
  depth says.
*/
import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { aaSamples } from "../game/aa.js";
import { LENS } from "../game/lighting.js";
import { UNDERWATER } from "../game/water.js";
import { LINEAR_TO_SRGB_GLSL } from "./aa.js";
import { atmosphere } from "./atmosphere.js";
import { TONE_GLSL } from "./light-rig.js";

/** Where light begins to glow and glows in full, the corners' darkening and the brightest point kept (game/lighting.js `LENS`). */
const GLOW_FROM = LENS.glowFrom, GLOW_FULL = LENS.glowFull, CORNERS = LENS.corners, BRIGHTEST = LENS.brightest;
/** How strong the glow is, and how wide it spreads, 0 to 1. */
const GLOW_STRENGTH = 0.42, GLOW_RADIUS = 0.55;

/*
  The scene's picture made safe to blur. A float picture can hold what is not a number (a
  shader's arithmetic gone wrong at one point), which a blur would spread over everything
  around it; and one point a thousand times too bright would glow like a second sun. Both are
  taken out here, where an 8 bit picture would have hidden them as one dark or white point.
*/
const CLEAN = {
  uniforms: { tDiffuse: { value: null }, tOver: { value: null }, uOver: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tOver;
    uniform float uOver;
    varying vec2 vUv;
    void main() {
      vec3 color = texture2D( tDiffuse, vUv ).rgb;
      // What is drawn over the scene, its colour already times how much it hides.
      if ( uOver > 0.5 ) { vec4 over = texture2D( tOver, vUv ); color = color * ( 1.0 - over.a ) + over.rgb; }
      if ( any( isnan( color ) ) || any( isinf( color ) ) ) color = vec3( 0.0 );
      gl_FragColor = vec4( clamp( color, 0.0, ${BRIGHTEST.toFixed(1)} ), 1.0 );
    }`,
};

const FINAL = {
  uniforms: {
    tDiffuse: { value: null }, uTone: { value: 0 }, uExposure: { value: 1 }, uCorners: { value: CORNERS }, uUnder: { value: 0 },
    // 1: encode here, because the destination is a picture FXAA or SMAA will read. 0: the screen encodes.
    uManual: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTone, uExposure, uCorners;
    // how far under water the eye is (0 out of it, 1 under)
    uniform float uUnder, uManual;
    varying vec2 vUv;
    ${TONE_GLSL}
    ${LINEAR_TO_SRGB_GLSL}
    void main() {
      vec3 color = max( texture2D( tDiffuse, vUv ).rgb, 0.0 ) * uExposure;
      // Under water the picture has lost its red (game/water.js).
      color *= mix( vec3( 1.0 ), vec3( ${UNDERWATER.tint.map((v) => v.toFixed(3)).join(", ")} ), uUnder );
      // The curve, where the scene is lit for it; else what is over white is cut off, as a screen cuts it.
      color = uTone > 0.5 ? mtmToneCurve( color ) : min( color, 1.0 );
      vec2 off = ( vUv - 0.5 ) * 2.0;
      color *= 1.0 - mix( uCorners, ${UNDERWATER.corners.toFixed(2)}, uUnder ) * smoothstep( 0.55, 1.45, length( off ) );
      // A pass into its own picture has to encode for itself. The screen encodes the rest.
      if ( uManual > 0.5 ) gl_FragColor = vec4( mtmLinearToSrgb( color ), 1.0 );
      else gl_FragColor = linearToOutputTexel( vec4( color, 1.0 ) );
    }`,
};

/**
 * @param {{ renderer: THREE.WebGLRenderer, aa?: object|null }} env
 *   `aa` is the optional anti-aliasing (render/aa.js), or null for MSAA, which this draws as it always did.
 */
export function createLens({ renderer, aa = null }) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const samplesFor = (w, h) => (aa ? aa.samples(w, h) : aaSamples("msaa", w, h));
  // The scene's picture, and its depth for what is drawn over it.
  const sceneTarget = (w, h) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: samplesFor(w, h), depthTexture: new THREE.DepthTexture(w, h) });
  let target = sceneTarget(Math.max(1, size.x), Math.max(1, size.y));
  // What is drawn over the scene, in a picture of its own, and what it reads of the scene.
  const overScene = new THREE.Scene();
  overScene.name = "over the scene";
  const overTarget = new THREE.WebGLRenderTarget(target.width, target.height, { type: THREE.HalfFloatType, depthBuffer: false });
  const overUniforms = { uSceneDepth: { value: target.depthTexture }, uSceneSoft: { value: 0 }, uSceneSize: { value: new THREE.Vector2(target.width, target.height) } };
  const clearColor = new THREE.Color();
  /** Whether anything is to be drawn over the scene this frame. */
  const anyOver = () => overScene.children.some((child) => child.visible);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), GLOW_STRENGTH, GLOW_RADIUS, GLOW_FROM);
  bloom.highPassUniforms.smoothWidth.value = GLOW_FULL - GLOW_FROM;
  // The scene's picture cleaned (below), which the glow is added to and the screen is drawn from.
  const clean = new THREE.WebGLRenderTarget(target.width, target.height, { type: THREE.HalfFloatType, depthBuffer: false });
  const pass = (shader) => new THREE.ShaderMaterial({ ...shader, uniforms: THREE.UniformsUtils.clone(shader.uniforms), depthTest: false, depthWrite: false, toneMapped: false });
  const cleaning = pass(CLEAN), material = pass(FINAL);
  const quad = new FullScreenQuad(material);
  const clock = new THREE.Clock();

  return {
    /** The picture changed size: `width` and `height` in the screen's own points. */
    setSize(width, height) {
      const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
      aa?.setSize(w, h);
      if (w === target.width && h === target.height) return;
      if (samplesFor(w, h) !== target.samples) {
        target.depthTexture.dispose();
        target.dispose();
        target = sceneTarget(w, h);
      } else target.setSize(w, h);
      overUniforms.uSceneDepth.value = target.depthTexture;
      overUniforms.uSceneSize.value.set(w, h);
      overTarget.setSize(w, h);
      clean.setSize(w, h);
      bloom.setSize(w, h);
    },
    /**
     * Draw `scene` through the lens to the screen. `tone` says the scene is lit for the curve ("Natural light");
     * `under` how far under water the eye is, 0 to 1, where the picture loses its red.
     */
    render(scene, camera, { tone = false, under = 0 } = {}) {
      atmosphere.output(true);
      const before = renderer.getRenderTarget();
      // TAA shifts the camera for this draw and puts it back before the glow, the mirror and the flare.
      const endJitter = aa?.begin(camera, target.width, target.height) ?? (() => {});
      try {
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        // What is drawn over it, into a picture of its own that starts clear, reading the scene's depth.
        const over = anyOver();
        if (over) {
          overScene.fog = scene.fog;
          overUniforms.uSceneSoft.value = 1;
          const alpha = renderer.getClearAlpha();
          renderer.getClearColor(clearColor);
          renderer.setClearColor(0x000000, 0);
          renderer.setRenderTarget(overTarget);
          renderer.render(overScene, camera);
          renderer.setClearColor(clearColor, alpha);
        }
        cleaning.uniforms.tOver.value = overTarget.texture;
        cleaning.uniforms.uOver.value = over ? 1 : 0;
        cleaning.uniforms.tDiffuse.value = target.texture;
        quad.material = cleaning;
        renderer.setRenderTarget(clean);
        quad.render(renderer);
      } finally {
        endJitter();
      }
      // TAA keeps the picture from before the glow is added.
      if (aa?.post === "taa") aa.settle(clean, target.depthTexture, camera);
      bloom.render(renderer, null, clean, clock.getDelta(), false);
      material.uniforms.tDiffuse.value = clean.texture;
      material.uniforms.uTone.value = tone ? 1 : 0;
      material.uniforms.uExposure.value = renderer.toneMappingExposure;
      material.uniforms.uUnder.value = under;
      const spatial = aa?.post === "fxaa" || aa?.post === "smaa";
      // FXAA and SMAA read an encoded picture, so the curve's result is encoded here. The screen encodes the rest.
      material.uniforms.uManual.value = spatial ? 1 : 0;
      quad.material = material;
      if (spatial) {
        const picture = aa.encoded(target.width, target.height);
        renderer.setRenderTarget(picture);
        quad.render(renderer);
        material.uniforms.uManual.value = 0;
        renderer.setRenderTarget(before);
        aa.filter(picture);
      } else {
        renderer.setRenderTarget(before);
        quad.render(renderer);
      }
    },
    /** A frame drawn without the lens (a headset): colours are encoded for the screen by the materials again. */
    rest() { atmosphere.output(false); },
    /**
     * What is drawn over the scene (render/particles.js): `scene` to add it to, and `uniforms`, what its materials read
     * of the scene: `uSceneDepth` its depth, `uSceneSize` the picture's size in points, and `uSceneSoft` 1 where they
     * are drawn into a picture of their own and read the depth, 0 where they are drawn straight over the scene.
     */
    over: { scene: overScene, uniforms: overUniforms },
    /** After the scene was drawn without the lens (`rest`), with the same `camera`: what is drawn over it, straight over it. */
    drawOver(scene, camera) {
      if (!anyOver()) return;
      overScene.fog = scene.fog;
      overUniforms.uSceneSoft.value = 0;
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(overScene, camera);
      renderer.autoClear = auto;
    },
    dispose() {
      atmosphere.output(false);
      target.depthTexture.dispose();
      target.dispose();
      overTarget.dispose();
      clean.dispose();
      bloom.dispose();
      cleaning.dispose();
      material.dispose();
      quad.dispose();
    },
  };
}
