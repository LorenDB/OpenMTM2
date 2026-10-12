/*
  The scene's lights for "Natural light" (docs/VISUALS.md, "Light"; the numbers are in
  game/lighting.js): the sun in the colour of its hour, the sky's light from above and the
  ground's from below as one hemisphere light, and the curve that rolls bright light off.

  The weather scene (render/weather-scene.js) still decides when the light changes (a weather
  beginning, a flash of lightning) and asks this for the lights; without it the scene keeps the
  white sun and white ambient light it always had.

  The curve is three.js's "custom" tone mapping, whose one function is replaced here, so every
  material that three.js tone maps takes it, whoever made it, and a pass over the finished
  picture (render/lens.js) can apply the very same lines.
*/
import * as THREE from "three";
import { DEFAULT_TONES, TONE_KNEE, TONE_PALE, lightRig, meanTone, skyTones, sunDirection } from "../game/lighting.js";

const glsl = (n) => n.toFixed(4);

/** The curve as GLSL: `mtmToneCurve( color )` for a colour already scaled by the exposure. */
export const TONE_GLSL = /* glsl */ `
vec3 mtmToneCurve( vec3 color ) {
  float peak = max( color.r, max( color.g, color.b ) );
  if ( peak <= ${glsl(TONE_KNEE)} ) return color;
  float room = ${glsl(1 - TONE_KNEE)};
  float eased = 1.0 - room * room / ( peak + room - ${glsl(TONE_KNEE)} );
  float pale = 1.0 - 1.0 / ( ${glsl(TONE_PALE)} * ( peak - eased ) + 1.0 );
  return mix( color * ( eased / peak ), vec3( eased ), pale );
}
`;

let installed = false;

/** Make three.js's custom tone mapping the curve, for every material compiled from now on. Does nothing a second time. */
export function installToneCurve() {
  if (installed) return;
  installed = true;
  const stock = "vec3 CustomToneMapping( vec3 color ) { return color; }";
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  if (!chunk.includes(stock)) throw new Error("three.js's custom tone mapping is not where the light rig expects it.");
  THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(stock, `${TONE_GLSL}\nvec3 CustomToneMapping( vec3 color ) { return mtmToneCurve( color * toneMappingExposure ); }`);
}
installToneCurve();

/**
 * @param {{ scene: THREE.Scene, sun: THREE.DirectionalLight, ambient: THREE.AmbientLight, renderer: THREE.WebGLRenderer,
 *   world: THREE.Object3D, groundArt?: { rgba: Uint8Array, width: number, height: number }|null }} env
 *   `sun` and `ambient` are the scene's own lights, which this takes over; `sun.position` as
 *   it is when this is made is the level's way to the sun. `world` is the track, whose sky dome
 *   gives the sky's colours; `groundArt` the ground's textures, whose mean colour is the light
 *   the ground throws back; `indoor` a stadium, which its floodlights light.
 */
export function createLightRig({ scene, sun, ambient, renderer, world, groundArt = null, indoor = false }) {
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
  hemisphere.name = "sky-light";
  scene.add(hemisphere);
  /** The level's own way to the sun, in the scene's axes. */
  const levelSun = sun.position.clone().normalize();
  const ground = meanTone(groundArt);
  const before = { toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure, ambient: ambient.intensity, sunColor: sun.color.clone() };
  renderer.toneMapping = THREE.CustomToneMapping;
  renderer.toneMappingExposure = 1;
  let tones = { zenith: [...DEFAULT_TONES.zenith], horizon: [...DEFAULT_TONES.horizon] }, weather = 0, rig = null;
  const toSun = () => sunDirection(weather, [levelSun.x, levelSun.y, levelSun.z], { indoor });

  return {
    hemisphere,
    /**
     * The weather changed (or began): read the sky that is up now, and put the sun where this
     * weather has it. Call it after the sky dome has its art and before anything reads where
     * the sun is.
     */
    set(next) {
      weather = next;
      const image = world.getObjectByName("sky")?.material?.map?.image;
      tones = skyTones(image ? { rgba: image.data, width: image.width, height: image.height } : null);
      const way = toSun();
      sun.position.set(way[0], way[1], way[2]);
    },
    /**
     * Set the lights, with lightning's extra light `flash` (0 when there is none). Returns the
     * rig (game/lighting.js `lightRig`), whose `shadow` says how dark the sun's shadows are.
     */
    apply(flash = 0) {
      rig = lightRig(weather, { zenith: tones.zenith, ground, toSun: toSun(), flash, indoor });
      sun.color.setRGB(rig.sun.color[0], rig.sun.color[1], rig.sun.color[2]);
      sun.intensity = rig.sun.strength;
      hemisphere.color.setRGB(rig.sky[0], rig.sky[1], rig.sky[2]);
      hemisphere.groundColor.setRGB(rig.ground[0], rig.ground[1], rig.ground[2]);
      // The hemisphere is all of the light that has no direction.
      ambient.intensity = 0;
      return rig;
    },
    /** The sky art's colours now: `{ zenith, horizon }`, linear. */
    get tones() { return tones; },
    /** The lights as last set. */
    get rig() { return rig; },
    dispose() {
      scene.remove(hemisphere);
      hemisphere.dispose();
      renderer.toneMapping = before.toneMapping;
      renderer.toneMappingExposure = before.exposure;
      ambient.intensity = before.ambient;
      sun.color.copy(before.sunColor);
      sun.position.copy(levelSun);
    },
  };
}
