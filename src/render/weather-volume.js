/*
  The weather as a volume (docs/VISUALS.md, "Weather"), for render/weather-scene.js when
  "Volumetric weather" is on: the fog as a layer the eye looks through (render/atmosphere.js)
  and rain and snow falling through the air (render/precipitation.js). The weather scene still
  decides the fog's colour, the light and the lightning; this draws them in depth.
*/
import * as THREE from "three";
import { fogVolume, precipitationOf } from "../game/atmosphere.js";
import { WEATHER_LOOK } from "../game/weather.js";
import { atmosphere, fogFloorTexture } from "./atmosphere.js";
import { createPrecipitation } from "./precipitation.js";

/** Rain and snow come and go over this long, seconds, when the weather changes in a race. */
const ONSET_SECONDS = 2.5;
/** The sun's light in the fog: a warm white, by how much of the sun the weather lets through. */
const GLOW = new THREE.Color(1, 0.94, 0.82);

/**
 * @param {{ scene: THREE.Scene, camera: THREE.Camera, sun: THREE.Light, ground?: (x: number, z: number) => number,
 *   groundTexture?: { texture: THREE.Texture, referenceFt: number }|null, random?: () => number }} env
 *   `ground` is the drawn ground's height in game feet; `groundTexture` the same as a texture
 *   (render/ground-textures.js), which stops the rain and the snow at the ground; `indoor` a
 *   stadium, which has a hall's air and no day's haze; `fogFloor` where the fog lies
 *   (game/fog-floor.js), without which it lies at the height the eye starts over. `amount` the
 *   share of the fog's thickness the Volumetric weather slider asks for (game/atmosphere.js `FOG_AMOUNTS`).
 */
export function createWeatherVolume({ scene, camera, sun, ground = null, groundTexture = null, random = Math.random, indoor = false, fogFloor = null, amount = 1 }) {
  const root = new THREE.Group();
  root.name = "weather-volume";
  scene.add(root);
  /** The fields that fall, made when a weather first needs them: `{ field, amount }` by kind. */
  const falling = new Map();
  let current = 0, fogColor = new THREE.Color(), volume = null;
  const toSun = new THREE.Vector3(), glow = new THREE.Color(), lit = new THREE.Color();
  const floorTexture = fogFloor ? fogFloorTexture(fogFloor) : null;
  atmosphere.floor(floorTexture);
  /** The fog's floor where the eye stands: a place in the world, not something that follows the eye. */
  let flat = null;
  const floorUnderEye = () => {
    if (fogFloor) return fogFloor.at(camera.position.x, -camera.position.z);
    flat ??= ground ? ground(camera.position.x, -camera.position.z) : camera.position.y;
    return flat;
  };

  return {
    /** The weather changed (or began): what falls. `instant` at the start of a race, when it has been falling all along. */
    set(weather, { instant = false } = {}) {
      current = weather;
      const kind = WEATHER_LOOK[weather]?.precipitation ?? null;
      if (kind && !falling.has(kind)) {
        const field = createPrecipitation({ kind, spec: precipitationOf(weather), ground: groundTexture, random });
        root.add(field.object);
        falling.set(kind, { field, amount: 0 });
      }
      if (instant) for (const [name, entry] of falling) entry.amount = name === kind ? 1 : 0;
      atmosphere.update(0, floorUnderEye());
    },
    /**
     * The scene's fog was set (weather-scene.js `applyFog`): make it the volume, or leave it as
     * it is where the weather has none of its own (the dark weathers), under water, and where
     * the scene has no fog at all. Sets the fog's range to the volume's, which a headset may
     * then draw in. `clearRange` is where a clear day's haze fades the distance out (`{ startFt,
     * endFt }`): not the game's fog of a foggy weather, which a fog with a top is seen beyond.
     */
    fog({ underwater = false, clearRange = null } = {}) {
      // A weather without fog of its own, or one with a top (Foggy), fades out where a clear day's haze does: `clearRange`,
      // or the scene's fog where it is a clear day's.
      const range = clearRange ?? (scene.fog?.isFog ? { startFt: scene.fog.near, endFt: scene.fog.far } : null);
      volume = !underwater && scene.fog?.isFog ? fogVolume(current, range, { indoor, amount }) : null;
      if (!volume) { atmosphere.clear(); return; }
      fogColor.copy(scene.fog.color);
      scene.fog.near = volume.fadeStartFt;
      scene.fog.far = volume.farFt;
      toSun.copy(sun.position).normalize();
      glow.copy(GLOW).multiplyScalar(WEATHER_LOOK[current].light);
      atmosphere.set(volume, { color: fogColor, sun: toSun, glowColor: glow, glow: volume.glow * WEATHER_LOOK[current].sun, sunShare: WEATHER_LOOK[current].sun });
    },
    /**
     * Once a frame. `flash` is lightning's extra light (0 when there is none), `light` the
     * weather's brightness, `floorFt` the water's level or null, `viewHeight` the picture's
     * height in pixels, `lite` a headset, which cuts the fog's banks coarser.
     */
    update(dt, { flash = 0, light = 1, floorFt = null, viewHeight = 900, lite = false } = {}) {
      if (volume && scene.fog?.isFog) {
        // Lightning lights the fog itself.
        lit.copy(fogColor).multiplyScalar(1 + flash * 1.2).addScalar(flash * 0.12);
        scene.fog.color.copy(lit);
        atmosphere.color(lit);
        atmosphere.range(scene.fog.near, scene.fog.far);
      }
      atmosphere.detail(lite);
      atmosphere.update(dt, floorUnderEye());
      const kind = WEATHER_LOOK[current]?.precipitation ?? null;
      for (const [name, entry] of falling) {
        const target = name === kind ? 1 : 0;
        entry.amount += Math.sign(target - entry.amount) * Math.min(Math.abs(target - entry.amount), dt / ONSET_SECONDS);
        entry.field.update(dt, { camera, amount: entry.amount, light: Math.min(1.6, light * (1 + flash)), floorFt, viewHeight });
      }
    },
    dispose() {
      for (const { field } of falling.values()) field.dispose();
      scene.remove(root);
      atmosphere.clear();
      atmosphere.floor(null);
      floorTexture?.dispose();
    },
  };
}
