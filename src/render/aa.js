/*
  Optional anti-aliasing (docs/VISUALS.md, "Anti-aliasing").

  MSAA is not done here. The scene picture is simply drawn with several samples, which is what
  the port already did, and this module is not even made for that choice. Off, FXAA, SMAA and
  TAA are. Each draws the scene once a point. FXAA and SMAA then run on the encoded picture,
  the one the eye sees. TAA runs on the light values, before the glow and the curve, and keeps
  nine tenths of the frame before where the new frame agrees with it.

  The camera is shifted by less than half a pixel for that one draw and put back before this
  returns, so the mirror and the flare are not shifted. three.js turns that shift into a
  change of the projection (Camera.setViewOffset): the offset is in pixels of the picture, and
  it scales the frustum by the same, so half a pixel stays half a pixel. The matrices the
  resolve uses are the ones that draw was made with, not a second projection.
*/
import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { TAA_DEPTH_FT, TAA_DEPTH_SHARE, TAA_HISTORY, aaPost, aaResets, aaSamples, taaJitter } from "../game/aa.js";
import { atmosphere } from "./atmosphere.js";
import { TONE_GLSL } from "./light-rig.js";

/**
 * three.js encodes a colour for the screen only when the destination is the screen. A pass
 * into its own picture has to encode for itself, with the same transfer (sRGBTransferOETF).
 * Negatives are cut off so a bad pixel cannot poison the pow.
 */
export const LINEAR_TO_SRGB_GLSL = /* glsl */ `
vec3 mtmLinearToSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
}
`;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** The light values put on the screen: the curve where the scene is lit for it, then the encoding. */
const GRADE = {
  uniforms: {
    tDiffuse: { value: null },
    uTone: { value: 0 },
    uExposure: { value: 1 },
    // 1: encode here, because the destination is a picture FXAA or SMAA will read. 0: the screen encodes.
    uManual: { value: 0 },
  },
  vertexShader: QUAD_VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTone, uExposure, uManual;
    varying vec2 vUv;
    ${TONE_GLSL}
    ${LINEAR_TO_SRGB_GLSL}
    void main() {
      // The curve where the scene is lit for it; else what is over white is cut off, as the lens cuts it.
      vec3 color = max(texture2D(tDiffuse, vUv).rgb, 0.0) * uExposure;
      color = uTone > 0.5 ? mtmToneCurve(color) : min(color, vec3(1.0));
      if (uManual > 0.5) gl_FragColor = vec4(mtmLinearToSrgb(color), 1.0);
      else gl_FragColor = linearToOutputTexel(vec4(color, 1.0));
    }
  `,
};

const COPY = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: QUAD_VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() { gl_FragColor = texture2D(tDiffuse, vUv); }
  `,
};

/*
  The distance of the surface at each point, in feet, from the window depth the picture was
  drawn with. The same rearrangement of the projection the puffs use (render/particles.js).
  Stored for the next frame, which rejects a point whose distance no longer agrees.
*/
const DEPTH_COPY = {
  uniforms: { tDepth: { value: null }, uProj: { value: new THREE.Matrix4() } },
  vertexShader: QUAD_VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDepth;
    uniform mat4 uProj;
    varying vec2 vUv;
    void main() {
      float ndcZ = texture2D(tDepth, vUv).r * 2.0 - 1.0;
      float viewZ = uProj[3][2] / (ndcZ + uProj[2][2]);
      gl_FragColor = vec4(-viewZ, 0.0, 0.0, 1.0);
    }
  `,
};

/*
  One sample this frame, blended with the frame before. The new point is clipped to the
  colours around it, in YCoCg, so a colour the neighbourhood does not hold cannot bleed in
  from the frame before. Where the clip had to pull it back, less of that frame is kept.
*/
const TAA = {
  uniforms: {
    tCurrent: { value: null },
    tHistory: { value: null },
    tDepth: { value: null },
    tHistoryDepth: { value: null },
    uTexel: { value: new THREE.Vector2() },
    uJitteredInvProj: { value: new THREE.Matrix4() },
    uJitteredCamWorld: { value: new THREE.Matrix4() },
    uPrevVP: { value: new THREE.Matrix4() },
    uPrevView: { value: new THREE.Matrix4() },
    uKeep: { value: 0 },
    uDepthFt: { value: TAA_DEPTH_FT },
    uDepthShare: { value: TAA_DEPTH_SHARE },
  },
  vertexShader: QUAD_VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tCurrent, tHistory, tDepth, tHistoryDepth;
    uniform vec2 uTexel;
    uniform mat4 uJitteredInvProj, uJitteredCamWorld, uPrevVP, uPrevView;
    uniform float uKeep, uDepthFt, uDepthShare;
    varying vec2 vUv;
    vec3 safe(vec3 c) {
      if (any(isnan(c)) || any(isinf(c))) return vec3(0.0);
      return max(c, 0.0);
    }
    vec3 rgbToYcocg(vec3 c) {
      return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25)));
    }
    vec3 ycocgToRgb(vec3 c) {
      return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
    }
    void main() {
      vec3 current = safe(texture2D(tCurrent, vUv).rgb);
      float keep = uKeep;
      if (keep > 0.0) {
        float depth = texture2D(tDepth, vUv).r;
        vec4 viewH = uJitteredInvProj * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
        viewH /= viewH.w;
        vec3 world = (uJitteredCamWorld * vec4(viewH.xyz, 1.0)).xyz;
        vec4 prevClip = uPrevVP * vec4(world, 1.0);
        vec2 prevUv = prevClip.xy / prevClip.w * 0.5 + 0.5;
        float zPoint = -(uPrevView * vec4(world, 1.0)).z;
        float zHist = texture2D(tHistoryDepth, prevUv).r;
        if (prevClip.w <= 1e-4 || prevUv.x < 0.0 || prevUv.y < 0.0 || prevUv.x > 1.0 || prevUv.y > 1.0
            || abs(zPoint - zHist) > max(uDepthFt, abs(zPoint) * uDepthShare)) keep = 0.0;
        if (keep > 0.0) {
          vec3 mn = vec3(1e9);
          vec3 mx = vec3(-1e9);
          for (int j = -1; j <= 1; j++) {
            for (int i = -1; i <= 1; i++) {
              vec3 c = rgbToYcocg(safe(texture2D(tCurrent, vUv + vec2(float(i), float(j)) * uTexel).rgb));
              mn = min(mn, c);
              mx = max(mx, c);
            }
          }
          vec3 centre = 0.5 * (mn + mx);
          vec3 extent = max(0.5 * (mx - mn), vec3(1e-4));
          vec3 offset = rgbToYcocg(safe(texture2D(tHistory, prevUv).rgb)) - centre;
          float outside = max(abs(offset.x) / extent.x, max(abs(offset.y) / extent.y, abs(offset.z) / extent.z));
          if (outside > 1.0) offset /= outside;
          current = mix(current, ycocgToRgb(centre + offset), keep / max(outside, 1.0));
        }
      }
      gl_FragColor = vec4(current, 1.0);
    }
  `,
};

const material = (shader) => new THREE.ShaderMaterial({
  uniforms: THREE.UniformsUtils.clone(shader.uniforms),
  vertexShader: shader.vertexShader,
  fragmentShader: shader.fragmentShader,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
});

const halfFloat = (w, h, { depth = false } = {}) => {
  const target = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    depthBuffer: depth,
    stencilBuffer: false,
    depthTexture: depth ? new THREE.DepthTexture(w, h) : null,
  });
  target.texture.generateMipmaps = false;
  return target;
};

/**
 * The passes for one choice, made for the race and disposed with it. `mode` is a real choice
 * other than MSAA: the caller does not make this for MSAA.
 * @param {{ renderer: THREE.WebGLRenderer, mode: string }} env
 */
export function createAntiAlias({ renderer, mode }) {
  const post = aaPost(mode);
  const grade = material(GRADE);
  const copy = material(COPY);
  const quad = new FullScreenQuad(grade);
  const fxaa = post === "fxaa" ? material({ ...FXAAShader, uniforms: FXAAShader.uniforms }) : null;
  if (fxaa) fxaa.uniforms = THREE.UniformsUtils.clone(FXAAShader.uniforms);
  const taa = post === "taa" ? material(TAA) : null;
  const depthCopy = post === "taa" ? material(DEPTH_COPY) : null;
  let smaa = null;
  let width = 0, height = 0, frame = 0, haveHistory = false, slot = 0;
  let flat = null, encoded = null, depthHistory = null;
  const history = [null, null];
  const jitteredInvProj = new THREE.Matrix4();
  const jitteredCamWorld = new THREE.Matrix4();
  const jitteredProj = new THREE.Matrix4();
  const prevVP = new THREE.Matrix4();
  const prevView = new THREE.Matrix4();
  const currentVP = new THREE.Matrix4();
  const currentView = new THREE.Matrix4();
  const prevPos = new THREE.Vector3();
  const prevQuat = new THREE.Quaternion();
  const posePos = new THREE.Vector3();
  const poseQuat = new THREE.Quaternion();
  const drawing = new THREE.Vector2();

  const resize = (target) => { if (target && (target.width !== width || target.height !== height)) target.setSize(width, height); };
  const smaaPass = () => {
    if (!smaa) {
      smaa = new SMAAPass(width, height);
      for (const passMaterial of [smaa.materialEdges, smaa.materialWeights, smaa.materialBlend]) {
        passMaterial.depthTest = false;
        passMaterial.depthWrite = false;
        passMaterial.toneMapped = false;
      }
    }
    smaa.setSize(width, height);
    return smaa;
  };

  return {
    post,
    /** Samples a point of the scene picture: none, for every choice this module draws. */
    samples: (w, h) => aaSamples(mode, w, h),
    /** The picture changed size. Targets already made follow it, and TAA drops the frame it kept. */
    setSize(w, h) {
      w = Math.max(1, Math.round(w));
      h = Math.max(1, Math.round(h));
      if (w === width && h === height) return;
      width = w;
      height = h;
      haveHistory = false;
      resize(flat);
      resize(encoded);
      resize(depthHistory);
      resize(history[0]);
      resize(history[1]);
      smaa?.setSize(w, h);
    },
    /**
     * Shift the camera for this frame when the choice is TAA. Returns the function that puts
     * it back and remembers the two projections. Any other choice returns a function that
     * does nothing.
     */
    begin(camera, w, h) {
      if (post !== "taa") return () => {};
      frame += 1;
      const [jx, jy] = taaJitter(frame);
      const aspect = camera.aspect;
      const view = camera.view ? { ...camera.view } : null;
      // Puts the camera back, once. A second call does nothing, so a thrown draw cannot leave it shifted.
      let open = true;
      const end = () => {
        if (!open) return;
        open = false;
        if (view?.enabled) camera.setViewOffset(view.fullWidth, view.fullHeight, view.offsetX, view.offsetY, view.width, view.height);
        else if (camera.view) camera.view.enabled = false;
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        currentVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        currentView.copy(camera.matrixWorldInverse);
      };
      try {
        camera.setViewOffset(w, h, jx, jy, w, h);
        camera.updateMatrixWorld();
        jitteredProj.copy(camera.projectionMatrix);
        jitteredInvProj.copy(camera.projectionMatrixInverse);
        jitteredCamWorld.copy(camera.matrixWorld);
      } catch (error) {
        end();
        throw error;
      }
      return end;
    },
    /**
     * Blend `source` (light values, a render target) with the frame before, using `depth` from
     * the same draw, and write the steady picture back into `source`. The camera is the one
     * `begin` already put back. The copy kept for the next frame is the picture before the
     * glow is added.
     */
    settle(source, depthTexture, camera) {
      if (post !== "taa") return;
      const w = source.width, h = source.height;
      this.setSize(w, h);
      if (!history[0]) {
        history[0] = halfFloat(w, h);
        history[1] = halfFloat(w, h);
        depthHistory = halfFloat(w, h);
        // A blended distance is not a surface. The colour of the frame before stays filtered.
        depthHistory.texture.minFilter = THREE.NearestFilter;
        depthHistory.texture.magFilter = THREE.NearestFilter;
      }
      camera.updateMatrixWorld();
      const pos = camera.getWorldPosition(posePos);
      const quat = camera.getWorldQuaternion(poseQuat);
      const reset = !haveHistory || aaResets(pos.distanceTo(prevPos), quat.angleTo(prevQuat));
      prevPos.copy(pos);
      prevQuat.copy(quat);
      const read = history[slot];
      const write = history[1 - slot];
      const u = taa.uniforms;
      u.tCurrent.value = source.texture;
      u.tHistory.value = read.texture;
      u.tDepth.value = depthTexture;
      u.tHistoryDepth.value = depthHistory.texture;
      u.uTexel.value.set(1 / w, 1 / h);
      u.uJitteredInvProj.value.copy(jitteredInvProj);
      u.uJitteredCamWorld.value.copy(jitteredCamWorld);
      u.uPrevVP.value.copy(prevVP);
      u.uPrevView.value.copy(prevView);
      u.uKeep.value = reset ? 0 : TAA_HISTORY;
      quad.material = taa;
      renderer.setRenderTarget(write);
      quad.render(renderer);
      copy.uniforms.tDiffuse.value = write.texture;
      quad.material = copy;
      renderer.setRenderTarget(source);
      quad.render(renderer);
      depthCopy.uniforms.tDepth.value = depthTexture;
      depthCopy.uniforms.uProj.value.copy(jitteredProj);
      quad.material = depthCopy;
      renderer.setRenderTarget(depthHistory);
      quad.render(renderer);
      slot = 1 - slot;
      prevVP.copy(currentVP);
      prevView.copy(currentView);
      haveHistory = true;
    },
    /** The byte picture FXAA and SMAA read, `w` by `h`. */
    encoded(w, h) {
      this.setSize(w, h);
      if (!encoded) {
        encoded = new THREE.WebGLRenderTarget(width, height, { depthBuffer: false, stencilBuffer: false });
        encoded.texture.generateMipmaps = false;
      }
      return encoded;
    },
    /** Draw `source` (an encoded picture) to the current target through FXAA or SMAA. */
    filter(source) {
      if (post === "fxaa") {
        fxaa.uniforms.tDiffuse.value = source.texture;
        fxaa.uniforms.resolution.value.set(1 / source.width, 1 / source.height);
        quad.material = fxaa;
        quad.render(renderer);
      } else if (post === "smaa") {
        const pass = smaaPass();
        const dest = renderer.getRenderTarget();
        pass.renderToScreen = dest === null;
        pass.render(renderer, dest, source);
      }
    },
    /**
     * Draw `scene` once a point and present it, for a flat screen with the lens off.
     * `tone` applies the natural-light curve. The fog is mixed in the light values, as it is
     * when the lens draws, and the encoding is this picture's last step.
     */
    renderFlat(scene, camera, { tone = false } = {}) {
      const buf = renderer.getDrawingBufferSize(drawing);
      this.setSize(width || buf.x || 1, height || buf.y || 1);
      if (!flat) flat = halfFloat(width, height, { depth: true });
      const end = this.begin(camera, flat.width, flat.height);
      const before = renderer.getRenderTarget();
      atmosphere.output(true);
      try {
        renderer.setRenderTarget(flat);
        renderer.render(scene, camera);
        end();
        if (post === "taa") this.settle(flat, flat.depthTexture, camera);
        const spatial = post === "fxaa" || post === "smaa";
        grade.uniforms.tDiffuse.value = flat.texture;
        grade.uniforms.uTone.value = tone ? 1 : 0;
        grade.uniforms.uExposure.value = renderer.toneMappingExposure;
        grade.uniforms.uManual.value = spatial ? 1 : 0;
        quad.material = grade;
        renderer.setRenderTarget(spatial ? this.encoded(flat.width, flat.height) : before);
        quad.render(renderer);
        if (spatial) {
          renderer.setRenderTarget(before);
          this.filter(encoded);
        }
      } finally {
        end();
        renderer.setRenderTarget(before);
        atmosphere.output(false);
      }
    },
    dispose() {
      for (const target of [flat, encoded, depthHistory, history[0], history[1]]) {
        target?.depthTexture?.dispose();
        target?.dispose();
      }
      grade.dispose();
      copy.dispose();
      fxaa?.dispose();
      taa?.dispose();
      depthCopy?.dispose();
      smaa?.dispose();
      quad.dispose();
    },
  };
}
