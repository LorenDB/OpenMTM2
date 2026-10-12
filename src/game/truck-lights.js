/*
  A truck's lamps (MONSTER_EXE_ANALYSIS.md 11b, 0x579f10 and 0x57a080). The TRK lists each lamp: its
  type, where it sits on the body, its lens bitmap and, for a headlight, the cone of light it throws.
  Whether a lamp is lit depends on its type, on the truck's lamp switch (`lamps`: 0 off, 2 on; the
  game sets 2 in a dusk or night race and the Headlights key, L, toggles it for the player's truck),
  on the brakes, on the gear and on whether the viewer sits in the truck's own cockpit.
*/

/** The lamp switch the truck starts a race with: on when the weather lights the lamps. */
export const lampsAtStart = (weatherHeadlights) => (weatherHeadlights ? 2 : 0);

/** The Headlights key: the switch goes from off to on and from on to off. */
export const toggleLamps = (lamps) => (lamps ? 0 : 2);

/** Rear brake pressure above this lights a brake lamp (`0x617e80`). */
export const BRAKE_ON = 0.01;

/**
 * How bright a lamp is, 0 to 1.
 * @param {{ type: number, pos: number[] }} light
 * @param {{ lamps: number, braking: boolean, reverse: boolean, cockpit: boolean, night: boolean }} state
 *   `cockpit` is the viewer sitting in this truck's own cockpit, `night` the weather's lamps flag.
 */
export function lightIntensity(light, { lamps, braking, reverse, cockpit, night }) {
  switch (light.type) {
    case 0:
    case 3:
      return lamps === 2 ? 1 : 0;
    case 1:
      if (cockpit) return 0;
      // A lamp on the centre line (the cab's third brake light) shines only when braking.
      if (light.pos[0] === 0) return braking ? (lamps > 0 ? 1 : 0.6) : 0;
      return (braking ? 0.6 : 0) + (lamps > 0 ? 0.4 : 0);
    case 2:
      return !cockpit && lamps > 0 ? 1 : 0;
    case 5:
      return !cockpit && reverse ? 1 : 0;
    default:
      if (light.type < 0) return night ? 1 : 0;
      return lamps > 1 ? 1 : 0;
  }
}

/** A blinking lamp (`msOff` above 0) is on for `msOn` of every `msOn + msOff` milliseconds. */
export function blinkOn(light, ms) {
  if (!(light.msOff > 0)) return true;
  return ms % (light.msOn + light.msOff) < light.msOn;
}

/** A lamp's heading at `seconds`: a beacon turns by its spin speed. */
export const lampHeading = (light, seconds) => light.heading + light.spin * seconds;

/** The cone shows at night for a lit lamp that has a length; a lens bitmap needs the viewer in front of it. */
export function beamShows(light, intensity, night) {
  return night && intensity > 0 && light.coneLength > 0;
}

/** Is the viewer (in body axes) in the half space the lamp faces? Only the heading counts, as in the game. */
export function lensFacesViewer(light, viewer) {
  const dx = viewer[0] - light.pos[0], dz = viewer[2] - light.pos[2];
  return dx * Math.sin(light.heading) + dz * Math.cos(light.heading) > 0;
}

/*
  Lamps of the port's own, for "Truck lamps" (docs/VISUALS.md, "Lamps"). Which lamp a truck has
  and where is still the TRK's, and the lamp switch, the brakes and the gear still decide what is
  lit. What changes is how a lit lamp is drawn, and three things about when:

   - a headlight lights the ground whenever it is lit, not only in the weathers that light the
     lamps at the start (the Headlights key switched the lens and the beam, and left the light
     on the ground as the weather had it);
   - its beam is seen in the air by what there is in the air to show it: plainly in fog and at
     night, faintly in rain and snow, hardly at all on a clear day;
   - a tail lamp works as a car's does now: dim and steady with the lamps on, full and at once
     under the brakes whether the lamps are on or not.
*/

/**
 * A lit lamp's own colour, linear, by its type: a headlight's warm white, a tail or brake
 * lamp's red (the game's lamp art is a pink that no tail lamp is), a reversing lamp's white.
 * Null for a lamp of another kind, which keeps the colour of its own art.
 */
export function lampTone(light) {
  if (light.type === 0 || light.type === 3) return [1, 0.92, 0.8];
  if (light.type === 1) return [1, 0.045, 0.02];
  if (light.type === 5) return [1, 0.97, 0.92];
  return null;
}

/** With the lamps on and the brakes off a tail lamp burns at this share of its brake light. */
export const TAIL_RUNNING = 0.22;

/**
 * How bright a lamp is, 0 to 1, as `lightIntensity` but for the tail lamps: running at
 * `TAIL_RUNNING` with the lamp switch on, full under the brakes with it on or off. The cab's
 * third lamp, on the centre line, is a brake lamp only.
 */
export function lampLevel(light, state) {
  if (light.type !== 1) return lightIntensity(light, state);
  if (state.cockpit) return 0;
  if (state.braking) return 1;
  return light.pos[0] === 0 || !(state.lamps > 0) ? 0 : TAIL_RUNNING;
}

/**
 * How brightly a lit lamp's lens glows against the screen's white, for a lamp at `level` (0 to
 * 1) in a weather as light as `daylight` (game/weather.js `light`, 1 a clear day): a lamp is
 * several times white, so that the lens flares it (render/lens.js), and is seen less by day,
 * when there is a bright picture round it. A headlight is far brighter than a tail lamp.
 */
export function lensGlow(light, level, daylight = 1) {
  const full = light.type === 0 || light.type === 3 ? 7 : light.type === 1 ? 4.5 : 3;
  return level * full * (1 - 0.55 * Math.min(1, Math.max(0, daylight)));
}

/**
 * How much there is in the air to show a beam, by weather, against the dark of Night doubled: a beam of light is seen
 * from the side only by what it lights on its way. Fog shows it best, the dark shows what
 * little dust and damp there always is, rain and snow show it in part, and on a clear day
 * there is next to nothing to see.
 */
export const BEAM_AIR = Object.freeze({ 0: 0.04, 1: 0.08, 2: 1.3, 3: 1.7, 4: 0.6, 5: 0.7, 6: 0.4, 7: 0.5, 8: 0.55, 9: 0.04 });
export const beamAir = (weather) => BEAM_AIR[weather] ?? BEAM_AIR[0];

/**
 * How strongly a lit headlight lights the ground before it, against its strength in the dark
 * (render/weather-scene.js): by day the sun's own light drowns it.
 */
export const headlightReach = (daylight = 1) => Math.min(1, Math.max(0.06, 1.2 - 1.15 * daylight));

/** Whether a lamp is one that throws light ahead of the truck: a headlight or a roof lamp, with a cone. */
export const throwsBeam = (light) => (light.type === 0 || light.type === 3) && light.coneLength > 0;

/*
  The start gantry's lamps (MONSTER_EXE_ANALYSIS.md 6.1), as the port draws them with "Truck lamps". The game fills
  each lamp bar's texture with one palette colour: dark red through the countdown, then black, and the green bar black,
  then green. The port keeps when each is lit and draws the bar as a row of round lamps behind glass, lit far past
  white so the lens flares them, with a glow about each seen from in front, and in the dark a light of their colour on
  the ground and the trucks under the gantry.
*/
/**
 * `red` and `green` are the lit lamps' own colours, linear. A bar holds as many lamps as fit at `pitchFt` apart, each
 * `radiusFt` across its glass. A lit lamp's face is `face` times white at its middle and its glow `glow` (a tail lamp's
 * is 4.5, render/truck-object.js), both less by day as `lensGlow`. In the dark a light of the lit bar's colour, `light`
 * strong (a headlight's pool is 2.4), is thrown forward and down from the bar, out to `reachFt`.
 */
export const START_LAMPS = Object.freeze({
  red: Object.freeze([1, 0.045, 0.02]), green: Object.freeze([0.1, 1, 0.32]), pitchFt: 2.2, radiusFt: 0.72, face: 3, glow: 5, light: 2.2, reachFt: 70,
});
/** Which bar is lit, 0 or 1 each: the red through the countdown (`counting`), the green from the start, as the game has it. */
export const startLampsLit = (counting) => ({ red: counting ? 1 : 0, green: counting ? 0 : 1 });
/** How many lamps a bar `lengthFt` long holds. */
export const startLampCount = (lengthFt) => Math.max(1, Math.round(lengthFt / START_LAMPS.pitchFt));
/** How bright a lit start lamp's glow is against the screen's white, in a weather as light as `daylight`. */
export const startLampGlow = (lit, daylight = 1) => lit * START_LAMPS.glow * (1 - 0.55 * Math.min(1, Math.max(0, daylight)));
