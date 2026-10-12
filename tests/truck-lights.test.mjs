import test from "node:test";
import assert from "node:assert/strict";
import {
  BEAM_AIR, TAIL_RUNNING, beamAir, beamShows, blinkOn, headlightReach, lampHeading, lampLevel, lampTone, lampsAtStart, lensFacesViewer, lensGlow,
  START_LAMPS, lightIntensity, startLampCount, startLampGlow, startLampsLit, throwsBeam, toggleLamps,
} from "../src/game/truck-lights.js";
import { WEATHER_LOOK } from "../src/game/weather.js";

const off = { lamps: 0, braking: false, reverse: false, cockpit: false, night: false };
const lit = { ...off, lamps: 2, night: true };

test("the lamp switch starts on at dusk and night and the key toggles it", () => {
  assert.equal(lampsAtStart(true), 2);
  assert.equal(lampsAtStart(false), 0);
  assert.equal(toggleLamps(0), 2);
  assert.equal(toggleLamps(2), 0);
});

test("headlights follow the switch, also from the cockpit", () => {
  const head = { type: 0, pos: [1, 2, 3] };
  assert.equal(lightIntensity(head, off), 0);
  assert.equal(lightIntensity(head, lit), 1);
  assert.equal(lightIntensity(head, { ...lit, cockpit: true }), 1);
});

test("side brake lamps glow dim with the lamps, 0.6 braking, full both", () => {
  const side = { type: 1, pos: [-3, 2, -9] };
  assert.equal(lightIntensity(side, off), 0);
  assert.equal(lightIntensity(side, { ...off, braking: true }), 0.6);
  assert.equal(lightIntensity(side, { ...off, lamps: 2 }), 0.4);
  assert.equal(lightIntensity(side, { ...lit, braking: true }), 1);
  assert.equal(lightIntensity(side, { ...off, braking: true, cockpit: true }), 0);
});

test("the centre brake lamp lights only when braking", () => {
  const centre = { type: 1, pos: [0, 4.5, 0] };
  assert.equal(lightIntensity(centre, lit), 0);
  assert.equal(lightIntensity(centre, { ...off, braking: true }), 0.6);
  assert.equal(lightIntensity(centre, { ...lit, braking: true }), 1);
});

test("reverse lamps need reverse gear; other types follow the switch", () => {
  assert.equal(lightIntensity({ type: 5, pos: [0, 0, 0] }, { ...off, reverse: true }), 1);
  assert.equal(lightIntensity({ type: 5, pos: [0, 0, 0] }, off), 0);
  assert.equal(lightIntensity({ type: 4, pos: [0, 0, 0] }, lit), 1);
  assert.equal(lightIntensity({ type: 4, pos: [0, 0, 0] }, off), 0);
  assert.equal(lightIntensity({ type: 2, pos: [0, 0, 0] }, lit), 1);
  assert.equal(lightIntensity({ type: -1, pos: [0, 0, 0] }, { ...off, night: true }), 1);
});

test("blinking, beacon spin, beams and which side a lens faces", () => {
  const blink = { msOn: 300, msOff: 700 };
  assert.equal(blinkOn(blink, 100), true);
  assert.equal(blinkOn(blink, 300), false);
  assert.equal(blinkOn(blink, 1100), true);
  assert.equal(blinkOn({ msOn: 0, msOff: 0 }, 5000), true);
  assert.equal(lampHeading({ heading: 1, spin: -Math.PI * 2 }, 0.25), 1 - Math.PI / 2);
  assert.equal(beamShows({ coneLength: 75 }, 1, true), true);
  assert.equal(beamShows({ coneLength: 75 }, 1, false), false);
  assert.equal(beamShows({ coneLength: 0 }, 1, true), false);
  // A rear lamp (heading pi) is seen from behind the truck, not from the front.
  const rear = { pos: [0, 0, -9], heading: Math.PI };
  assert.equal(lensFacesViewer(rear, [0, 3, -30]), true);
  assert.equal(lensFacesViewer(rear, [0, 3, 30]), false);
});

/* The port's own lamps, with "Truck lamps" (docs/VISUALS.md, "Lamps"). */

test("a tail lamp runs dim with the lamps on and burns full under the brakes, lamps on or off", () => {
  const side = { type: 1, pos: [-3, 2, -9] }, centre = { type: 1, pos: [0, 5, -6] };
  assert.equal(TAIL_RUNNING, 0.22);
  assert.equal(lampLevel(side, off), 0);
  assert.equal(lampLevel(side, lit), TAIL_RUNNING);
  assert.equal(lampLevel(side, { ...off, braking: true }), 1);
  assert.equal(lampLevel(side, { ...lit, braking: true }), 1);
  // The cab's third lamp is a brake lamp only; from the cockpit no tail lamp is seen.
  assert.equal(lampLevel(centre, lit), 0);
  assert.equal(lampLevel(centre, { ...off, braking: true }), 1);
  assert.equal(lampLevel(side, { ...lit, braking: true, cockpit: true }), 0);
  // Every other lamp is lit as the game lights it.
  for (const type of [0, 2, 3, 5, -1, 7]) {
    const lamp = { type, pos: [1, 2, 3] };
    for (const state of [off, lit, { ...lit, reverse: true }]) assert.equal(lampLevel(lamp, state), lightIntensity(lamp, state), `type ${type}`);
  }
});

test("a lamp glows in its own colour: headlights warm white, tail lamps red, reversing lamps white", () => {
  const [r, g, b] = lampTone({ type: 1 });
  assert.ok(r === 1 && g < 0.1 && b < g, "a deep red, not the art's pink");
  for (const type of [0, 3]) assert.ok(lampTone({ type })[2] < lampTone({ type })[0], "warm");
  assert.ok(Math.min(...lampTone({ type: 5 })) > 0.9);
  assert.equal(lampTone({ type: 2 }), null, "another kind keeps its art's colour");
});

test("a lit lens glows past white so the lens flares it, a headlight most, and less by day", () => {
  const head = { type: 0 }, tail = { type: 1 };
  assert.ok(lensGlow(head, 1, 0) > lensGlow(tail, 1, 0) && lensGlow(tail, 1, 0) > 1);
  assert.ok(lensGlow(head, 1, 1) < lensGlow(head, 1, 0.1));
  assert.ok(lensGlow(tail, TAIL_RUNNING, 0) < lensGlow(tail, 1, 0) / 3);
  assert.equal(lensGlow(head, 0, 0), 0);
});

test("a beam is seen by what is in the air: plainly in fog and at night, faintly in rain and snow, hardly on a clear day", () => {
  assert.ok(BEAM_AIR[3] > BEAM_AIR[2] && BEAM_AIR[2] > BEAM_AIR[5] && BEAM_AIR[5] > BEAM_AIR[4]);
  for (const dark of [6, 7, 8]) assert.ok(BEAM_AIR[dark] > BEAM_AIR[0] * 5 && BEAM_AIR[dark] < BEAM_AIR[2], `weather ${dark}`);
  assert.ok(BEAM_AIR[0] <= 0.05 && BEAM_AIR[1] < 0.1);
  assert.equal(beamAir(99), BEAM_AIR[0]);
  // A headlight lights the ground before it whenever it is on: fully in the dark, hardly in the sun.
  assert.equal(headlightReach(WEATHER_LOOK[8].light), 1);
  assert.ok(headlightReach(WEATHER_LOOK[7].light) > 0.85);
  assert.ok(headlightReach(1) > 0 && headlightReach(1) < 0.1);
  // Headlights and roof lamps with a cone throw a beam; nothing else does.
  assert.equal(throwsBeam({ type: 0, coneLength: 40 }), true);
  assert.equal(throwsBeam({ type: 3, coneLength: 40 }), true);
  assert.equal(throwsBeam({ type: 0, coneLength: 0 }), false);
  assert.equal(throwsBeam({ type: 1, coneLength: 40 }), false);
});

test("the start gantry's red bar is lit through the countdown and the green from the start, as the game has it", () => {
  // MONSTER_EXE_ANALYSIS.md 6.1: red filled with index 1 while the countdown runs and 0 after; green 0, then 2.
  assert.deepEqual(startLampsLit(true), { red: 1, green: 0 });
  assert.deepEqual(startLampsLit(false), { red: 0, green: 1 });
});

test("a start lamp bar is a row of round lamps, lit past white, glowing less by day", () => {
  // The stock bar is some 13 ft long: six lamps 2.2 ft apart, each 1.44 ft across in a bar 2 ft tall.
  assert.equal(startLampCount(13.06), 6);
  assert.equal(startLampCount(0.5), 1);
  assert.ok(START_LAMPS.radiusFt * 2 < 2 && START_LAMPS.radiusFt * 2 < START_LAMPS.pitchFt);
  // Red and green, each wholly its own colour.
  assert.ok(START_LAMPS.red[0] === 1 && START_LAMPS.red[1] < 0.1 && START_LAMPS.red[2] < 0.1);
  assert.ok(START_LAMPS.green[1] === 1 && START_LAMPS.green[0] < 0.2 && START_LAMPS.green[2] < 0.5);
  // Past white so the lens flares them, brighter than a tail lamp's glow, and less so by day.
  assert.ok(START_LAMPS.face > 1);
  assert.ok(startLampGlow(1, 0) > lensGlow({ type: 1 }, 1, 0));
  assert.ok(startLampGlow(1, 1) < startLampGlow(1, 0) && startLampGlow(1, 1) > 1);
  assert.equal(startLampGlow(0, 0), 0);
  // In the dark, their light reaches the trucks on the grid under the gantry.
  assert.ok(START_LAMPS.light > 0 && START_LAMPS.reachFt >= 50);
});
