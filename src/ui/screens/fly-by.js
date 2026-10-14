/*
  Fly-by (not the game's): the selected track with no truck and no race on it, and a camera to fly
  through it (game/fly-camera.js). The track is drawn as the race draws it: its sky and weather, its
  moving models, its music and ambience, the sun's shadows and flare in the enhanced look.

  Three ways of flying (game/input/fly-controls.js): Traxx (JSTrackViewer's keys and mouse),
  Terminal Velocity and Hellbender. C goes round them, as do Options, Controls and the console's
  `flycontrols`. Escape pauses; the console (the key left of 1) has only what makes sense here.
*/
import * as THREE from "three";
import { WATERMARK } from "../../app/version.js";
import { saveSettings } from "../../app/settings.js";
import { createAudio } from "../../audio/audio-engine.js";
import { createWorldAudio } from "../../audio/world-audio.js";
import { groundHeightFn } from "../../game/cameras.js";
import { FLY_SCHEMES, FLY_SCHEME_NAMES } from "../../game/fly-camera.js";
import { FLY_HELP } from "../../game/input/fly-controls.js";
import { createFlyController } from "../fly-controller.js";
import { createLevelMovers } from "../../game/level-movers.js";
import { soundRange } from "../../game/sound-model.js";
import { WEATHER_NAMES, isUnderwater, resolveWeather, waterOffsetFt } from "../../game/weather.js";
import { loadFont } from "../../render/bitmap-text.js";
import { createCaption } from "../../render/caption.js";
import { SunFlare } from "../../render/sun-flare.js";
import { createTrackWorld, disposeObject, moveObjects, skyColor, updateSky, updateTrackWorld, placeSky } from "../../render/track-scene.js";
import { createWaterSurface } from "../../render/water-effects.js";
import { toSceneMatrix, wrapFt } from "../../shared/scene-frame.js";
import { createWeatherScene } from "../../render/weather-scene.js";
import { terrainOfBuild } from "../../shared/build-terrain.js";
import { CONSOLE_KEYS, createConsole, distanceCommand } from "../console.js";
import { el } from "../dom.js";

const TERRAIN_CELL_FT = 32;
/** Where the camera starts: this far behind the course's first point and this high above the ground, ft. */
const START_BACK_FT = 60;
const START_UP_FT = 40;

export default async function mount(container, context, params) {
  const { track } = params;
  const t = context.t;
  const leave = () => context.router.go("race-select", { mode: track?.raceType }, { replace: true });
  const canvas = el("canvas", { class: "race-canvas" });
  const loading = el("div", { class: "race-loading" }, el("p", { class: "race-loading-text" }, `Loading ${track.name}…`));
  const pauseMenu = el("div", { class: "race-pause", hidden: true });
  const caption = createCaption(await loadFont(context.assets, "FNT2_480"));
  const view = el("section", { class: "race-view" }, canvas, caption.element, pauseMenu, loading);
  container.append(view);

  let disposed = false;
  const cleanups = [];
  const release = (f) => { try { f(); } catch (error) { console.error(error); } };
  const unmount = () => {
    if (disposed) return;
    disposed = true;
    for (const f of cleanups.splice(0).reverse()) release(f);
  };

  let weatherId = resolveWeather(params.weather ?? context.settings.weather ?? 0, track.weatherMask);
  const mtm1Options = { sky: context.settings.mtm1EarthSky !== false, overlap: !!context.settings.mtm1TerrainOverlap };
  let build;
  try {
    build = await context.assets.call("trackRender", {
      path: track.path, scope: track.scope, detailLevel: context.settings.detailLevel, raceType: track.raceType,
      truckFiles: [], weather: weatherId, mtm1: mtm1Options, tileOverlap: params.tileOverlap, smoothTiles: context.settings.look === "enhanced",
    });
  } catch (error) {
    console.error(error);
    loading.replaceChildren(el("p", { class: "race-loading-text" }, `${track.name} could not be loaded: ${error?.message ?? error}`),
      el("button", { onclick: leave }, "Back"));
    return { unmount };
  }
  if (disposed) return { unmount };

  const look = context.settings.look === "enhanced" ? "enhanced" : "classic";
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  const scene = new THREE.Scene();
  let drawnCells = Math.max(16, Math.min(256, context.settings.drawCells ?? 128));
  const drawDistance = drawnCells * TERRAIN_CELL_FT;
  const BASE_FOV = 60;
  const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.5, drawDistance);
  const background = skyColor(build.sky);
  scene.background = background;
  scene.fog = new THREE.Fog(background, 2500, 7000);
  const v = build.sunVector ?? [46333, -46333, 0];
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-v[0], -v[1], v[2]).normalize();
  const sunTravel = sun.position.clone().negate();
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
  scene.add(sun, ambientLight);
  const world = createTrackWorld(build, look, {
    backdrops: !!context.settings.backdrops, drawDistance,
    terrainDetail: context.settings.terrainDetail !== false, reflections: context.settings.reflections !== false,
  });
  scene.add(world);
  cleanups.push(() => { disposeObject(scene); renderer.dispose(); });

  // Sound: the world's ambience and music, heard from the camera.
  context.menuMusic?.stop();
  const audio = context.menuAudio ?? createAudio(context.assets, context.settings.sound);
  const ownsAudio = !context.menuAudio;
  const ambience = await context.assets.call("ambience", { number: track.ambientSound ?? 0 }).catch(() => null);
  const worldAudio = createWorldAudio(audio, { ambient: ambience, weather: weatherId, music: build.musicName ?? null, objects: build.soundObjects });
  audio.resume();
  const resumeAudio = () => audio.resume();
  window.addEventListener("keydown", resumeAudio);
  window.addEventListener("pointerdown", resumeAudio);
  audio.setEffectsPaused?.(false);
  audio.setRange?.(soundRange(weatherId));
  cleanups.push(() => {
    audio.setEffectsPaused?.(false);
    window.removeEventListener("keydown", resumeAudio);
    window.removeEventListener("pointerdown", resumeAudio);
    worldAudio.dispose();
    if (ownsAudio) audio.dispose();
    context.menuMusic?.start();
  });

  let flare = null;
  const effectsArt = await context.assets.call("effectsArt").catch(() => null);
  const weatherScene = createWeatherScene({
    scene, camera, world, sun, ambient: ambientLight, skyAverage: background, look, drawDistance, backdrops: !!context.settings.backdrops,
    art: effectsArt, onLightning: () => worldAudio.thunder(),
  });
  // The water as the race draws it: its animated surface, rising and falling with the weather.
  const water = world.getObjectByName("water");
  const waterSurface = createWaterSurface(water, effectsArt, look);
  cleanups.push(() => waterSurface?.dispose());
  let waterClock = 0;
  weatherScene.set(weatherId);
  cleanups.push(() => weatherScene.dispose());
  const celestial = (weather) => (weather <= 1 ? "sun" : weather === 7 ? "moon" : "none");
  if (look === "enhanced") {
    const data = await context.assets.call("flare").catch(() => null);
    if (data) { flare = new SunFlare(world, data); flare.setMode(celestial(weatherId)); cleanups.push(() => flare.dispose()); }
  }
  const setWeather = async (next) => {
    weatherId = next;
    updateSky(world.getObjectByName("sky"), await context.assets.call("sky", { path: track.path, scope: track.scope, weather: next, mtm1: mtm1Options }), look);
    weatherScene.set(next);
    audio.setRange?.(soundRange(next));
    worldAudio.setWeather(next);
    flare?.setMode(celestial(next));
  };

  // The camera starts behind the course's first point, looking along it; without a course, at the middle of the world.
  const terrain = terrainOfBuild(build);
  const groundAt = groundHeightFn(terrain);
  // The level's moving objects (trains): no simulation runs here, so the fly-by steps them (game/level-movers.js).
  const movers = createLevelMovers(build.sim, terrain);
  const movedPositions = new Map();
  const first = build.viewpoint?.start ?? [4096, 0, 4096];
  const ahead = build.viewpoint?.end ?? [first[0], first[1], first[2] + 100];
  const yaw = Math.atan2(ahead[0] - first[0], ahead[2] - first[2]);
  const say = (text, seconds = 5) => caption.show(text, seconds);
  let paused = false;
  let gameConsole = null;
  const flyer = createFlyController({
    canvas, settings: context.settings, save: () => saveSettings(context.settings), course: build.sim.course, courseOpen: !!build.sim.courseOpen,
    groundAt, say, blocked: () => paused || !!gameConsole?.open, baseFov: BASE_FOV,
  });
  const fly = flyer.fly;
  const startAt = [first[0] - Math.sin(yaw) * START_BACK_FT, 0, first[2] - Math.cos(yaw) * START_BACK_FT];
  startAt[1] = groundAt(startAt[0], startAt[2]) + START_UP_FT;
  flyer.place(startAt, yaw, -0.12);
  flyer.setEnabled(true);
  view.append(flyer.element);
  cleanups.push(() => flyer.dispose());

  const setPaused = (on) => {
    paused = on;
    pauseMenu.hidden = !on;
    flyer.release();
    audio.setEffectsPaused?.(on);
  };
  pauseMenu.append(
    el("p", { class: "race-pause-title" }, t("Pause")),
    el("button", { class: "primary", onclick: () => setPaused(false) }, "Resume"),
    el("button", { onclick: () => gameConsole?.setOpen(true) }, "Console"),
    el("button", { onclick: async () => {
      const { openOptionsModal } = await import("./options.js");
      await openOptionsModal(context);
      context.optionsDialog?.addEventListener("close", () => {
        audio.setVolumes(context.settings.sound);
        if (context.settings.flyControls !== flyer.scheme) flyer.setScheme(context.settings.flyControls);
      }, { once: true });
    } }, "Options"),
    el("button", { "data-menu-sound": "STARTOFF", onclick: leave }, "End fly-by"),
  );

  const onKeyDown = (event) => {
    if (gameConsole?.open || CONSOLE_KEYS.includes(event.code)) return;
    if (event.code === "Escape") { event.preventDefault(); setPaused(!paused); }
  };
  window.addEventListener("keydown", onKeyDown);
  cleanups.push(() => window.removeEventListener("keydown", onKeyDown));

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  cleanups.push(() => observer.disconnect());

  // The console: only what a fly-by can do. A race's commands (opponents, laps, skill, truck...) are not there.
  const weatherNames = WEATHER_NAMES.map((n) => n.toLowerCase().replace(/\s+/g, ""));
  const onOff = (word) => (/^(1|on)$/i.test(word ?? "") ? true : /^(0|off)$/i.test(word ?? "") ? false : null);
  const said = (on) => (on ? "on" : "off");
  const again = (changes) => context.router.go("fly-by", { ...params, weather: weatherId, ...changes }, { replace: true });
  const commands = {
    follow: {
      usage: "follow <0|1>", help: "carries the camera along the track's course (the T key)",
      run: ([word]) => {
        const on = onOff(word);
        if (on === null) return `Usage: follow <0|1>. Now ${said(flyer.following)}.`;
        return flyer.setFollowing(on) === on ? `Follow ${said(on)}.` : "This track has no course to follow.";
      },
    },
    flycontrols: {
      usage: `flycontrols <${FLY_SCHEMES.join("|")}>`, help: "how the camera is flown", complete: () => [...FLY_SCHEMES],
      run: ([name]) => {
        const next = FLY_SCHEMES.find((s) => s === (name ?? "").toLowerCase());
        if (!next) return `Usage: flycontrols <${FLY_SCHEMES.join("|")}>. Now ${flyer.scheme}: ${FLY_HELP[flyer.scheme]}.`;
        flyer.setScheme(next);
        return `${FLY_SCHEME_NAMES[next]}: ${FLY_HELP[next]}.`;
      },
    },
    map: {
      usage: "map <sit>", help: "changes the track, by its SIT's name or its title",
      complete: async () => ((await context.assets.call("catalog").catch(() => ({ tracks: [] }))).tracks.map((item) => item.file.replace(/\.SI[T2]$/i, "").toLowerCase())),
      run: async (args, rest) => {
        if (!rest) return `Usage: map <sit>. Now on ${track.file}.`;
        const wanted = rest.trim().toUpperCase().replace(/\.SI[T2]$/, "");
        const catalog = await context.assets.call("catalog").catch(() => ({ tracks: [] }));
        const stem = (item) => item.file.toUpperCase().replace(/\.SI[T2]$/, "");
        const next = catalog.tracks.find((item) => stem(item) === wanted) ?? catalog.tracks.find((item) => item.name.toUpperCase() === wanted)
          ?? catalog.tracks.find((item) => item.name.toUpperCase().includes(wanted));
        if (!next) return `No track named ${wanted}.`;
        again({ track: next, weather: undefined });
        return `Loading ${next.name}.`;
      },
    },
    weather: {
      usage: "weather <n|name>", help: `changes the weather: ${weatherNames.map((n, i) => `${i} ${n}`).join(", ")}`, complete: () => weatherNames,
      run: async ([name]) => {
        const index = /^\d+$/.test(name ?? "") ? Number(name) : weatherNames.findIndex((n) => n.startsWith((name ?? "").toLowerCase()));
        if (!name || index < 0 || index >= WEATHER_NAMES.length) return `Usage: weather <0-${WEATHER_NAMES.length - 1}|${weatherNames.join("|")}>. Now ${weatherId} ${weatherNames[weatherId]}.`;
        await setWeather(index);
        return `Weather: ${t(WEATHER_NAMES[index])}.`;
      },
    },
    backdrop: {
      usage: "backdrop <0|1>", help: "the track's backdrop models on or off (loads the track again)",
      run: ([word]) => {
        const on = onOff(word);
        if (on === null) return `Usage: backdrop <0|1>. Now ${said(!!context.settings.backdrops)}.`;
        context.settings.backdrops = on;
        saveSettings(context.settings);
        again({});
        return `Backdrops ${said(on)}.`;
      },
    },
    overlap: {
      usage: "overlap <0|1>", help: "the ground tiles' two-pixel overlap on or off, for this visit (loads the track again)",
      run: ([word]) => {
        const on = onOff(word);
        if (on === null) return `Usage: overlap <0|1>. Now ${said(build.tileOverlap !== false)}.`;
        again({ tileOverlap: on });
        return `Overlap ${said(on)}.`;
      },
    },
    music: {
      usage: "music <0|1>", help: "the music on or off",
      run: ([word]) => {
        const on = onOff(word), sound = context.settings.sound ?? {};
        if (on === null) return `Usage: music <0|1>. Now ${said((sound.music ?? 0.8) > 0)}.`;
        if (!on && (sound.music ?? 0.8) > 0) context.musicLevelBefore = sound.music ?? 0.8;
        context.settings.sound = { ...sound, music: on ? ((sound.music ?? 0) > 0 ? sound.music : context.musicLevelBefore ?? 0.8) : 0 };
        saveSettings(context.settings);
        audio.setVolumes(context.settings.sound);
        return `Music ${said(on)}.`;
      },
    },
    sound: {
      usage: "sound <0|1>", help: "all sound on or off",
      run: ([word]) => {
        const on = onOff(word), sound = context.settings.sound ?? {};
        if (on === null) return `Usage: sound <0|1>. Now ${said(!sound.muted)}.`;
        context.settings.sound = { ...sound, muted: !on };
        saveSettings(context.settings);
        audio.setVolumes(context.settings.sound);
        return `Sound ${said(on)}.`;
      },
    },
    distance: distanceCommand(context),
    quit: { help: "back to the Races screen", run: () => { leave(); } },
  };
  context.consoleHistory ??= [];
  gameConsole = createConsole({
    parent: view, window, commands, history: context.consoleHistory,
    banner: () => `${WATERMARK}\nFly-by: ${build.title ?? track.name} (${track.file}), ${FLY_SCHEME_NAMES[flyer.scheme]} controls\nType help for commands`,
  });
  cleanups.push(() => gameConsole.dispose());

  loading.hidden = true;
  say(`${t("Fly-by")}: ${FLY_SCHEME_NAMES[flyer.scheme]}. ${FLY_HELP[flyer.scheme]}. O: keys`, 6);

  const target = new THREE.Vector3(), forwardVector = new THREE.Vector3();
  let frame = 0, last = performance.now();
  const loop = (now) => {
    frame = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const cells = Math.max(16, Math.min(256, context.settings.drawCells ?? 128));
    if (cells !== drawnCells) {
      drawnCells = cells;
      camera.far = cells * TERRAIN_CELL_FT;
      weatherScene.setDrawDistance(camera.far);
      const dome = world.getObjectByName("sky");
      if (dome?.userData.radius) dome.scale.setScalar(Math.min(6000, camera.far * 0.95) / dome.userData.radius);
    }
    flyer.step(dt);
    const lens = flyer.apply(camera, target);
    if (lens || cells !== camera.userData.cells) { camera.userData.cells = cells; camera.updateProjectionMatrix(); }
    camera.getWorldDirection(forwardVector);
    audio.setListener(camera.position, forwardVector, camera.up);
    if (!paused) {
      const moves = movers.update(dt, weatherScene.weather === 5);
      if (moves.length) {
        moveObjects(world, moves.map((m) => ({ sitIndex: m.sitIndex, matrix: toSceneMatrix(m.matrix, m.pos) })));
        for (const m of moves) movedPositions.set(m.sitIndex, m.pos);
      }
      // The level's own sounds are placed in the one world, wherever the camera has flown to.
      worldAudio.update(dt, [wrapFt(fly.pos[0]), fly.pos[1], wrapFt(fly.pos[2])], movedPositions);
      weatherScene.update(dt, []);
      waterClock += dt;
      if (water) water.position.y = waterOffsetFt(waterClock, weatherScene.weather);
      waterSurface?.update(dt, weatherScene.weather);
    }
    weatherScene.setUnderwater(isUnderwater(camera.position.y, water ? water.userData.levelFt + water.position.y : null, weatherScene.weather));
    // The sky goes with the camera, up and down too: however high it flies, the dome is never reached.
    const sky = world.getObjectByName("sky");
    // A sky fixed in the world (a Terminal Velocity or Hellbender level's ceiling) stays where it is: it can be reached.
    if (sky) { placeSky(sky, camera); sky.visible = weatherScene.skyShown; }
    updateTrackWorld(world, camera, paused ? 0 : dt);
    flare?.update(camera, sunTravel, true, weatherScene.weather <= 1, () => false);
    renderer.render(scene, camera);
    flare?.render(renderer, camera);
    caption.update(dt);
  };
  frame = requestAnimationFrame(loop);
  cleanups.push(() => cancelAnimationFrame(frame));

  window.__openmtm2Fly = { scene, camera, renderer, fly, build };
  cleanups.push(() => { delete window.__openmtm2Fly; });
  return { unmount };
}
