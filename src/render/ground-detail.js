/*
  The ground's fine detail (docs/VISUALS.md, "Ground"; the rules are in game/ground-detail.js),
  when "Ground detail" is on. Three things, all added to the terrain's own material:

   - The tiles as a stack of textures instead of one atlas. In an atlas a tile's neighbours are
     other tiles, so it cannot be shrunk for the distance without their colours running in, and
     the game's ground was drawn unfiltered: it shimmers far off and shows its repeats. A stack
     has no neighbours: every tile is filtered down for the distance and across a slant by
     itself.
   - Grain: a field of clods and grit laid over the tiles at two scales, lighter and darker by
     its height and by how its slopes face the sun. It is seen from above on level ground and
     from the side on a cliff, where the tile itself, seen edge on, would only smear.
   - Broad patches of lighter and darker ground, so a texture repeated to the horizon does not
     show its repeats.

  The ground in the weather (render/ground-surface.js) adds its lines to the same material and
  sees the ground's colour after this.
*/
import * as THREE from "three";
import { CLIFF_NORMAL, GRAIN, PATCHES, grainShare } from "../game/ground-detail.js";
import { WEATHER_LOOK } from "../game/weather.js";
import { SHARED_NOISE_GLSL, sharedNoiseUniforms } from "./noise-textures.js";
import { addShaderHook } from "./shader-hooks.js";

const glsl = (n) => n.toFixed(5);
/** How many mip levels further down a tile's texels have run together into its colour: a 64 texel tile is 8 across there. */
const FLAT_LEVELS = 3;

const VERTEX_PARS = "varying vec3 vDetWorld;\nvarying vec3 vDetUp;";
const VERTEX = "\tvDetWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n\tvDetUp = normalize( mat3( modelMatrix ) * normal );";

const FRAGMENT_PARS = /* glsl */ `
varying vec3 vDetWorld;
varying vec3 vDetUp;
uniform sampler2D uDetShare;
// The noises the rest of the ground reads too, in the samplers they share (render/noise-textures.js).
${SHARED_NOISE_GLSL}
#define uDetNoise mtmDetailNoise
#define uDetCloud mtmCloudNoise
// the way to the sun (scene axes), and how strongly the grain's slopes are lit by it
uniform vec4 uDetSun;
// the atlas's width and height in texels, a slot's pitch, the padding round a tile
uniform vec4 uDetAtlas;
// a tile's side in texels, slots a row
uniform vec2 uDetTile;
// 1 the full detail, 0 the light one (a headset)
uniform float uDetFull;
#ifdef DET_TILES
  uniform highp sampler2DArray uDetTiles;
#endif
// The grain at one scale: its height (x, about a half) and how its slopes face the sun (y, about zero). \`weight\` says
// how much of it is seen from above and how much from either side.
vec2 detGrain( float feet, vec3 weight ) {
  vec4 top = texture2D( uDetNoise, vDetWorld.xz / feet );
  vec2 grain = vec2( top.r, - dot( top.gb - 0.5, uDetSun.xz ) ) * weight.y;
  if ( uDetFull > 0.5 ) {
    vec4 east = texture2D( uDetNoise, vDetWorld.zy / feet ), north = texture2D( uDetNoise, vDetWorld.xy / feet );
    grain += vec2( east.r, - dot( east.gb - 0.5, uDetSun.zy ) ) * weight.x + vec2( north.r, - dot( north.gb - 0.5, uDetSun.xy ) ) * weight.z;
  } else grain += vec2( 0.5, 0.0 ) * ( weight.x + weight.z );
  return grain;
}
`;

/* In place of three.js's own read of the map. */
const MAP = /* glsl */ `
#ifdef USE_MAP
  vec2 detPx = vMapUv * uDetAtlas.xy;
  vec2 detCell = floor( detPx / uDetAtlas.z );
  float detSlot = detCell.y * uDetTile.y + detCell.x;
  #ifdef DET_TILES
    // The tile's own square, 0 to 1. How fast it crosses the screen is taken from the atlas, where it runs on evenly
    // from a cell into the next: taken from the square it would jump at every cell's edge.
    vec2 detLocal = ( detPx - detCell * uDetAtlas.z - uDetAtlas.w ) / uDetTile.x;
    vec2 detAcross = dFdx( detPx ) / uDetTile.x, detDown = dFdy( detPx ) / uDetTile.x;
    vec4 sampledDiffuseColor = textureGrad( uDetTiles, vec3( detLocal, detSlot ), detAcross, detDown );
  #else
    vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  #endif
  float detShare = texelFetch( uDetShare, ivec2( int( detSlot + 0.5 ), 0 ), 0 ).r;
  vec3 detN = normalize( vDetUp );
  float detCliff = 1.0 - smoothstep( ${glsl(CLIFF_NORMAL.cliff)}, ${glsl(CLIFF_NORMAL.level)}, detN.y );
  float detDist = distance( cameraPosition, vDetWorld );
  float detNear = 1.0 - smoothstep( ${glsl(GRAIN.fine.fadeFromFt)}, ${glsl(GRAIN.fine.fadeToFt)}, detDist );
  float detMid = 1.0 - smoothstep( ${glsl(GRAIN.coarse.fadeFromFt)}, ${glsl(GRAIN.coarse.fadeToFt)}, detDist );
  vec3 detWeight = abs( detN );
  detWeight *= detWeight; detWeight *= detWeight;
  detWeight /= detWeight.x + detWeight.y + detWeight.z;
  // Broad patches, lighter and darker, which do not fade with distance.
  float detPatch = ( texture2D( uDetCloud, vDetWorld.xz / ${glsl(PATCHES.broadFt)} ).r - 0.5 ) + ( texture2D( uDetCloud, vDetWorld.xz / ${glsl(PATCHES.mediumFt)} ).g - 0.5 ) * 0.7
    + ( texture2D( uDetCloud, vDetWorld.xz / ${glsl(PATCHES.smallFt)} ).b - 0.5 ) * 0.5;
  float detFar = smoothstep( ${glsl(PATCHES.farFromFt)}, ${glsl(PATCHES.farToFt)}, detDist );
  #ifdef DET_TILES
    // A cliff shows its tile edge on, smeared down the face: there the tile gives its colour and the grain the structure.
    // Far off a tile's own picture is what shows it repeating, cell after cell: there too it gives its colour.
    // Its colour is the tile read that many levels further down than the distance asks, so it never reads finer than the screen can show.
    vec3 detFlat = textureGrad( uDetTiles, vec3( detLocal, detSlot ), detAcross * ${glsl(2 ** FLAT_LEVELS)}, detDown * ${glsl(2 ** FLAT_LEVELS)} ).rgb;
    sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, detFlat, max( detCliff * 0.7, detFar * ${glsl(PATCHES.farFlat)} ) );
  #endif
  vec2 detFine = detGrain( ${glsl(GRAIN.fine.repeatFt)}, detWeight ), detCoarse = detGrain( ${glsl(GRAIN.coarse.repeatFt)}, detWeight );
  float detAmount = detShare * ( 1.0 + 0.5 * detCliff );
  float detLight = ( detFine.x - 0.5 ) * 0.6 * detNear + ( detCoarse.x - 0.5 ) * 0.3 * detMid
    + ( detFine.y * detNear + detCoarse.y * detMid ) * uDetSun.w;
  if ( uDetFull > 0.5 ) {
    // Beds of rock along the contours of a cliff: the same grain drawn out level.
    float detBeds = texture2D( uDetNoise, vec2( ( vDetWorld.x + vDetWorld.z ) / 310.0, vDetWorld.y / 27.0 ) ).a
      + texture2D( uDetNoise, vec2( ( vDetWorld.x - vDetWorld.z ) / 140.0, vDetWorld.y / 9.0 ) ).r * 0.5 - 0.75;
    detLight += detCliff * detBeds * 0.5 * detMid;
  }
  // The grain never blacks the ground out nor doubles it; the patches grow a little stronger where the tile's own picture has gone.
  sampledDiffuseColor.rgb *= clamp( 1.0 + detAmount * detLight, 0.42, 1.75 ) * ( 1.0 + detPatch * ${glsl(PATCHES.amount * 2)} * ( 1.0 + detFar ) * step( 0.01, detShare ) );
  diffuseColor *= sampledDiffuseColor;
#endif
`;

/**
 * The atlas's tiles as a stack, one layer a slot, or null where the graphics card cannot hold
 * that many layers (the ground then keeps its atlas, with the grain over it).
 */
function tileStack(atlas, renderer, look) {
  const { rgba, width, tileSide: side, padding = 0, slots } = atlas;
  if (!side || !slots) return null;
  const gl = renderer.getContext();
  if (!gl.getParameter || slots > gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) || side > gl.getParameter(gl.MAX_TEXTURE_SIZE)) return null;
  const pitch = side + padding * 2, cols = Math.round(width / pitch);
  const data = new Uint8Array(side * side * 4 * slots);
  for (let slot = 0; slot < slots; slot++) {
    const ox = (slot % cols) * pitch + padding, oy = Math.floor(slot / cols) * pitch + padding;
    for (let y = 0; y < side; y++) {
      const from = ((oy + y) * width + ox) * 4;
      data.set(rgba.subarray(from, from + side * 4), (slot * side + y) * side * 4);
    }
  }
  const stack = new THREE.DataArrayTexture(data, side, side, slots);
  stack.format = THREE.RGBAFormat;
  stack.colorSpace = THREE.SRGBColorSpace;
  // The classic look keeps its square texels close up; either look is filtered down for the distance.
  stack.magFilter = look === "classic" ? THREE.NearestFilter : THREE.LinearFilter;
  stack.minFilter = THREE.LinearMipmapLinearFilter;
  stack.generateMipmaps = true;
  stack.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  stack.needsUpdate = true;
  return stack;
}

/**
 * @param {{ world: THREE.Object3D, atlas: object, textureValues?: ArrayLike<number>|null, renderer: THREE.WebGLRenderer,
 *   sun: THREE.Light, look?: string }} options
 *   `world` is the track (render/track-scene.js), whose terrain and ground boxes take the detail;
 *   `atlas` the ground's textures with their layout (worker/track-build.js `terrain.atlas`);
 *   `textureValues` each texture's `.TTY` value, which says what ground it is; `sun` the scene's
 *   sun, whose position is the way to it.
 */
export function createGroundDetail({ world, atlas, textureValues = null, renderer, sun, look = "enhanced" }) {
  const stack = tileStack(atlas, renderer, look);
  const slots = Math.max(1, atlas.slots ?? 1), pitch = (atlas.tileSide ?? 64) + (atlas.padding ?? 0) * 2;
  const shares = new Uint8Array(slots);
  for (let slot = 0; slot < slots; slot++) shares[slot] = Math.round(grainShare(textureValues?.[slot] ?? 0) * 255);
  const shareTexture = new THREE.DataTexture(shares, slots, 1, THREE.RedFormat, THREE.UnsignedByteType);
  shareTexture.magFilter = shareTexture.minFilter = THREE.NearestFilter;
  shareTexture.generateMipmaps = false;
  shareTexture.needsUpdate = true;
  const uniforms = {
    ...sharedNoiseUniforms(), uDetShare: { value: shareTexture }, uDetTiles: { value: stack },
    uDetSun: { value: new THREE.Vector4(0, 1, 0, 1) },
    uDetAtlas: { value: new THREE.Vector4(atlas.width, atlas.height, pitch, atlas.padding ?? 0) },
    uDetTile: { value: new THREE.Vector2(atlas.tileSide ?? 64, Math.max(1, Math.round(atlas.width / pitch))) },
    uDetFull: { value: 1 },
  };
  const defines = stack ? "#define DET_TILES\n" : "";
  const dressed = new Set();

  /** Give a ground material the detail. */
  function dress(material) {
    if (!material?.map || dressed.has(material)) return material;
    dressed.add(material);
    // After the hooks that add lines beside three.js's read of the map: this one replaces it.
    return addShaderHook(material, `ground-detail:${stack ? "tiles" : "atlas"}`, 20, (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${VERTEX_PARS}`)
        .replace("#include <project_vertex>", `#include <project_vertex>\n${VERTEX}`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${defines}${FRAGMENT_PARS}`)
        .replace("#include <map_fragment>", MAP);
    });
  }
  world.traverse((object) => { if ((object.name === "terrain" || object.name === "groundBoxes") && object.material) dress(object.material); });

  return {
    /** Dress one more material as the terrain's is (the lit twin of the classic look's, render/weather-scene.js). */
    dress,
    /**
     * Once a frame: `weather` decides how much of the light is the sun's, which is what shows
     * the grain's slopes; `lite` (a headset) reads the grain from above only.
     */
    update({ weather = 0, lite = false } = {}) {
      const way = uniforms.uDetSun.value;
      way.set(sun.position.x, sun.position.y, sun.position.z, 0).normalize();
      way.w = 2.2 * (WEATHER_LOOK[weather]?.sun ?? 1);
      uniforms.uDetFull.value = lite ? 0 : 1;
    },
    dispose() {
      stack?.dispose();
      shareTexture.dispose();
      dressed.clear();
    },
  };
}
