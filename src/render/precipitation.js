/*
  Rain and snow falling through the air around the eye (docs/VISUALS.md, "Rain and snow"; the
  numbers are game/atmosphere.js `PRECIPITATION`).

  Every drop and flake is a place in a box of air that follows the eye, and the graphics card
  works out where each one is: where it started (a random place in the box), plus how far it
  has fallen and blown by now, wrapped back into the box. Nothing is moved by hand each frame,
  so tens of thousands cost what a few did.

  What makes it read as depth rather than a film over the lens:
   - two fields, a near one of particles small and close enough to see one by one and a far
     one of larger, fainter ones that fills the distance, each fading out at its own edge;
   - a streak of rain is as long as the drop travels while the eye would blur it, measured
     against the eye's own motion, so rain leans toward a truck at speed;
   - nothing falls below the ground (read from the ground map) or the water, and where rain
     meets either it leaves a splash;
   - each particle is dimmed by the fog between it and the eye, like everything else.
*/
import * as THREE from "three";
import { ATMOSPHERE_GLSL, atmosphereUniforms } from "./atmosphere.js";

/** The clock the particles run on wraps here, seconds, to keep the arithmetic exact. */
const CLOCK_SECONDS = 512;

const FIELD_PARS = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime, uSize, uLength, uOpacity, uLight, uViewHeight, uFloor;
uniform vec2 uNear;
uniform vec3 uBox, uFall, uEyeVelocity;
uniform sampler2D uGround;
uniform vec4 uGroundAt;
varying vec2 vUv;
varying float vAlpha;
${ATMOSPHERE_GLSL}
// What a falling thing meets under a point, in the scene's axes: the ground, the water, or what stands over the ground
// (a bridge's deck, a tunnel's roof: the map's second number), under which nothing falls.
float groundUnder( vec3 p ) {
  vec2 map = uGroundAt.z > 0.5 ? texture2D( uGround, vec2( p.x, - p.z ) * uGroundAt.y ).rg + uGroundAt.x : vec2( - 1e6 );
  return max( max( map.r, uGroundAt.w > 0.5 ? map.g : - 1e6 ), uFloor );
}
// A particle's place: where it began, moved by \`travel\`, wrapped into the box around the eye.
vec3 placed( vec3 travel ) {
  vec3 p = aSeed.xyz * uBox + travel;
  return mod( p - cameraPosition + 0.5 * uBox, uBox ) - 0.5 * uBox + cameraPosition;
}
// How much of a particle shows: all of it in the middle of the box, none at its edge, close to the eye or behind the fog.
float shown( vec3 p ) {
  vec3 off = p - cameraPosition;
  float dist = length( off );
  float edge = 1.0 - smoothstep( 0.38, 0.5, max( abs( off.x ) / uBox.x, abs( off.z ) / uBox.z ) );
  float fog = mtmFog[ 0 ].x > 0.5 ? exp( - mtmFogDepth( off / max( dist, 1e-4 ), dist ) ) : 1.0;
  return edge * smoothstep( uNear.x, uNear.y, dist ) * fog;
}
// A width no thinner than a pixel at this distance, and how much fainter the particle is for having been widened.
float widened( float width, float dist, out float thinned ) {
  float pixel = dist * 2.0 / ( projectionMatrix[ 1 ][ 1 ] * uViewHeight );
  thinned = min( 1.0, width / max( pixel, 1e-5 ) );
  return max( width, pixel );
}
`;

const RAIN_VERTEX = /* glsl */ `
${FIELD_PARS}
void main() {
  float speed = 0.8 + 0.4 * aSeed.w;
  vec3 p = placed( uFall * ( uTime * speed ) );
  // The streak: the way the drop moves past the eye, for as long as the eye blurs it.
  vec3 past = uFall * speed - uEyeVelocity;
  float pace = length( past );
  vec3 along = past / max( pace, 1e-3 );
  float len = clamp( uLength * pace / max( length( uFall ), 1e-3 ), uLength * 0.6, uLength * 2.4 );
  vec3 toEye = cameraPosition - p;
  float dist = length( toEye );
  float thinned;
  float width = widened( uSize, dist, thinned );
  vec3 across = normalize( cross( along, toEye ) );
  // The quad runs back up the way the drop came.
  vec3 world = p - along * ( len * position.y ) + across * ( width * position.x );
  vUv = vec2( position.x + 0.5, position.y );
  // No two drops catch the light alike: some are barely there.
  vAlpha = uOpacity * thinned * shown( p ) * step( groundUnder( p ), p.y ) * ( 0.35 + 0.65 * fract( aSeed.w * 13.7 ) );
  gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
}`;

const RAIN_FRAGMENT = /* glsl */ `
uniform float uLight;
uniform vec3 uColor;
varying vec2 vUv;
varying float vAlpha;
void main() {
  // Bright at the head, thinning to a tail; soft across.
  float across = 1.0 - abs( vUv.x * 2.0 - 1.0 );
  float along = ( 1.0 - vUv.y ) * ( 1.0 - vUv.y ) * smoothstep( 0.0, 0.06, vUv.y );
  float alpha = vAlpha * across * ( 0.35 + 0.65 * along );
  if ( alpha < 0.004 ) discard;
  gl_FragColor = vec4( uColor * uLight, alpha );
  #include <colorspace_fragment>
}`;

const SNOW_VERTEX = /* glsl */ `
${FIELD_PARS}
void main() {
  float speed = 0.7 + 0.6 * aSeed.w;
  // A flake wanders as it falls: two slow turns of its own.
  float turn = uTime * ( 0.5 + aSeed.w ) + aSeed.x * 37.0;
  vec3 wander = vec3( sin( turn ) + 0.6 * sin( turn * 2.3 + aSeed.z * 11.0 ), 0.0, cos( turn * 0.8 ) + 0.6 * cos( turn * 1.9 + aSeed.y * 13.0 ) ) * 0.9;
  vec3 p = placed( uFall * ( uTime * speed ) + wander );
  float dist = length( p - cameraPosition );
  float thinned;
  float size = widened( uSize * ( 0.6 + 0.8 * fract( aSeed.w * 7.31 ) ), dist, thinned );
  vec4 view = viewMatrix * vec4( p, 1.0 );
  view.xy += position.xy * size;
  vUv = position.xy + 0.5;
  vAlpha = uOpacity * thinned * thinned * shown( p ) * step( groundUnder( p ), p.y );
  gl_Position = projectionMatrix * view;
}`;

const SNOW_FRAGMENT = /* glsl */ `
uniform float uLight;
uniform vec3 uColor;
varying vec2 vUv;
varying float vAlpha;
void main() {
  float r = length( vUv - 0.5 ) * 2.0;
  float alpha = vAlpha * ( 1.0 - smoothstep( 0.35, 1.0, r ) );
  if ( alpha < 0.004 ) discard;
  gl_FragColor = vec4( uColor * uLight, alpha );
  #include <colorspace_fragment>
}`;

const SPLASH_VERTEX = /* glsl */ `
${FIELD_PARS}
uniform float uRate;
varying float vAge;
// A fresh place for each life of a splash.
vec2 scatter( vec2 seed, float life ) {
  return fract( sin( vec2( dot( seed + life * 0.137, vec2( 127.1, 311.7 ) ), dot( seed + life * 0.291, vec2( 269.5, 183.3 ) ) ) ) * 43758.5453 );
}
void main() {
  float clock = uTime * uRate * ( 0.7 + 0.6 * aSeed.w ) + aSeed.z * 9.0;
  float life = floor( clock );
  vAge = clock - life;
  vec2 spot = scatter( aSeed.xy, life ) * uBox.xz;
  vec3 p = vec3( spot.x, 0.0, spot.y );
  p.xz = mod( p.xz - cameraPosition.xz + 0.5 * uBox.xz, uBox.xz ) - 0.5 * uBox.xz + cameraPosition.xz;
  p.y = groundUnder( p ) + 0.08;
  vec3 off = p - cameraPosition;
  float dist = length( off );
  float edge = 1.0 - smoothstep( 0.36, 0.5, max( abs( off.x ) / uBox.x, abs( off.z ) / uBox.z ) );
  // A crown that opens as it fades, facing the eye.
  float size = uSize * ( 0.6 + 0.8 * vAge );
  vec4 view = viewMatrix * vec4( p, 1.0 );
  view.xy += vec2( position.x, position.y + 0.3 ) * size;
  vUv = position.xy + 0.5;
  vAlpha = uOpacity * edge * smoothstep( 2.0, 6.0, dist ) * ( mtmFog[ 0 ].x > 0.5 ? exp( - mtmFogDepth( off / max( dist, 1e-4 ), dist ) ) : 1.0 );
  gl_Position = projectionMatrix * view;
}`;

const SPLASH_FRAGMENT = /* glsl */ `
uniform float uLight;
uniform vec3 uColor;
varying vec2 vUv;
varying float vAlpha, vAge;
void main() {
  // A drop bursting: a soft fleck that leaps and thins. (The rings rain leaves on standing water are the water's own:
  // render/water-surface.js, render/ground-surface.js.)
  vec2 p = ( vUv - 0.5 ) * 2.0;
  float fleck = exp( - ( p.x * p.x * 14.0 + ( p.y - 0.25 * vAge ) * ( p.y - 0.25 * vAge ) * 5.0 ) ) * ( 1.0 - vAge );
  float alpha = vAlpha * ( 1.0 - vAge ) * fleck;
  if ( alpha < 0.004 ) discard;
  gl_FragColor = vec4( uColor * uLight, alpha );
  #include <colorspace_fragment>
}`;

function field({ count, vertexShader, fragmentShader, uniforms, quad, random }) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(quad), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(Float32Array.from({ length: count * 4 }, random), 4));
  geometry.instanceCount = count;
  // Either side: a streak's quad is laid out in the world, and which way it winds depends on where the eye is.
  const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  // The particles are placed by the shader around whichever eye is drawing.
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.userData.count = count;
  return mesh;
}

/** Corners of a quad a streak hangs from (x across, y along it) and of one centred on its place. */
const STREAK_QUAD = [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0];
const CENTRED_QUAD = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0];

/**
 * @param {{ kind: "rain"|"snow", spec: object, ground?: { texture: THREE.Texture, referenceFt: number }|null, random?: () => number }} options
 *   `spec` is game/atmosphere.js `PRECIPITATION[kind]`; `ground` the ground map as a texture
 *   (render/ground-textures.js), without which nothing stops the fall but the water.
 */
export function createPrecipitation({ kind, spec, ground = null, random = Math.random }) {
  const root = new THREE.Group();
  root.name = `precipitation-${kind}`;
  const shared = {
    ...atmosphereUniforms(),
    uTime: { value: 0 }, uLight: { value: 1 }, uViewHeight: { value: 900 }, uFloor: { value: -1e6 },
    uFall: { value: new THREE.Vector3() }, uEyeVelocity: { value: new THREE.Vector3() },
    uGround: { value: ground?.texture ?? null }, uGroundAt: { value: new THREE.Vector4(ground?.referenceFt ?? 0, 1 / 8192, ground ? 1 : 0, ground?.hasCover ? 1 : 0) },
    uColor: { value: kind === "rain" ? new THREE.Color(0.74, 0.8, 0.88) : new THREE.Color(0.96, 0.97, 1) },
    // How near the eye a particle begins to show, and where it shows in full, feet: a flake a foot from the lens would fill the view.
    uNear: { value: kind === "rain" ? new THREE.Vector2(3, 10) : new THREE.Vector2(2.5, 11) },
  };
  const layers = [spec.near, spec.far].map((layer) => {
    const uniforms = {
      ...shared, uBox: { value: new THREE.Vector3(layer.boxFt, layer.heightFt, layer.boxFt) },
      uSize: { value: layer.sizeFt }, uLength: { value: layer.lengthFt }, uOpacity: { value: layer.opacity },
    };
    const mesh = field(kind === "rain"
      ? { count: layer.count, vertexShader: RAIN_VERTEX, fragmentShader: RAIN_FRAGMENT, uniforms, quad: STREAK_QUAD, random }
      : { count: layer.count, vertexShader: SNOW_VERTEX, fragmentShader: SNOW_FRAGMENT, uniforms, quad: CENTRED_QUAD, random });
    mesh.userData.opacity = layer.opacity;
    root.add(mesh);
    return mesh;
  });
  let splashes = null;
  if (spec.splashes > 0) {
    splashes = field({
      count: spec.splashes, vertexShader: SPLASH_VERTEX, fragmentShader: SPLASH_FRAGMENT, quad: CENTRED_QUAD, random,
      uniforms: {
        ...shared, uBox: { value: new THREE.Vector3(spec.splashBoxFt, 1, spec.splashBoxFt) },
        uSize: { value: 0.55 }, uLength: { value: 0 }, uOpacity: { value: 0.45 }, uRate: { value: 3.2 },
      },
    });
    splashes.userData.opacity = 0.45;
    root.add(splashes);
  }
  root.visible = false;

  const previous = new THREE.Vector3(), velocity = new THREE.Vector3(), step = new THREE.Vector3();
  let seen = false;
  return {
    object: root,
    /**
     * Once a frame. `amount` 0 to 1 is how hard it falls (it fades in and out); `light` the
     * weather's brightness; `floorFt` the water's level or null; `viewHeight` the picture's
     * height in pixels.
     */
    update(dt, { camera, amount = 1, light = 1, floorFt = null, viewHeight = 900 }) {
      root.visible = amount > 0.01;
      if (!root.visible) { seen = false; return; }
      shared.uTime.value = (shared.uTime.value + dt) % CLOCK_SECONDS;
      // Rain is seen by the sky's light it bends toward the eye, which a storm's gloom dims less than it dims the ground.
      shared.uLight.value = kind === "rain" ? Math.max(light, 0.85) : light;
      shared.uViewHeight.value = viewHeight;
      shared.uFloor.value = floorFt ?? -1e6;
      // The scene mirrors z: the wind's z turns with it.
      shared.uFall.value.set(spec.windFtPerS[0], -spec.fallFtPerS, -spec.windFtPerS[1]);
      // The eye's own velocity, eased, and none across a cut from one place to another.
      if (seen && dt > 1e-4) {
        step.copy(camera.position).sub(previous).divideScalar(dt);
        if (step.length() > 400) step.set(0, 0, 0);
        velocity.lerp(step, 1 - Math.exp(-dt * 8));
      } else velocity.set(0, 0, 0);
      previous.copy(camera.position);
      seen = true;
      shared.uEyeVelocity.value.copy(velocity);
      for (const mesh of [...layers, splashes]) {
        if (!mesh) continue;
        mesh.material.uniforms.uOpacity.value = mesh.userData.opacity * Math.min(1, amount * 1.5);
        mesh.geometry.instanceCount = Math.round(mesh.userData.count * Math.min(1, amount));
      }
    },
    dispose() {
      for (const mesh of [...layers, splashes]) { mesh?.geometry.dispose(); mesh?.material.dispose(); }
      root.removeFromParent();
    },
  };
}
