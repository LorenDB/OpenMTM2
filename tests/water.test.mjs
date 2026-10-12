/*
  The water as a body of water (docs/VISUALS.md, "Water" and "Under water"), with "Reflective
  water": light passes through its depth, and what it sends back is the daylight in it.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  SNELL_WINDOW, UNDERWATER, WATER_BED, WATER_INDEX, WATER_RIPPLES, WATER_SCATTER, WATER_SILT, WATER_TAKES, landingStir, waterHides, waterPasses, waterPathFt,
  PUDDLE_FILL_DROP_FT, puddleStir, waveSpeed, wheelStir,
} from "../src/game/water.js";
import { SUBMERGED_FT } from "../src/game/particles.js";

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} is not ${b}`);

test("water takes the red out of light first and the blue last", () => {
  assert.ok(WATER_TAKES[0] > WATER_TAKES[1] && WATER_TAKES[1] > WATER_TAKES[2]);
  const [r, g, b] = waterPasses(4);
  assert.ok(r < g && g < b);
  assert.deepEqual(waterPasses(0), [1, 1, 1]);
  assert.deepEqual(waterPasses(-3), [1, 1, 1]);
  near(waterPasses(1)[0], Math.exp(-WATER_TAKES[0]));
});

test("a little water shows what is under it, a truck's depth mostly hides it, deep water hides it all", () => {
  assert.equal(waterHides(0), 0);
  assert.ok(waterHides(1) < 0.2, `a foot: ${waterHides(1)}`);
  assert.ok(waterHides(6) > 0.5, `a truck's depth: ${waterHides(6)}`);
  assert.ok(waterHides(30) > 0.95, `deep: ${waterHides(30)}`);
  for (let d = 0; d < 40; d += 0.5) assert.ok(waterHides(d + 0.5) > waterHides(d), `at ${d}`);
});

test("the surface bends a line of sight toward the upright: a glancing look runs through about one and a half times the depth", () => {
  assert.equal(WATER_INDEX, 1.333);
  near(waterPathFt(5, 1), 5);
  const glancing = waterPathFt(5, 0);
  assert.ok(glancing > 7.4 && glancing < 7.6, `glancing ${glancing}`);
  assert.ok(waterPathFt(5, 0.5) > 5 && waterPathFt(5, 0.5) < glancing);
  assert.equal(waterPathFt(-2, 1), 0);
});

test("what water sends back is the daylight in it, in the water's own blue green, and duller when Rain silts it", () => {
  const [r, g, b] = WATER_SCATTER;
  assert.ok(r < g / 5 && g > 0 && b > 0 && Math.max(r, g, b) < 0.2, "dark and blue green: the scene's light scales it");
  assert.ok(WATER_SILT > 0 && WATER_SILT < 1);
});

test("from under water the sky is seen through a window of 48.6 degrees about straight up", () => {
  near(Math.acos(SNELL_WINDOW), Math.asin(1 / WATER_INDEX));
  assert.ok(Math.abs((Math.asin(1 / WATER_INDEX) * 180) / Math.PI - 48.6) < 0.05);
});

test("under water the eye sees less far than the game's own fog, and daylight has lost its red; the picture does not sway", () => {
  // The game's underwater fog ends at 320 ft (game/weather.js); the port's water is murkier.
  assert.ok(UNDERWATER.sightFt > 100 && UNDERWATER.sightFt < 320);
  assert.equal(UNDERWATER.sway, undefined);
  const [r, g, b] = UNDERWATER.tint;
  assert.ok(r < g && r < b && Math.max(r, g, b) <= 1);
  assert.ok(UNDERWATER.corners > 0 && UNDERWATER.corners < 1);
});

test("light dances on a shallow bed, and the shore just over the water is wet", () => {
  assert.ok(WATER_BED.caustics > 0 && WATER_BED.caustics <= 0.5 && WATER_BED.causticsToFt > 3);
  assert.ok(WATER_BED.wetShoreFt > 0 && WATER_BED.wetShoreFt < 2 && WATER_BED.wetShore > 0 && WATER_BED.wetShore < 0.5);
});

test("waves on the water run as on shallow water, slower in the shallows, and the field keeps them steady", () => {
  // sqrt(g d): a foot of water runs them at under 6 ft/s; deep water at the fastest.
  near(waveSpeed(1), Math.sqrt(32.17));
  assert.equal(waveSpeed(0), 0);
  assert.equal(waveSpeed(-3), 0);
  assert.equal(waveSpeed(100), WATER_RIPPLES.fastestFtPerS);
  // A wave crosses less than a point of the field in a step, as the wave equation needs to stay steady (under 1 / sqrt 2).
  assert.ok((WATER_RIPPLES.fastestFtPerS * WATER_RIPPLES.stepS) / WATER_RIPPLES.texelFt < Math.SQRT1_2);
  // A truck at speed outruns them, so its wake is a V behind it.
  assert.ok(WATER_RIPPLES.fastestFtPerS < 30);
  // The field is some three hundred feet across round the eye, a point every few inches.
  assert.ok(WATER_RIPPLES.windowTexels * WATER_RIPPLES.texelFt > 250 && WATER_RIPPLES.texelFt <= 1);
});

test("a wheel at the surface pushes the water down, more the faster it goes; one clear of it or deep under it does not", () => {
  const level = 100, r = 2.75;
  const rolling = (hubFt, speedFtS) => wheelStir({ hubFt, radiusFt: r, levelFt: level, speedFtS });
  // Half in the water.
  assert.ok(rolling(level, 0).depthFt > 0.1);
  assert.ok(rolling(level, 40).depthFt > rolling(level, 10).depthFt);
  assert.ok(rolling(level, 200).depthFt <= 0.9);
  // Clear of it, and wholly under it by more than a foot and a half past where a wheel counts as under (SUBMERGED_FT).
  assert.equal(rolling(level + r + 0.5, 40).depthFt, 0);
  assert.equal(rolling(level - r - 2.5, 40).depthFt, 0);
  assert.ok(rolling(level - r - SUBMERGED_FT, 40).depthFt > 0, "just under, it still stirs the surface a little");
  assert.ok(rolling(level - r - SUBMERGED_FT, 40).depthFt < rolling(level, 40).depthFt);
  // It churns foam only at speed.
  assert.equal(rolling(level, 5).foam, 0);
  assert.ok(rolling(level, 40).foam > 0.9);
});

test("a wheel that comes down into the water throws a ring out from where it struck, the harder the bigger", () => {
  assert.equal(landingStir(3), null);
  assert.ok(landingStir(30).depthFt > landingStir(8).depthFt);
  assert.ok(landingStir(1000).depthFt <= 2.5);
  assert.ok(landingStir(30).foam >= 1 && landingStir(8).foam < 1);
});

test("a wheel stirs a puddle it runs through, a puddle's own scale: rings and a bow of an inch or two", () => {
  // Too shallow to hold a wave: nothing.
  assert.equal(puddleStir({ depthFt: 0.005, speedFtS: 30 }).depthFt, 0);
  const deep = puddleStir({ depthFt: 0.2, speedFtS: 30 });
  assert.ok(deep.depthFt > 0.1 && deep.depthFt <= 0.3);
  assert.ok(puddleStir({ depthFt: 0.2, speedFtS: 60 }).depthFt >= deep.depthFt);
  assert.ok(puddleStir({ depthFt: 0.2, speedFtS: 0 }).depthFt < deep.depthFt);
  // Less than a lake's, and the stirred water churns only at speed.
  assert.ok(deep.depthFt < wheelStir({ hubFt: 100, radiusFt: 2.75, levelFt: 100, speedFtS: 30 }).depthFt);
  assert.equal(puddleStir({ depthFt: 0.2, speedFtS: 3 }).foam, 0);
  assert.ok(deep.foam > 0.9);
  // Its waves run at a puddle's pace: a tenth of a foot of water carries them under two feet a second.
  assert.ok(waveSpeed(0.1) < 2);
  // A puddle still filling stands a tenth of a foot under its full level.
  assert.equal(PUDDLE_FILL_DROP_FT, 0.1);
});
