/*
  Ripples and wakes on the water and in the puddles (docs/VISUALS.md, "Ripples and wakes"; the
  numbers are game/water.js `WATER_RIPPLES`), for "Reflective water" and "Rain puddles".

  A field of waves round the eye, run on the graphics card: a picture of half floats, a point
  every few inches, holding the surface's height there now and a step ago, and its foam. Each
  step every point moves by the wave equation, with the waves' speed taken from how deep the
  water is there: the level's water over the map of the ground under it
  (render/ground-textures.js), or a puddle's over the puddle map, whichever is deeper. So they
  slow in the shallows and are thrown back from the shore and a puddle's edge. A wheel at the
  surface holds the water down about it, and a wheel that strikes it pushes it down at once; the
  waves run out from both. The level's water and the puddles share the one field: the water's
  shader and the ground's read it.

  The field stays round the eye: as the eye moves it is shifted by whole points, and what comes
  into it from outside is calm. Toward its edges the waves die away, so nothing is thrown back
  from them. It is stepped before each frame is drawn, by as much time as the frame's wheels
  were stirred for (none while a race is paused), and in a headset as on the flat screen,
  outside the headset's own drawing.
*/
import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { PUDDLE_RANGE_FT, PUDDLE_WATERLINE, puddleDepthAt } from "../game/ground-maps.js";
import { WATER_RIPPLES, landingStir, puddleStir, wheelStir } from "../game/water.js";

const { windowTexels: SIDE, texelFt: TEXEL_FT, stepS: STEP_S, mostSteps: MOST_STEPS, fastestFtPerS, calmS, foamHalfLifeS, stirs: STIRS } = WATER_RIPPLES;
const glsl = (n) => n.toFixed(5);
/** A wheel is on the ground, for a puddle, when its tire's foot is within this of it, feet. */
const ON_GROUND_FT = 0.5;

const STEP = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D uField, uGround, uPuddles;
    // the window's corner (the map's x and z, feet), how far it moved since the last step (points)
    uniform vec4 uWindow;
    // the ground map's reference height, 1 / the world's size, the water's level against the reference, and whether there
    // is water with a map under it (1), water without one (2), or none (0)
    uniform vec4 uGroundAt;
    // whether there are puddles, and how far under its full level a puddle's surface lies now (feet)
    uniform vec2 uPuddleAt;
    // each wheel: where (the map's x and z, feet), how far about it, how deep it holds the water down; and its foam and whether it struck
    uniform vec4 uStir[ ${STIRS} ];
    uniform vec2 uStirMore[ ${STIRS} ];
    uniform int uStirs;
    varying vec2 vUv;
    // The field as it was, at a point of the window as it is now; calm outside what it held.
    vec4 was( vec2 uv ) {
      vec2 from = uv + uWindow.zw / ${SIDE.toFixed(1)};
      if ( any( lessThan( from, vec2( 0.0 ) ) ) || any( greaterThan( from, vec2( 1.0 ) ) ) ) return vec4( 0.0 );
      return texture2D( uField, from );
    }
    void main() {
      vec2 texel = vec2( 1.0 / ${SIDE.toFixed(1)} );
      vec4 here = was( vUv );
      float h = here.r, before = here.g, foam = here.b;
      float around = was( vUv + vec2( texel.x, 0.0 ) ).r + was( vUv - vec2( texel.x, 0.0 ) ).r + was( vUv + vec2( 0.0, texel.y ) ).r + was( vUv - vec2( 0.0, texel.y ) ).r;
      vec2 at = uWindow.xy + vUv * ${(SIDE * TEXEL_FT).toFixed(2)};
      // How deep the water is here, the level's or a puddle's, the deeper; and so how fast its waves run (game/water.js \`waveSpeed\`).
      float depth = uGroundAt.w > 1.5 ? 8.0 : uGroundAt.w > 0.5 ? uGroundAt.z - texture2D( uGround, at * uGroundAt.y ).r : - 1.0;
      if ( uPuddleAt.x > 0.5 ) depth = max( depth, ( texture2D( uPuddles, at / 8192.0 ).r * 255.0 - ${PUDDLE_WATERLINE.toFixed(1)} ) / 127.0 * ${glsl(PUDDLE_RANGE_FT)} - uPuddleAt.y );
      float speed = min( ${glsl(fastestFtPerS)}, sqrt( 32.17 * max( depth, 0.0 ) ) );
      float courant = speed * ${glsl(STEP_S / TEXEL_FT)};
      float next = 2.0 * h - before + courant * courant * ( around - 4.0 * h );
      next *= ${glsl(Math.exp(-STEP_S / calmS))};
      // The wheels: one at the surface holds it down about itself; one that struck pushes it down at once.
      for ( int i = 0; i < ${STIRS}; i ++ ) {
        if ( i >= uStirs ) break;
        vec4 stir = uStir[ i ];
        vec2 off = at - stir.xy;
        float reach = exp( - dot( off, off ) / ( stir.z * stir.z ) * 2.0 );
        if ( uStirMore[ i ].y > 0.5 ) next -= stir.w * reach;
        else next = mix( next, - stir.w * reach, reach * 0.6 );
        foam += uStirMore[ i ].x * reach * ${glsl(STEP_S * 6)};
      }
      // Foam thins away, and spreads a little.
      foam = mix( foam, ( was( vUv + vec2( texel.x, 0.0 ) ).b + was( vUv - vec2( texel.x, 0.0 ) ).b + was( vUv + vec2( 0.0, texel.y ) ).b + was( vUv - vec2( 0.0, texel.y ) ).b ) * 0.25, 0.08 );
      foam = clamp( foam * ${glsl(Math.pow(0.5, STEP_S / foamHalfLifeS))}, 0.0, 1.0 );
      // The shore and a puddle's edge throw the waves back; toward the window's edges they die away.
      if ( depth <= 0.01 ) { next = 0.0; foam *= 0.9; }
      vec2 edge = min( vUv, 1.0 - vUv );
      next *= smoothstep( 0.0, 0.08, min( edge.x, edge.y ) );
      gl_FragColor = vec4( clamp( next, - 3.0, 3.0 ), h, foam, 1.0 );
    }`,
};

/**
 * @param {{ renderer: THREE.WebGLRenderer, groundTexture?: { texture: THREE.Texture, referenceFt: number }|null, levelFt?: number|null,
 *   puddles?: { depth: Uint8Array, side: number }|null, puddleTexture?: THREE.Texture|null, ground?: (x: number, z: number) => number }} env
 *   `levelFt` the level's water's resting level, or null for none, and `groundTexture` the map
 *   of the ground under it; `puddles` the puddle map (game/ground-maps.js) and `puddleTexture`
 *   the same as a texture, or null for none; `ground` the drawn ground's height, game feet,
 *   which says whether a wheel stands in a puddle.
 */
export function createWaterRipples({ renderer, groundTexture = null, levelFt = null, puddles = null, puddleTexture = null, ground = null }) {
  const target = () => new THREE.WebGLRenderTarget(SIDE, SIDE, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
  });
  let read = target(), write = target();
  const lake = levelFt !== null && levelFt !== undefined, lakeKind = lake ? (groundTexture ? 1 : 2) : 0;
  const uniforms = {
    uField: { value: read.texture }, uGround: { value: groundTexture?.texture ?? null }, uPuddles: { value: puddleTexture },
    uWindow: { value: new THREE.Vector4() },
    uGroundAt: { value: new THREE.Vector4(groundTexture?.referenceFt ?? 0, 1 / 8192, 0, lakeKind) },
    uPuddleAt: { value: new THREE.Vector2() },
    uStir: { value: Array.from({ length: STIRS }, () => new THREE.Vector4()) },
    uStirMore: { value: Array.from({ length: STIRS }, () => new THREE.Vector2()) },
    uStirs: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({ ...STEP, uniforms, depthTest: false, depthWrite: false });
  const quad = new FullScreenQuad(material);
  /** What the shaders that read the field are given: the field, and where it lies (its corner on the map, feet; 1 / its width; whether it runs). */
  const shared = { uRipples: { value: read.texture }, uRippleAt: { value: new THREE.Vector4() } };
  /** The window's corner, in whole points of the field, or null while the field is calm and not running. */
  let corner = null, clock = 0, time = 0, stirredFor = 0;
  /** Where each wheel was a frame ago, by truck and wheel, for how fast it moves and whether it has just come down into the water. */
  const before = new Map();
  let stirs = [], levelNow = levelFt ?? 0, frozen = false, puddleDrop = null;
  const black = new THREE.Color(0, 0, 0), kept = new THREE.Color();

  function stepOnce() {
    // Drawn outside a headset's own drawing, which would otherwise draw it once for each eye.
    const was = renderer.getRenderTarget(), xr = renderer.xr.enabled;
    renderer.xr.enabled = false;
    uniforms.uField.value = read.texture;
    renderer.setRenderTarget(write);
    quad.render(renderer);
    renderer.setRenderTarget(was);
    renderer.xr.enabled = xr;
    [read, write] = [write, read];
    uniforms.uWindow.value.z = uniforms.uWindow.value.w = 0;
  }
  /** Whether there is water for the field to run on now: the level's, not frozen, or puddles. */
  const running = () => (lake && !frozen) || puddleDrop !== null;

  return {
    /** For the shaders that read the field: `uRipples` (red the surface's height, feet; blue its foam) and `uRippleAt`. */
    uniforms: shared,
    /** The level's water now: its level (the bob and all), and whether it is ice (Snow), on which nothing moves. */
    lake(level, isFrozen = false) { levelNow = level ?? levelNow; frozen = !!isFrozen; },
    /** The puddles now: how far under its full level a puddle's surface lies (feet), or null where there are none to stir. */
    puddles(dropFt) { puddleDrop = puddles && puddleTexture && dropFt !== null && dropFt !== undefined ? dropFt : null; },
    /**
     * This frame's wheels, for `dt` seconds (none while a race is paused): `trucks[i]` is
     * `{ hubs: [[x, y, z], ...], radiusFt }`, game feet, or null.
     */
    stir(trucks, dt) {
      stirs = [];
      stirredFor += Math.max(0, dt);
      trucks.forEach((truck, i) => {
        if (!truck?.hubs) return;
        truck.hubs.forEach((hub, k) => {
          const key = i * 8 + k, last = before.get(key);
          before.set(key, hub.slice());
          if (!last || !(dt > 0) || !running()) return;
          const vx = (hub[0] - last[0]) / dt, vy = (hub[1] - last[1]) / dt, vz = (hub[2] - last[2]) / dt, speed = Math.hypot(vx, vz);
          if (speed > 400) return;
          const radiusFt = truck.radiusFt ?? 2.75;
          if (lake && !frozen) {
            // Coming down into the water this frame: a ring from where it struck.
            const struck = last[1] - radiusFt > levelNow && hub[1] - radiusFt <= levelNow ? landingStir(-vy) : null;
            if (struck) stirs.push({ x: hub[0], z: hub[2], ...struck, struck: true });
            const held = wheelStir({ hubFt: hub[1], radiusFt, levelFt: levelNow, speedFtS: speed });
            if (held.depthFt > 0.01) { stirs.push({ x: hub[0], z: hub[2], ...held, struck: false }); return; }
          }
          // A wheel on the ground in a puddle.
          if (puddleDrop !== null && ground) {
            const deep = puddleDepthAt(puddles, hub[0], hub[2]) - puddleDrop;
            if (deep <= 0.01 || hub[1] - radiusFt - ground(hub[0], hub[2]) > ON_GROUND_FT) return;
            const stirred = puddleStir({ depthFt: deep, speedFtS: speed });
            if (stirred.depthFt > 0.005) stirs.push({ x: hub[0], z: hub[2], ...stirred, struck: false });
          }
        });
      });
      stirs = stirs.slice(0, STIRS);
    },
    /** Before a frame is drawn: `eye` the eye's place, game feet. Steps the field by the time its wheels were stirred for. */
    step(eye) {
      const dt = stirredFor;
      stirredFor = 0;
      if (!running()) { corner = null; shared.uRippleAt.value.w = 0; return; }
      // The window about the eye, in whole points, and how far it moved.
      const cx = Math.round(eye[0] / TEXEL_FT) - SIDE / 2, cz = Math.round(eye[2] / TEXEL_FT) - SIDE / 2;
      if (!corner) {
        // A field that starts is calm.
        corner = [cx, cz];
        const was = renderer.getRenderTarget(), alpha = renderer.getClearAlpha();
        renderer.getClearColor(kept);
        renderer.setClearColor(black, 0);
        for (const t of [read, write]) { renderer.setRenderTarget(t); renderer.clear(true, false, false); }
        renderer.setClearColor(kept, alpha);
        renderer.setRenderTarget(was);
      }
      uniforms.uWindow.value.set(cx * TEXEL_FT, cz * TEXEL_FT, cx - corner[0], cz - corner[1]);
      corner = [cx, cz];
      uniforms.uGroundAt.value.z = levelNow - (groundTexture?.referenceFt ?? 0);
      uniforms.uGroundAt.value.w = frozen ? 0 : lakeKind;
      uniforms.uPuddleAt.value.set(puddleDrop !== null ? 1 : 0, puddleDrop ?? 0);
      time += dt;
      uniforms.uStirs.value = stirs.length;
      stirs.forEach((s, i) => {
        // A wheel churns as it goes, so it sends out a train of waves and not one.
        const churn = s.struck ? 1 : 1 + 0.45 * Math.sin(time * 2 * Math.PI * 2.5 + i * 1.3);
        uniforms.uStir.value[i].set(s.x, s.z, s.radiusFt, s.depthFt * churn);
        uniforms.uStirMore.value[i].set(s.foam, s.struck ? 1 : 0);
      });
      clock += Math.min(dt, STEP_S * MOST_STEPS);
      let steps = 0;
      while (clock >= STEP_S && steps < MOST_STEPS) {
        stepOnce();
        // A wheel that struck strikes once.
        if (steps === 0) stirs.forEach((s, i) => { if (s.struck) uniforms.uStir.value[i].w = 0; });
        clock -= STEP_S;
        steps++;
      }
      shared.uRipples.value = read.texture;
      shared.uRippleAt.value.set(cx * TEXEL_FT, cz * TEXEL_FT, 1 / (SIDE * TEXEL_FT), 1);
    },
    dispose() {
      read.dispose();
      write.dispose();
      material.dispose();
      quad.dispose();
    },
  };
}
