/*
  Per-browser preferences, kept in localStorage.

  Storage can be unavailable (private windows, blocked site data), so every access is guarded
  and the defaults always apply. Game data (the install, driver profiles, the Hall of Fame)
  lives in OPFS instead, through the workers.
*/

const KEY = "openmtm2.settings";

/**
 * The physics a race can run under, as Options (Game) and the console's `physics` list them. A model is one more entry
 * here and its rules in the simulation (OpenPhotex `simRules`). "mtm1" is Monster Truck Madness 1.00's differences
 * from MTM2 as read from its executable (MTM1_MONSTER_EXE_ANALYSIS.md 4.3), and its drag pass rules (7.2).
 */
export const PHYSICS_MODELS = Object.freeze([
  Object.freeze({ id: "mtm2", label: "Monster Truck Madness 2", note: "The 1998 game's" }),
  Object.freeze({ id: "mtm1", label: "Monster Truck Madness", note: "The 1996 game's: tires that touch throw trucks twice as hard, water stops a truck, no deep water, weather does not change the grip, no crash damage, and its own drag rules" }),
]);
/** A physics model by id; an unknown id is the first, MTM2's. */
export const physicsModel = (id) => PHYSICS_MODELS.find((m) => m.id === id) ?? PHYSICS_MODELS[0];

export const DEFAULT_SETTINGS = Object.freeze({
  look: "enhanced",           // "classic" or "enhanced"
  view: 1,                    // the camera view the race starts in (the exe's modes 0 to 9)
  units: "mph",               // the gauges' speed unit: "mph" or "kph"
  dashboard: true,            // the chase view's speedometer and tachometer (the Dashboard key toggles them)
  finder: true,               // the checkpoint finder ring in the cockpit, BlimpCam and RaceCam views (the Finder key)
  minimap: false,             // the course map (the Map key toggles it)
  detailLevel: 2,             // MONSTER.INI detailLevel: boxes with a higher priority are not drawn
  difficulty: 1,              // 0 Rookie, 1 Intermediate, 2 Professional
  laps: 3,
  weather: 0,                 // 0 Clear ... 8 Pitch Black, or "random" (a track may not allow it)
  opponents: 3,               // MONSTER.INI defaultOpponents (built-in default 3)
  opponentTrucks: Object.freeze([]), // explicitly selected CPU truck files from the Races dialog
  wording: "",                // a .LOC from the install that rewords the game's text ("" is the standard wording)
  skin: "auto",               // "auto" (classic on retail and beta builds, modern on a community patch), "classic" or "modern"
  developer: false,           // list tracks and trucks with the developer views on the Start screen
  sound: Object.freeze({ master: 1, effects: 1, music: 0.8, muted: false }),
  commentary: false,          // reserved for commentaryFlag; voice playback is temporarily disabled
  menuMusic: true,            // the menus play SOUND\\SPLASH.WAV from MUSIC.POD
  kookyHorn: false,           // MONSTER.INI kookyHorn: three horns instead of one
  crashDamage: true,          // MONSTER.INI allowCrashDamage (the game's own default is off): collisions dent the bodies
  autoShift: true,            // automatic gears (the game's default)
  bindings: Object.freeze({}), // key code overrides by action, see game/input/bindings.js
  mtm1EarthSky: true,         // MTM1 tracks: their own flat sky (EARTHSKY and the like) in place of MTM2's dome
  mtm1TerrainOverlap: false,  // MTM1 tracks: MTM2's two-pixel overlap of the ground tiles
  vsync: true,                // draw with the display's refresh; off draws as fast as the browser allows
  fpsLimit: false,            // hold the frame rate to `fpsLimitValue`
  fpsLimitValue: 60,
  opponentFps: 30,            // the frame rate the computer trucks drive as if the game ran at (the 1998 game's is about 30)
  timingHud: true,            // the times, laps and place in the corner (the Timing display key, O, switches them in every view)
  shortViewCycle: false,      // the Camera key steps through the cockpit, Chase Near and Chase Far only
  zModeCameras: false,        // Z mode's zoom and cameras in any race, without GOLD or slew mode, and the Inertia view
  fullAutopilot: false,       // the game's "Full Autopilot": the player's truck drives itself
  autoStage: true,            // drag races: the player's truck stages itself (off: stage it by hand, or press the Auto Stage key)
  dustEffects: true,          // MONSTER.INI smokeEffectFlag: dust puffs behind the wheels on soft ground
  tireTracks: true,           // MONSTER.INI tireTrackFlag: treads left on soft ground (the game reads it but never draws them)
  waterSplash: true,          // drops thrown up where wheels run through water, more with speed (not in the game)
  sparks: true,               // sparks from hull contacts (not in the game)
  sonicTrucks: false,         // Professional only: the computer trucks drive as on a Sonic track, whatever the SIT's fly-by line says
  defaultOpponents: 3,        // computer trucks in a race until the player picks their own (MONSTER.INI defaultOpponents)
  drawCells: 128,             // terrain cells (32 ft each): how far the world is drawn (the camera's far plane and the fog)
  backdrops: false,           // the SIT's backdrop models behind the world (off by default)
  terrainDetail: true,        // Community Patch 3: the terrain's detail normals where a track paints a mask, and HD tiles' normal maps
  reflections: true,          // Community Patch 3: the sky reflected in materials that ask for it (glass, paint)
  showHiddenTracks: true,     // the two hidden tracks are listed unless this is turned off
  vr: Object.freeze({}),      // the headset's preferences, see game/vr/settings.js (docs/VR.md)
  offline: true,              // keep a copy of the app in the browser, to start without a server (app/offline.js)
  physics: "mtm2",            // the physics model, one of PHYSICS_MODELS
  flyControls: "traxx",       // how the fly-by camera is flown: "traxx" (JSTrackViewer's), "tv" (Terminal Velocity) or "hb" (Hellbender)
});

export function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    // Version 2 made the enhanced look the default and version 3 listed the hidden tracks; what was saved
    // before them was never a choice.
    if (!(stored.version >= 2)) stored.look = "enhanced";
    if (!(stored.version >= 3)) stored.showHiddenTracks = true;
    // Version 4 made the menus follow the build unless the player picks one.
    if (!(stored.version >= 4)) stored.skin = "auto";
    // Version 5 counts the draw distance in terrain cells, 128 the standard; the feet saved before are dropped.
    if (!(stored.version >= 5)) delete stored.drawDistance;
    stored.version = 5;
    delete stored.showHiddenTrucks;
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Not persisted; the session keeps working with what it has.
  }
}

export function clearSettings(storage = globalThis.localStorage) {
  try {
    storage.removeItem(KEY);
  } catch {
    // The OPFS data can still be cleared when local storage is unavailable.
  }
}
