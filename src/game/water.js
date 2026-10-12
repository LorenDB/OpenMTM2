/*
  The water as a body of water, for "Reflective water" (docs/VISUALS.md, "Water"). The game
  draws its water as a picture on a plane, more or less see-through by the weather
  (MONSTER_EXE_ANALYSIS.md section 13). The port's has depth, and what the eye sees of it is
  worked out as light passing through that depth:

   - water takes the red out of light first and the blue last, so what lies under a little
     water is seen nearly as it is and what lies under a lot is not seen at all;
   - what the water itself sends back is the daylight that fell into it, scattered, in the
     water's own colour: bright at noon, dull under cloud, dim orange at Dusk, nothing in the
     dark. Deep water in the dark is black, not clear.

  Pure, so it runs under Node.
*/

/**
 * How much of red, green and blue light a foot of water takes (the share lost is
 * `1 - exp(-take)`): pond and shore water, far murkier than the open sea, so a truck's depth of
 * it already hides the bed.
 */
export const WATER_TAKES = Object.freeze([0.42, 0.115, 0.08]);
/** The colour of the daylight water sends back out of its depth, for white light falling on it. */
export const WATER_SCATTER = Object.freeze([0.012, 0.105, 0.125]);
/** In Rain the water is stirred and silted: its own colour goes this far toward a dull grey green. */
export const WATER_SILT = 0.45, WATER_SILT_TONE = Object.freeze([0.09, 0.105, 0.085]);
/** Water bends a line of sight toward the upright: its index against air's. */
export const WATER_INDEX = 1.333;

/**
 * How far a line of sight runs through water `depthFt` deep, feet, for an eye that looks down
 * at the surface along a line `sine` steep (the sine of its angle to the surface, 1 straight
 * down). The surface bends the line toward the upright, so even a glancing look runs through
 * no more than about one and a half times the depth.
 */
export function waterPathFt(depthFt, sine) {
  const s = Math.min(1, Math.max(0, sine));
  return Math.max(0, depthFt) / Math.sqrt(1 - (1 - s * s) / (WATER_INDEX * WATER_INDEX));
}

/** How much of red, green and blue light gets through `pathFt` of water, 0 to 1 each. */
export const waterPasses = (pathFt) => WATER_TAKES.map((take) => Math.exp(-take * Math.max(0, pathFt)));

/**
 * How much of what lies under `pathFt` of water the water hides, 0 to 1: by how much of the
 * light, as the eye weighs red, green and blue, does not get through.
 */
export function waterHides(pathFt) {
  const [r, g, b] = waterPasses(pathFt);
  return 1 - (0.2126 * r + 0.7152 * g + 0.0722 * b);
}

/**
 * Under water (docs/VISUALS.md, "Under water"). The eye sees `sightFt` at the most, through
 * water of the colour its depth sends back, and what daylight there is has lost its red. The game's own underwater fog is 320 ft in the weather's
 * fog colour (game/weather.js), which is what is drawn with "Reflective water" off.
 */
export const UNDERWATER = Object.freeze({ sightFt: 170, tint: Object.freeze([0.5, 0.86, 0.95]), corners: 0.45 });

/**
 * Snell's window: from under water the sky is seen only within this of straight up (the
 * cosine of 48.6 degrees). Outside it the surface is a mirror of the water below.
 */
export const SNELL_WINDOW = Math.sqrt(1 - 1 / (WATER_INDEX * WATER_INDEX));

/**
 * The bed under water (render/water-surface.js): light dances on it where the water is
 * shallow, down to `causticsToFt`, as much as `caustics` brighter and darker; and the ground
 * within `wetShoreFt` over the waterline is wet from it, `wetShore` darker.
 */
export const WATER_BED = Object.freeze({ caustics: 0.5, causticsToFt: 9, wetShoreFt: 0.7, wetShore: 0.28 });

/*
  Ripples and wakes (docs/VISUALS.md, "Ripples and wakes"), for "Reflective water". The water
  about the eye is a field of waves that the trucks stir: a wheel at the surface pushes the
  water down where it is, so a truck that moves drags a wake behind it and one that stops sends
  out a ring; a wheel that comes down into the water throws a ring out from where it struck.
  The waves run as waves on water do, slower in the shallows, which bends them toward the shore,
  and they are thrown back from it; churned water is white with foam that thins away.
*/
/**
 * The field is `windowTexels` square, a point every `texelFt`, kept round the eye. It runs in
 * steps of `stepS`, `mostSteps` at the most in a frame. A wave runs no faster than
 * `fastestFtPerS` (a shallow water wave's speed, `waveSpeed`, over deeper water), and dies away
 * by 1/e in `calmS`. Foam halves every `foamHalfLifeS`. It takes `stirs` wheels at once.
 */
export const WATER_RIPPLES = Object.freeze({ windowTexels: 512, texelFt: 0.6, stepS: 1 / 60, mostSteps: 4, fastestFtPerS: 12, calmS: 1.8, foamHalfLifeS: 2.2, stirs: 32 });

/** How fast a wave runs over water `depthFt` deep, ft/s: a shallow water wave's `sqrt(g d)`, no faster than `fastestFtPerS`. */
export const waveSpeed = (depthFt) => Math.min(WATER_RIPPLES.fastestFtPerS, Math.sqrt(32.17 * Math.max(0, depthFt)));

/**
 * How a wheel stirs the water. `hubFt` is its hub's height and `radiusFt` the tire's, `levelFt`
 * the water's, `speedFtS` how fast it moves across it. A wheel that meets the surface pushes it
 * down over `radiusFt` about it, by `depthFt`, more the faster it goes; one clear of the water,
 * or wholly under it by more than a foot and a half (where the surface over it only stirs
 * faintly, and not at all past that), does not. `foam` is how fast it churns the water white, 0
 * to 1.
 * @returns {{ depthFt: number, radiusFt: number, foam: number }}
 */
export function wheelStir({ hubFt, radiusFt = 2.75, levelFt, speedFtS = 0 }) {
  const wetFt = levelFt - (hubFt - radiusFt), topFt = hubFt + radiusFt - levelFt;
  const meets = smooth(0, 0.3, wetFt) * smooth(-2, 0, topFt);
  const speed = Math.abs(speedFtS);
  return { depthFt: meets * Math.min(0.9, 0.12 + 0.025 * speed), radiusFt: 1.8, foam: meets * Math.min(1, Math.max(0, (speed - 6) / 30)) };
}

/**
 * A wheel that comes down into the water at `fallFtS` throws a ring out from where it struck: the
 * surface is pushed down by `depthFt` over `radiusFt` at once. Nothing for a touch under 5 ft/s.
 */
export function landingStir(fallFtS) {
  if (!(fallFtS >= 5)) return null;
  return { depthFt: Math.min(2.5, 0.06 * fallFtS), radiusFt: 3, foam: Math.min(1, fallFtS / 30) };
}

function smooth(a, b, v) {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * How a wheel on the ground stirs a puddle it runs through (render/water-ripples.js), where the
 * puddle stands `depthFt` deep, at `speedFtS`: as `wheelStir`, but a puddle is inches deep, and a
 * tire in it pushes up a bow and sends out rings of its own scale. None in a puddle too shallow
 * to hold a wave.
 */
export function puddleStir({ depthFt, speedFtS = 0 }) {
  const holds = smooth(0.01, 0.1, depthFt), speed = Math.abs(speedFtS);
  return { depthFt: holds * Math.min(0.3, 0.04 + 0.008 * speed), radiusFt: 1.5, foam: holds * Math.min(1, Math.max(0, (speed - 4) / 25)) };
}

/** A puddle's surface lies this far under its full level while the rain is still filling it, feet (game/atmosphere.js `puddlesFilled`). */
export const PUDDLE_FILL_DROP_FT = 0.1;
