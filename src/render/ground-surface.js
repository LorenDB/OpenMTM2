/*
  The ground in the weather (docs/VISUALS.md, "Rain" and "Snow"): wet and puddled in Rain,
  under snow in Snow. Both are drawn by the terrain's own material, which is given a few more
  lines of shader, so the ground keeps its textures, its light and its shadows.

  Rain ("Rain puddles"). The ground darkens as it gets wet and takes a sheen at a low angle.
  Water stands where the puddle map says the ground has a low point (game/ground-maps.js): the
  map holds how far each place lies under or over its pool's surface, so the waterline falls
  where it should between samples, and a little noise frays it. A puddle shows the wet ground
  under it from above and the sky at a low angle, as water does, ruffled by the rain.

  Snow ("Snow cover"). Snow has a depth (game/snow-cover.js): deep on level ground, thinning
  as the ground steepens, thin along the course. In a race that begins in Snow the terrain's
  mesh carries that depth on every vertex and the ground is lifted by it as the snow settles
  (game/atmosphere.js), so the snow has thickness: a truck's tires sink into it off the course,
  and the road runs between its banks. How white the ground is follows the same depth: a thin
  fall lets the ground show through in patches, a deep one hides it. Snow that comes on during
  a race (GOLD mode) has no depth in the mesh and lies flat, by the ground's slope alone; so
  does the snow on the tops of ground boxes, kept thin where the course runs over them.

  Where the snow ends. The depth is known at the mesh's points, and between them it runs in
  straight lines, so a snow line drawn where the depth reaches nothing would follow the mesh's
  cells. How deep snow must lie before it shows varies from place to place instead
  (game/snow-cover.js `SNOW_LINE`), by noise that knows nothing of the mesh: the line wanders
  across the band where the snow thins, leaves islands ahead of itself and bare patches behind,
  and its edge is frayed. The ground just clear of it is damp and darker. The snow itself has
  hollows and wind-packed ridges, lit by the sun where there is one, and close to the eye its
  crystals glint.
*/
import * as THREE from "three";
import { SNOW_START, WET, groundWetness, puddlesFilled, snowDown } from "../game/atmosphere.js";
import { PUDDLE_RANGE_FT, PUDDLE_WATERLINE, puddleDepthAt } from "../game/ground-maps.js";
import { SNOW_BARE_SLOPE, SNOW_DEPTH_SCALE_FT, SNOW_HOLD_SLOPE, SNOW_LINE, SNOW_MAX_FT } from "../game/snow-cover.js";
import { PUDDLE_FILL_DROP_FT, WATER_RIPPLES } from "../game/water.js";
import { WEATHER_LOOK } from "../game/weather.js";
import { SHARED_NOISE_GLSL, sharedNoiseUniforms } from "./noise-textures.js";
import { addShaderHook } from "./shader-hooks.js";

const RAIN = 4, SNOW = 5;
/** When the weather turns, the ground dries and the snow goes over this long, seconds. */
const DRY_SECONDS = 45, MELT_SECONDS = 12;
/** A puddle not yet full stands this far below its full level, feet. */
const FILL_DROP_FT = PUDDLE_FILL_DROP_FT;
const glsl = (n) => n.toFixed(5);

const VERTEX_PARS = /* glsl */ `
varying vec3 vGfxWorld;
varying vec3 vGfxUp;
#ifdef GFX_SNOW_VOLUME
  attribute float snowDepth;
  uniform vec4 uGfx;
  varying float vGfxSnow;
#endif
#ifdef GFX_SNOW_SHARE
  // how much of the open ground's snow lies here: a ground box's top along the course is as thin as the road
  attribute float snowShare;
  varying float vGfxShare;
#endif
`;
/* The snow's depth lifts the ground, by as much of it as is down. */
const VERTEX_LIFT = /* glsl */ `
#ifdef GFX_SNOW_VOLUME
  vGfxSnow = snowDepth * ${glsl(SNOW_DEPTH_SCALE_FT)};
  transformed.y += vGfxSnow * uGfx.z;
#endif
`;
const VERTEX = "\tvGfxWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n\tvGfxUp = normalize( mat3( modelMatrix ) * normal );\n#ifdef GFX_SNOW_SHARE\n\tvGfxShare = snowShare;\n#endif";

/*
  Where water stands, for the ground and for what lies on it (render/tire-tracks.js), which take the same uniforms
  (`pools.uniforms`).
*/
const POOL_GLSL = /* glsl */ `
// wet 0 to 1, puddles filled 0 to 1, snow down 0 to 1, seconds
uniform vec4 uGfx;
uniform sampler2D uGfxPuddles;
// The noises the rest of the ground reads too, in the samplers they share (render/noise-textures.js).
${SHARED_NOISE_GLSL}
#ifndef uGfxNoise
#define uGfxNoise mtmCloudNoise
#endif
uniform float uGfxPuddleSide;
// The puddle map read through a cubic kernel (four smoothed reads): between its samples, 8 ft apart, a straight
// blend would give every small puddle the corners of the samples' grid.
float gfxPuddleDepth( vec2 uv ) {
  vec2 st = uv * uGfxPuddleSide - 0.5;
  vec2 f = fract( st ), cell = floor( st );
  vec2 w0 = ( 1.0 - f ) * ( 1.0 - f ) * ( 1.0 - f ) / 6.0, w3 = f * f * f / 6.0;
  vec2 w1 = ( 3.0 * f * f * f - 6.0 * f * f + 4.0 ) / 6.0, w2 = 1.0 - w0 - w1 - w3;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 a = ( cell + w1 / g0 - 0.5 ) / uGfxPuddleSide, b = ( cell + w3 / g1 + 1.5 ) / uGfxPuddleSide;
  return g0.y * ( g0.x * texture2D( uGfxPuddles, a ).r + g1.x * texture2D( uGfxPuddles, vec2( b.x, a.y ) ).r )
    + g1.y * ( g0.x * texture2D( uGfxPuddles, vec2( a.x, b.y ) ).r + g1.x * texture2D( uGfxPuddles, b ).r );
}
// The water standing at game (x, z) \`at\` now: x how much of the point a puddle covers (0 to 1), y how deep it is
// there (feet). The map's waterline, lower while the puddles are filling, frayed by a little noise.
vec2 gfxPoolAt( vec2 at ) {
  if ( uGfx.y <= 0.0 ) return vec2( 0.0 );
  float line = ${glsl(PUDDLE_WATERLINE / 255)} + ( 1.0 - uGfx.y ) * ${glsl((FILL_DROP_FT / PUDDLE_RANGE_FT) * (127 / 255))}
    + ( texture2D( uGfxNoise, at / 41.0 ).b - 0.5 ) * 0.03 + ( texture2D( uGfxNoise, at / 9.0 ).a - 0.5 ) * 0.02 - 0.012;
  float depth = gfxPuddleDepth( at / 8192.0 );
  return vec2( smoothstep( line - 0.003, line + 0.01, depth ), max( depth - line, 0.0 ) * ${glsl((255 / 127) * PUDDLE_RANGE_FT)} );
}
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec3 vGfxWorld;
varying vec3 vGfxUp;
#ifdef GFX_SNOW_VOLUME
  varying float vGfxSnow;
#endif
#ifdef GFX_SNOW_SHARE
  varying float vGfxShare;
#endif
${POOL_GLSL}
uniform float uGfxLight;
uniform vec3 uGfxSky, uGfxHorizon;
#define uGfxRelief mtmDetailNoise
#ifdef GFX_SHELTER
  // where the ground lies under cover (a bridge, a tunnel): neither rain nor snow falls there
  uniform sampler2D uGfxShelter;
#endif
#ifdef GFX_RIPPLES
  // the waves the trucks stir (render/water-ripples.js): the field, its corner on the map (feet), 1 / its width, whether it runs
  uniform sampler2D uRipples;
  uniform vec4 uRippleAt;
#endif
// the way to the sun (scene axes), and how much of the light is the sun's own
uniform vec4 uGfxSun;
`;

/* After the texture is read: what the weather does to the ground's own colour. */
const ALBEDO = /* glsl */ `
  vec2 gfxAt = vec2( vGfxWorld.x, - vGfxWorld.z );
  vec4 gfxGrain = texture2D( uGfxNoise, gfxAt / 41.0 );
  vec4 gfxPatch = texture2D( uGfxNoise, gfxAt / 430.0 );
  float gfxLevel = smoothstep( 0.8, 0.96, vGfxUp.y );
  // How open to the sky the ground is here: all of it, but under a bridge or in a tunnel.
  float gfxOpen = 1.0;
  #ifdef GFX_SHELTER
    gfxOpen = 1.0 - texture2D( uGfxShelter, gfxAt / 8192.0 ).r;
  #endif
  float gfxWet = uGfx.x * gfxOpen, gfxPool = 0.0, gfxSnow = 0.0;
  #ifdef GFX_POOLS
    gfxPool = gfxPoolAt( gfxAt ).x * gfxLevel * gfxOpen;
  #endif
  // Wet ground is darker and its colours deeper, and what it is made of is as plain to see as when it was dry; under
  // standing water it is darker still.
  float gfxGrey = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  diffuseColor.rgb = max( mix( vec3( gfxGrey ), diffuseColor.rgb, 1.0 + ${glsl(WET.deeper)} * gfxWet ), 0.0 ) * mix( 1.0, ${glsl(WET.darker)}, gfxWet );
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.42, 0.45, 0.48 ), gfxPool );
  if ( uGfx.z > 0.0 ) {
    #ifdef GFX_SNOW_VOLUME
      // How deep the snow lies here now, feet: the mesh has its settled depth.
      float gfxDeep = vGfxSnow * uGfx.z * gfxOpen;
    #else
      // No depth in the mesh: what ground of this slope would hold, drifting from place to place.
      float gfxSlope = sqrt( max( 1.0 - vGfxUp.y * vGfxUp.y, 0.0 ) ) / max( vGfxUp.y, 0.05 );
      float gfxDeep = ${glsl(SNOW_MAX_FT)} * ( 1.0 - smoothstep( ${glsl(SNOW_HOLD_SLOPE)}, ${glsl(SNOW_BARE_SLOPE)}, gfxSlope ) ) * ( 0.72 + 0.28 * ( gfxPatch.r * 2.0 - 1.0 ) ) * uGfx.z * gfxOpen;
      #ifdef GFX_SNOW_SHARE
        gfxDeep *= vGfxShare;
      #endif
    #endif
    // The snow line: how deep the snow must lie before it shows wanders from place to place, by noise that knows nothing
    // of the mesh the depth came from, and its edge is frayed.
    float gfxNeed = mix( ${glsl(SNOW_LINE.showsFromFt)}, ${glsl(SNOW_LINE.showsToFt)}, smoothstep( 0.3, 0.7, texture2D( uGfxNoise, gfxAt / ${glsl(SNOW_LINE.wanderFt)} ).r * 0.55 + gfxPatch.g * 0.2 + gfxGrain.b * 0.25 ) );
    // Taken against the snow's depth once it has all settled, so the line stays where it is while the snow deepens;
    // only the first tenth of a fall creeps out from where it will lie deepest.
    float gfxFray = texture2D( uGfxNoise, gfxAt / ${glsl(SNOW_LINE.frayFt)} ).b;
    float gfxOver = gfxDeep / max( uGfx.z, ${glsl(SNOW_LINE.creepsUntil)} ) - gfxNeed + ( gfxFray - 0.5 ) * ${glsl(SNOW_LINE.frayDepthFt)};
    // Snow does not end at a line. Short of showing in full it lies thin: first as specks in the ground's hollows,
    // then as a broken sheet the ground shows through, then whole.
    float gfxThin = smoothstep( - ${glsl(SNOW_LINE.softDepthFt)}, ${glsl(SNOW_LINE.softDepthFt * 0.4)}, gfxOver );
    float gfxSpeck = smoothstep( 0.3, 0.7, gfxGrain.a * 0.6 + gfxFray * 0.4 + ( gfxThin - 0.5 ) * 1.1 );
    gfxSnow = gfxThin * mix( gfxSpeck, 1.0, gfxThin * gfxThin );
    // The ground just clear of the snow is damp from it.
    diffuseColor.rgb *= 1.0 - ${glsl(SNOW_LINE.damp)} * smoothstep( - ${glsl(SNOW_LINE.dampDepthFt)}, 0.0, gfxOver ) * ( 1.0 - gfxSnow );
    // Its surface: hollows and wind-packed ridges, a shade bluer in the hollows, and lit by the sun where there is one.
    vec4 gfxDrift = texture2D( uGfxRelief, gfxAt / 37.0 ), gfxRipple = texture2D( uGfxRelief, gfxAt / 6.1 );
    float gfxHigh = gfxDrift.r * 0.65 + gfxRipple.r * 0.35;
    float gfxLit = - dot( ( gfxDrift.gb - 0.5 ) * 0.7 + ( gfxRipple.gb - 0.5 ) * 0.5, vec2( uGfxSun.x, - uGfxSun.z ) ) * uGfxSun.w;
    // Deep snow is a clean white; thin snow is greyed by what lies under it.
    vec3 gfxWhite = mix( vec3( 0.74, 0.78, 0.85 ), vec3( 0.9, 0.93, 0.97 ), smoothstep( 0.0, 0.35, gfxOver ) );
    gfxWhite *= mix( vec3( 0.84, 0.89, 0.97 ), vec3( 1.03 ), gfxHigh ) * ( 1.0 + gfxLit );
    diffuseColor.rgb = mix( diffuseColor.rgb, gfxWhite, gfxSnow );
  }
`;

/* After the light is worked out: what water on the ground shows of the sky. */
const SHINE = /* glsl */ `
  if ( gfxWet > 0.0 ) {
    vec3 gfxEye = normalize( cameraPosition - vGfxWorld );
    // Rain on standing water: its surface is never still.
    vec2 gfxRuffle = ( texture2D( uGfxNoise, gfxAt / 4.3 + uGfx.w * vec2( 0.37, 0.19 ) ).rg - 0.5 )
      + ( texture2D( uGfxNoise, gfxAt / 1.9 - uGfx.w * vec2( 0.23, 0.43 ) ).ba - 0.5 );
    vec3 gfxFace = normalize( vec3( gfxRuffle.x * 0.16, 1.0, gfxRuffle.y * 0.16 ) );
    // In a puddle, the wakes and rings the trucks stir, and the water they churn.
    float gfxChurned = 0.0;
    #ifdef GFX_RIPPLES
      vec2 gfxRippleUv = ( gfxAt - uRippleAt.xy ) * uRippleAt.z;
      if ( gfxPool > 0.0 && uRippleAt.w > 0.5 && all( greaterThan( gfxRippleUv, vec2( 0.0 ) ) ) && all( lessThan( gfxRippleUv, vec2( 1.0 ) ) ) ) {
        vec2 gfxTexel = vec2( ${(1 / WATER_RIPPLES.windowTexels).toFixed(6)}, 0.0 );
        vec2 gfxSlope = vec2(
          texture2D( uRipples, gfxRippleUv + gfxTexel.xy ).r - texture2D( uRipples, gfxRippleUv - gfxTexel.xy ).r,
          texture2D( uRipples, gfxRippleUv + gfxTexel.yx ).r - texture2D( uRipples, gfxRippleUv - gfxTexel.yx ).r ) / ${(2 * WATER_RIPPLES.texelFt).toFixed(3)};
        vec2 gfxRippleEdge = min( gfxRippleUv, 1.0 - gfxRippleUv );
        float gfxRippleShown = smoothstep( 0.0, 0.1, min( gfxRippleEdge.x, gfxRippleEdge.y ) );
        // The scene mirrors z, so a slope along the map's second axis leans the other way.
        gfxFace = normalize( gfxFace + vec3( - gfxSlope.x, 0.0, gfxSlope.y ) * ( 4.0 * gfxRippleShown ) );
        gfxChurned = texture2D( uRipples, gfxRippleUv ).b * gfxRippleShown;
      }
    #endif
    float gfxGlance = pow( clamp( 1.0 - dot( gfxEye, gfxFace ), 0.0, 1.0 ), 5.0 );
    vec3 gfxBack = reflect( - gfxEye, gfxFace );
    vec3 gfxSkyShown = mix( uGfxHorizon, uGfxSky, smoothstep( 0.0, 0.55, gfxBack.y ) ) * uGfxLight;
    gl_FragColor.rgb = mix( gl_FragColor.rgb, gfxSkyShown, gfxPool * clamp( 0.1 + 1.5 * gfxGlance, 0.0, 1.0 ) );
    // Churned puddle water is stirred up: the silt under it clouds it, paler and browner, in swirls that settle, with
    // a little froth at their heart.
    float gfxSwirl = 0.3 + 1.4 * texture2D( uGfxNoise, gfxAt / 9.0 + uGfx.w * 0.01 ).a;
    float gfxSilt = smoothstep( 0.02, 0.3, gfxChurned * gfxSwirl );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, gl_FragColor.rgb * vec3( 1.5, 1.4, 1.25 ) + vec3( 0.05, 0.04, 0.025 ) * uGfxLight, gfxPool * gfxSilt * 0.8 );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( 0.62, 0.6, 0.55 ) * uGfxLight, gfxPool * smoothstep( 0.35, 0.7, gfxChurned * gfxSwirl ) * 0.5 );
    // Wet ground that holds no pool has a film of water on it, which mirrors the sky a very little from above and
    // somewhat at a low angle, unevenly, as the ground under it is uneven. It is a sheen on the ground and never
    // hides what the ground is: a track's textures must read through it as they do when dry.
    float gfxFilm = ( ${glsl(WET.sheen)} + ${glsl(WET.sheenLow - WET.sheen)} * pow( clamp( 1.0 - gfxEye.y, 0.0, 1.0 ), 4.0 ) ) * ( 0.5 + gfxGrain.a );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, gfxSkyShown, clamp( gfxWet * ( 1.0 - gfxPool ) * ( 1.0 - gfxSnow ) * gfxLevel * gfxFilm, 0.0, ${glsl(WET.sheenMost)} ) );
  }
  if ( gfxSnow > 0.0 ) {
    // Crystals close to the eye glint: a fine field of points, each catching the light from one way only, so they
    // come and go as the eye moves. Far off the field runs together and there are none.
    vec3 gfxSeen = normalize( cameraPosition - vGfxWorld );
    float gfxCrystal = texture2D( uGfxNoise, gfxAt / 1.3 + gfxSeen.xz * 0.21 ).a * texture2D( uGfxNoise, gfxAt / 0.47 - gfxSeen.zx * 0.33 ).a;
    gl_FragColor.rgb += gfxSnow * smoothstep( 0.36, 0.46, gfxCrystal ) * uGfxLight * ( 0.25 + 2.2 * uGfxSun.w ) * vec3( 1.0, 0.98, 0.95 );
  }
`;

/**
 * @param {{ world: THREE.Object3D, puddleTexture?: THREE.Texture|null, puddles?: boolean, snow?: boolean }} options
 *   `world` is the track (render/track-scene.js); `puddleTexture` the puddle map
 *   (render/ground-textures.js), without which the ground is wet in Rain but holds no pools;
 *   `shelterTexture` where the ground lies under cover, which stays dry and bare;
 *   `puddles` and `snow` are the two switches; `sun` the scene's sun, which lights the snow's
 *   ridges; `ripples` the waves the trucks stir (render/water-ripples.js), which a puddle shows,
 *   and `puddleMap` the puddle map itself, which says how deep a puddle is where a wheel stands. Whether the snow has depth is read off the terrain itself: its mesh has `snowDepth`
 *   when the track was built for a race in Snow.
 */
export function createGroundSurface({ world, puddleTexture = null, shelterTexture = null, puddles = true, snow = true, sun = null, ripples = null, puddleMap = null }) {
  const uniforms = {
    ...(ripples?.uniforms ?? {}),
    ...sharedNoiseUniforms(), uGfx: { value: new THREE.Vector4() }, uGfxLight: { value: 1 }, uGfxSun: { value: new THREE.Vector4(0, 1, 0, 0) },
    uGfxSky: { value: new THREE.Color(0.6, 0.7, 0.85) }, uGfxHorizon: { value: new THREE.Color(0.7, 0.75, 0.8) },
    uGfxPuddles: { value: puddleTexture }, uGfxShelter: { value: shelterTexture },
    uGfxPuddleSide: { value: puddleTexture?.image.width ?? 1 },
  };
  const dressed = new Set();
  let volume = false;

  /**
   * Give a ground material the weather. `pools` false leaves out standing water (ground boxes:
   * the puddle map is of the ground under them, not of their tops); `depth` says the mesh it
   * draws has the snow's depth on its vertices; `shelter` false leaves out the cover overhead
   * (ground boxes again: they are the cover); `share` says its vertices say how much of the open
   * ground's snow lies there (`snowShare`: ground boxes' tops along the course).
   */
  function dress(material, { pools = true, depth = false, shelter = true, share = false } = {}) {
    if (dressed.has(material)) return material;
    dressed.add(material);
    const pooled = pools && puddles && puddleTexture;
    const defines = `${pooled ? "#define GFX_POOLS\n" : ""}${pooled && ripples ? "#define GFX_RIPPLES\n" : ""}${depth && snow ? "#define GFX_SNOW_VOLUME\n" : ""}${shelter && shelterTexture ? "#define GFX_SHELTER\n" : ""}${share && snow ? "#define GFX_SNOW_SHARE\n" : ""}`;
    // Its lines go beside three.js's own, which stay where they are for whoever replaces them (render/ground-detail.js).
    return addShaderHook(material, `ground-surface:${defines}`, 10, (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${defines}${VERTEX_PARS}`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>\n${VERTEX_LIFT}`)
        .replace("#include <project_vertex>", `#include <project_vertex>\n${VERTEX}`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${defines}${FRAGMENT_PARS}`)
        .replace("#include <map_fragment>", `#include <map_fragment>\n${ALBEDO}`)
        .replace("#include <opaque_fragment>", `#include <opaque_fragment>\n${SHINE}`);
    });
  }
  world.traverse((object) => {
    if (object.name === "terrain" && object.material) {
      const depth = !!object.geometry?.attributes.snowDepth;
      volume ||= depth && snow;
      dress(object.material, { depth });
    }
    // A ground box's top is itself what stands over the ground: it is out in the weather, whatever lies under it, and
    // along the course it is the course, its snow as thin as the road's.
    if (object.name === "groundBoxes" && object.material) dress(object.material, { pools: false, shelter: false, share: !!object.geometry?.attributes.snowShare });
  });

  let weather = 0, wet = 0, filled = 0, down = 0, rainSeconds = 0, snowSeconds = 0, snowStart = 0;
  const horizon = new THREE.Color();
  return {
    /** Dress one more material as the terrain's is (the lit twin of the classic look's, render/weather-scene.js). */
    dress: (material) => dress(material, { depth: volume }),
    /**
     * The weather changed (or began). `instant` at a race's start: in Rain the ground is wet and
     * its puddles full already, and in Snow part of the snow is already down; a change during a
     * race comes on from nothing.
     */
    set(next, { instant = false } = {}) {
      if (next === SNOW && weather !== SNOW) { snowSeconds = 0; snowStart = instant ? SNOW_START : down; }
      if (instant) {
        const raining = puddles && next === RAIN;
        rainSeconds = raining ? 600 : 0; wet = raining ? 1 : 0; filled = raining ? 1 : 0;
        down = snow && next === SNOW ? SNOW_START : 0;
      }
      weather = next;
    },
    /**
     * Once a frame: `light` the weather's brightness, `fog` the scene's fog and `background` the
     * sky's colour, which standing water shows.
     */
    update(dt, { light = 1, fog = null, background = null } = {}) {
      if (puddles && weather === RAIN) {
        rainSeconds += dt;
        wet = Math.max(wet, groundWetness(rainSeconds));
        filled = Math.max(filled, puddlesFilled(rainSeconds));
      } else {
        rainSeconds = 0;
        wet = Math.max(0, wet - dt / DRY_SECONDS);
        filled = Math.max(0, filled - dt / DRY_SECONDS);
      }
      if (snow && weather === SNOW) { snowSeconds += dt; down = snowDown(snowSeconds, snowStart); } else down = Math.max(0, down - dt / MELT_SECONDS);
      uniforms.uGfx.value.set(wet, wet > 0 ? filled : 0, down, (uniforms.uGfx.value.w + dt) % 4096);
      // The puddles, while there is water in them, for the trucks to stir.
      ripples?.puddles(puddles && wet > 0 && filled > 0 ? (1 - filled) * FILL_DROP_FT : null);
      uniforms.uGfxLight.value = light;
      if (sun) {
        const way = uniforms.uGfxSun.value;
        way.set(sun.position.x, sun.position.y, sun.position.z, 0).normalize();
        way.w = WEATHER_LOOK[weather]?.sun ?? 1;
      }
      horizon.copy(fog?.color ?? background ?? uniforms.uGfxHorizon.value);
      uniforms.uGfxHorizon.value.copy(horizon);
      // Overhead the sky is the sky's own colour, greyed toward the fog by how much the weather shuts it out.
      uniforms.uGfxSky.value.copy(background ?? horizon).lerp(horizon, WEATHER_LOOK[weather]?.fogEndFt ? 0.6 : 0);
    },
    /** How deep the puddle that stands at game (x, z) is now, feet, as the ground draws it; 0 where none does. */
    puddleAt(x, z) {
      if (!puddles || !puddleMap || !(wet > 0 && filled > 0)) return 0;
      return Math.max(0, puddleDepthAt(puddleMap, x, z) - (1 - filled) * FILL_DROP_FT);
    },
    /**
     * Where water stands, for what lies on the ground and must go under it (render/tire-tracks.js), or null without
     * puddles: `glsl` gives `vec2 gfxPoolAt( vec2 at )` (how much of game (x, z) a puddle covers, and how deep it is
     * there, feet), and `uniforms` are what it reads.
     */
    pools: puddles && puddleTexture ? { glsl: POOL_GLSL, uniforms } : null,
    /** How much of the snow is down, 0 to 1. */
    get snowDown() { return down; },
    /** Whether the snow has depth: the terrain is lifted by it (game/snow-cover.js). */
    get snowHasDepth() { return volume; },
    dispose() { dressed.clear(); },
  };
}
