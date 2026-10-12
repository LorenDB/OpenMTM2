/*
  The light by weather (docs/VISUALS.md, "Light"): the sun, the sky's light and the ground's,
  made from the level's own sun direction and sky art, and the curve bright light rolls off by.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GROUND, DEFAULT_TONES, SHADOW_CASCADE_ENDS_FT, SHADOW_FAR_FT, TONE_KNEE,
  lightRig, meanTone, skyTones, tileTones, sunDirection, toneCurve,
} from "../src/game/lighting.js";
import { WEATHER_LOOK } from "../src/game/weather.js";

const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
/** The stock levels' sun: 45 degrees up, from -x (LVL sun vector 46333, -46333, 0, the way the light travels). */
const TO_SUN = [-Math.SQRT1_2, Math.SQRT1_2, 0];
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} is not ${b}`);

test("a clear day's sun is strong and warm, its sky light blue, and level ground in it is lit about as its art is painted", () => {
  const rig = lightRig(0, { toSun: TO_SUN });
  assert.ok(rig.sun.color[0] > rig.sun.color[1] && rig.sun.color[1] > rig.sun.color[2], "a warm white");
  assert.ok(rig.sky[2] > rig.sky[1] && rig.sky[1] > rig.sky[0], "the sky's light is blue");
  // three.js lights a face by (sun * cosine + sky) / pi of its colour: about 1 here, so the game's ground art shows as painted.
  const level = (rig.sun.strength * luma(rig.sun.color) * TO_SUN[1] + luma(rig.sky)) / Math.PI;
  assert.ok(level > 0.95 && level < 1.2, `level ground: ${level}`);
  // In shadow only the sky's light is left: a fifth to a third of that, so a shadow is a shadow.
  const shade = luma(rig.sky) / Math.PI / level;
  assert.ok(shade > 0.2 && shade < 0.34, `in shadow: ${shade}`);
  assert.equal(rig.shadow, 1);
});

test("under cloud, fog, rain and snow the sun gives way to the sky and its shadows fade", () => {
  const clear = lightRig(0, { toSun: TO_SUN });
  for (const weather of [1, 2, 3, 4, 5]) {
    const rig = lightRig(weather, { toSun: TO_SUN });
    assert.ok(rig.sun.strength < clear.sun.strength * 0.5, `weather ${weather}: a weaker sun`);
    assert.ok(rig.shadow < 0.7 && rig.shadow > 0.1, `weather ${weather}: faint shadows`);
    // Most of the light is the sky's.
    assert.ok(luma(rig.sky) > rig.sun.strength * luma(rig.sun.color) * TO_SUN[1], `weather ${weather}: the sky lights more than the sun`);
  }
  assert.ok(lightRig(3, { toSun: TO_SUN }).shadow < lightRig(2, { toSun: TO_SUN }).shadow, "Dense Fog's shadows are fainter than Foggy's");
  // Rain is the darkest day, as the port already drew it (game/weather.js).
  const total = (weather) => { const r = lightRig(weather, { toSun: TO_SUN }); return r.sun.strength * luma(r.sun.color) * TO_SUN[1] + luma(r.sky); };
  for (const weather of [0, 1, 2, 3, 5]) assert.ok(total(4) < total(weather), `Rain is darker than weather ${weather}`);
  assert.equal(Math.min(...[0, 1, 2, 3, 4, 5].map((w) => WEATHER_LOOK[w].light)), WEATHER_LOOK[4].light);
});

test("Dusk has a low orange sun on the level's bearing; Night has the moon where the game draws it; Pitch Black has neither", () => {
  // The game says nothing of where the sun is at Dusk and draws no disc: the port has it 11 degrees up, on the level's bearing.
  const dusk = sunDirection(6, TO_SUN);
  near(Math.asin(dusk[1]) * 180 / Math.PI, 11, 1e-9);
  assert.ok(dusk[0] < 0 && Math.abs(dusk[2]) < 1e-12, "the same bearing");
  near(Math.hypot(...dusk), 1);
  const rig = lightRig(6, { toSun: TO_SUN });
  assert.ok(rig.sun.color[0] > rig.sun.color[1] * 1.6 && rig.sun.color[1] > rig.sun.color[2] * 1.6, "orange");
  assert.equal(rig.shadow, 1);
  // Every other weather keeps the level's own sun.
  for (const weather of [0, 1, 2, 3, 4, 5, 7, 8]) assert.deepEqual(sunDirection(weather, TO_SUN), TO_SUN.map((v) => v / Math.hypot(...TO_SUN)));
  // A sun straight overhead has no bearing: Dusk's still comes down to the horizon.
  near(sunDirection(6, [0, 1, 0])[1], Math.sin(11 * Math.PI / 180));
  // The moon stands where the sun does (the game draws MOON.RAW there): its light is blue and a fraction of the day's.
  const night = lightRig(7, { toSun: TO_SUN });
  assert.ok(night.sun.color[2] > night.sun.color[0] * 1.5);
  assert.ok(night.sun.strength < lightRig(0, { toSun: TO_SUN }).sun.strength * 0.3 && night.sun.strength > 0);
  const black = lightRig(8, { toSun: TO_SUN });
  assert.equal(black.sun.strength, 0);
  assert.equal(black.shadow, 0);
  assert.ok(luma(black.sky) < luma(night.sky) && luma(black.sky) > 0, "a trace of light, so shapes can be made out by the headlights");
});

test("the sky's light takes the colour of the level's sky art, and the ground throws back light in its own colour", () => {
  // A sky that is red overhead and white at the horizon: 4 x 4, the top row first.
  const rgba = new Uint8Array(4 * 4 * 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) rgba.set(y === 0 ? [255, 0, 0, 255] : y === 3 ? [255, 255, 255, 255] : [0, 255, 0, 255], (y * 4 + x) * 4);
  const tones = skyTones({ rgba, width: 4, height: 4 });
  assert.deepEqual(tones.zenith, [1, 0, 0], "the top quarter is overhead (the dome reads the top rows at 67.5 degrees)");
  assert.deepEqual(tones.horizon, [1, 1, 1], "the bottom fifth is the horizon");
  assert.deepEqual(skyTones(null), { zenith: [...DEFAULT_TONES.zenith], horizon: [...DEFAULT_TONES.horizon] });
  const red = lightRig(0, { zenith: tones.zenith, toSun: TO_SUN }), plain = lightRig(0, { toSun: TO_SUN });
  assert.ok(red.sky[0] > red.sky[2] * 1.5, "a red sky lights red");
  near(luma(red.sky), luma(plain.sky), 1e-9);
  // A sky that is black overhead (the night sky's art) has no colour to give: its light is white, at the weather's strength.
  const dark = lightRig(7, { zenith: [0, 0, 0], toSun: TO_SUN });
  near(dark.sky[0], dark.sky[2], 1e-12);
  near(luma(dark.sky), luma(lightRig(7, { toSun: TO_SUN }).sky), 1e-9);
  assert.ok(luma(dark.sky) > 0.15, "not lost with the colour");
  // sRGB bytes are read as the light they stand for.
  near(meanTone({ rgba: new Uint8Array([188, 188, 188, 255]), width: 1, height: 1 })[0], 0.5, 0.01);
  assert.deepEqual(meanTone(null), [...DEFAULT_GROUND]);
  // Each tile of the terrain's atlas has its own: two tiles of 4 texels with a texel of padding round each, in a row.
  const atlas = { width: 12, height: 6, tileSide: 4, padding: 1, slots: 2, rgba: new Uint8Array(12 * 6 * 4) };
  for (let y = 0; y < 6; y++) for (let x = 0; x < 12; x++) atlas.rgba.set(x < 6 ? [188, 0, 0, 255] : [0, 0, 188, 255], (y * 12 + x) * 4);
  // (The padding is not read: a texel of the other colour there would not change the means.)
  atlas.rgba.set([0, 255, 0, 255], (0 * 12 + 0) * 4);
  const [first, second] = tileTones(atlas);
  near(first[0], 0.5, 0.01);
  assert.equal(first[1] + first[2], 0);
  near(second[2], 0.5, 0.01);
  assert.equal(second[0] + second[1], 0);
  // Green ground under the same light sends green light up; no ground colour, no bounce.
  const green = lightRig(0, { ground: [0, 0.5, 0], toSun: TO_SUN });
  assert.ok(green.ground[1] > 0.3 && green.ground[0] === 0 && green.ground[2] === 0);
  // A higher sun puts more light on the ground, so more comes back.
  assert.ok(lightRig(0, { ground: [0.3, 0.3, 0.3], toSun: [0, 1, 0] }).ground[0] > lightRig(0, { ground: [0.3, 0.3, 0.3], toSun: [1, 0.2, 0] }).ground[0]);
  assert.deepEqual(lightRig(0, { ground: [0, 0, 0], toSun: TO_SUN }).ground, [0, 0, 0]);
});

test("a stadium is lit by its floodlights whatever the weather: white, from all round, with soft shadows", () => {
  const hall = lightRig(0, { toSun: TO_SUN, indoor: true }), open = lightRig(0, { toSun: TO_SUN });
  near(hall.sky[0], hall.sky[2], 1e-9);
  assert.ok(Math.abs(hall.sun.color[0] - hall.sun.color[2]) < 0.1, "white lamps");
  assert.ok(luma(hall.sky) > luma(open.sky) * 1.5 && hall.sun.strength < open.sun.strength * 0.6, "more of its light has no direction");
  assert.ok(hall.shadow > 0.3 && hall.shadow < 0.7, "a truck still stands on a shadow, a soft one");
  const level = (hall.sun.strength * luma(hall.sun.color) * TO_SUN[1] + luma(hall.sky)) / Math.PI;
  assert.ok(level > 0.9 && level < 1.15, `the floor is lit about as its art is painted: ${level}`);
  // The roof keeps the weather out: Dusk's low sun and Night's dark stay outside.
  for (const weather of [6, 7, 8]) {
    sunDirection(weather, TO_SUN, { indoor: true }).forEach((v, i) => near(v, TO_SUN[i], 1e-12));
    assert.deepEqual(lightRig(weather, { toSun: TO_SUN, indoor: true }), hall);
  }
});

test("lightning lifts every light for its instant and fades the sun's shadows", () => {
  const calm = lightRig(4, { toSun: TO_SUN }), flash = lightRig(4, { toSun: TO_SUN, flash: 1.6 });
  const lift = (WEATHER_LOOK[4].light + 1.6) / WEATHER_LOOK[4].light;
  near(flash.sun.strength, calm.sun.strength * lift);
  near(flash.sky[1], calm.sky[1] * lift);
  near(flash.shadow, calm.shadow / lift);
  // Never more than three times the daylight picture, as the weather scene caps its own lights.
  near(lightRig(4, { toSun: TO_SUN, flash: 100 }).sun.strength, calm.sun.strength * 3 / WEATHER_LOOK[4].light);
});

test("the tone curve shows a colour as it is up to the knee, and above it eases toward white without reaching it", () => {
  for (const color of [[0, 0, 0], [0.2, 0.4, 0.1], [TONE_KNEE, 0.3, 0.3]]) assert.deepEqual(toneCurve(color), color, "the game's art keeps its colours");
  let last = TONE_KNEE;
  for (let v = TONE_KNEE + 0.05; v < 40; v *= 1.3) {
    const out = toneCurve([v, v, v])[0];
    assert.ok(out > last && out < 1, `${v} -> ${out}`);
    last = out;
  }
  assert.ok(toneCurve([1, 1, 1])[0] > 0.82 && toneCurve([1, 1, 1])[0] < 0.9, "what was white is a little under white, leaving room above it");
  // No jump at the knee.
  near(toneCurve([TONE_KNEE + 1e-6, 0, 0])[0], TONE_KNEE, 1e-5);
  // A bright colour keeps its hue at first and pales as it nears the top, as a light does on film.
  const warm = toneCurve([1.2, 0.6, 0.3]), blown = toneCurve([30, 15, 7.5]);
  assert.ok(warm[0] > warm[1] && warm[1] > warm[2]);
  assert.ok(blown[1] / blown[0] > warm[1] / warm[0] + 0.2, "paler");
  assert.ok(Math.max(...blown) < 1);
});

test("the shadow cascades are drawn in close, so a truck's shadow is sharp", () => {
  assert.deepEqual([...SHADOW_CASCADE_ENDS_FT], [150, 560, 1900]);
  assert.ok(SHADOW_CASCADE_ENDS_FT.every((end, i) => i === 0 || end > SHADOW_CASCADE_ENDS_FT[i - 1] * 3));
  assert.ok(SHADOW_FAR_FT > SHADOW_CASCADE_ENDS_FT.at(-1) * 3 && SHADOW_FAR_FT < 8192, "shadows end before the next copy of the world");
});

test("a truck keeps the sky off the ground under it: darkest where the sun casts no shadow, gone when it is in the air", async () => {
  const { SHADE_DARKEST, SHADE_GONE_FT, contactShade } = await import("../src/game/lighting.js");
  assert.equal(SHADE_DARKEST, 0.5);
  assert.equal(SHADE_GONE_FT, 9);
  near(contactShade(0, 0), 0.5);
  // On a clear day the sun's own shadow does most of the work; in Dense Fog the shade does.
  const clear = contactShade(0, lightRig(0, { toSun: TO_SUN }).shadow), fog = contactShade(0, lightRig(3, { toSun: TO_SUN }).shadow);
  near(clear, 0.5 * 0.55);
  assert.ok(fog > clear * 1.5 && fog < 0.5);
  // It goes as the wheels leave the ground, and a truck sunk in snow shades as one standing.
  assert.ok(contactShade(3, 0) < contactShade(1, 0) && contactShade(1, 0) < contactShade(0, 0));
  assert.equal(contactShade(9, 0), 0);
  assert.equal(contactShade(40, 0), 0);
  near(contactShade(-2, 0), contactShade(0, 0));
});

test("paint mirrors little square on and half at a glance, rubber hardly at all; the lens glows only what is brighter than white", async () => {
  const { LENS, PAINT } = await import("../src/game/lighting.js");
  assert.deepEqual(PAINT, { faceOn: 0.04, glancing: 0.26, wet: 1.5, round: 0.5, bulge: [3.4, 3, 9.2], broadGlint: 0.03, parts: { body: 1, tire: 0, gear: 0.3 } });
  assert.equal(PAINT.parts.tire, 0, "rubber is matt: a tire mirrors nothing");
  // A flat face is taken as half way to the bulge of a body, so what it mirrors changes across it.
  assert.ok(PAINT.round > 0.3 && PAINT.round < 0.7 && PAINT.glancing < 0.35);
  assert.deepEqual(LENS, { glowFrom: 0.95, glowFull: 1.5, corners: 0.16, brightest: 24 });
  // Level ground in a clear day's sun is under the glow's start once through the curve's knee: the ground does not glow.
  const rig = lightRig(0, { toSun: TO_SUN });
  const sunlit = 0.5 * (rig.sun.strength * luma(rig.sun.color) * TO_SUN[1] + luma(rig.sky)) / Math.PI;
  assert.ok(sunlit < LENS.glowFrom, `mid-grey ground in the sun: ${sunlit}`);
});
