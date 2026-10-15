/*
  The tracks and trucks an install offers.

  Like the game's CRace::init (MONSTER_EXE_ANALYSIS.md section 3), every `.SIT` and every
  `.TRK` in the mounted PODs is content: there is no registry. The game hides WAR.SIT
  "Torture Pit" (unlocked on Sidewinder Canyon) and GRAVEY.SIT "The Graveyard"
  (showHiddenTrack), and CHUCK.TRK (the CHUCK cheat) when an add-on POD supplies it: the
  retail PODs contain no CHUCK.TRK.

  Pure: it reads through a VFS (see vfs.js) and returns plain data.
*/
import { isEvoSit, parseEvoSit, parseMtmSit, parseTruckManifest, podPathTitle } from "../vendor/openphotex/index.js";
import { courseLengthFt } from "./cpr-road.js";
import { FOREIGN_TRUCK_GAMES, foreignTruckId } from "./foreign-truck-build.js";
import { mtm1TruckId } from "./truck-build.js";
import { drivableTvLevel } from "./tv-track-build.js";

/**
 * CART Precision Racing's track types by the SIT's code (its own enum: 4 Road, 5 Speedway, 6 Short oval, 7 Street).
 * All of them run under the Circuit rules; the Races screen shows the name with the game, "Oval (CPR)".
 */
export const CPR_TRACK_TYPES = Object.freeze({ 4: "Road", 5: "Oval", 6: "Short Oval", 7: "Street" });

/** 4x4 Evolution's track types by the SIT's code: 2 Circuit, 3 Rally, 6 Mission (OpenPhotex `evoTrackTypeName`). */
export const EVO_TRACK_TYPES = Object.freeze({ 2: ["Circuit", "circuit"], 3: ["Rally", "rally"], 6: ["Mission", null] });

/**
 * The 4x4 Evolution 1 and 2 tracks among the mounted archives, each looked up as a track of its own game. A track
 * without checkpoints (the missions) can only be driven in free roam (`freeRoamOnly`); how the game plays a mission
 * is not known.
 */
async function evoTracks(vfs, problems) {
  const tracks = [];
  for (const game of ["EVO1", "EVO2"]) {
    const view = vfs.scoped?.(game);
    if (!view) continue;
    for (const { path, mount, entry } of view.list(".SIT")) {
      if (mount.family !== game) continue;
      try {
        const bytes = await mount.readEntry(entry);
        if (!isEvoSit(bytes)) continue;
        const file = podPathTitle(path);
        const sit = parseEvoSit(bytes, file);
        const [type, mode] = EVO_TRACK_TYPES[sit.raceType] ?? [`Type ${sit.raceType}`, null];
        const checkpoints = sit.boxes.filter((b) => b.sourceClass === "CCheckpoint" || b.boxType === 6).length;
        const raceType = mode ?? "circuit";
        tracks.push({
          path, pod: mount.name, file, name: sit.trackName || file, locale: "",
          game, scope: game, typeLabel: `${type} (${game})`, freeRoamOnly: !mode || checkpoints === 0,
          typeCode: sit.raceType, raceType, weatherMask: sit.weatherMask, trackLength: sit.trackLength || null,
          defaultLaps: defaultLaps(raceType, sit.trackLength || undefined), ambientSound: sit.ambientSound, level: sit.lvlName, hidden: false,
        });
      } catch (err) {
        problems.push(`${path}: ${err.message}`);
      }
    }
  }
  return tracks;
}

/** The games whose levels are listed as places to drive or fly about in, and how each is titled. */
export const TV_LEVEL_GAMES = Object.freeze({ TV: "TV/F3", HB: "HB" });

/**
 * The Terminal Velocity, Fury3 and Hellbender levels among the mounted archives (worker/tv-track-build.js): the
 * surface levels, each named by its `LEVELS\<level>.LVL`. They have no race: free roam and fly-by only, and no
 * tournament takes them (`freeRoamOnly`, `noTournament`). A Terminal Velocity level and a Fury3 one cannot be told
 * apart by their files, so both are "TV/F3".
 */
async function tvLevels(vfs, problems) {
  const tracks = [];
  for (const [game, label] of Object.entries(TV_LEVEL_GAMES)) {
    const view = vfs.scoped?.(game);
    if (!view) continue;
    const seen = new Set();
    for (const { path, mount, entry } of view.list(".LVL")) {
      const file = podPathTitle(path).toUpperCase();
      if (mount.family !== game || seen.has(file) || !/^LEVELS[\\/]/i.test(path)) continue;
      seen.add(file);
      try {
        const lvl = drivableTvLevel(await mount.readEntry(entry));
        if (!lvl || (lvl.origin === "HB") !== (game === "HB")) continue;
        tracks.push({
          path, pod: mount.name, file, name: lvl.displayName || file.replace(/\.LVL$/, ""), locale: "",
          game, scope: game, typeLabel: `Level (${label})`, freeRoamOnly: true, noTournament: true,
          typeCode: 0, raceType: "freeroam", weatherMask: null, trackLength: null, defaultLaps: 1, ambientSound: null, level: file, hidden: false,
        });
      } catch (err) {
        problems.push(`${path}: ${err.message}`);
      }
    }
  }
  return tracks;
}

/** The CPR tracks among the mounted archives, looked up as a CPR track sees them (worker/vfs.js). */
async function cprTracks(vfs, problems) {
  const cpr = vfs.scoped?.("CPR");
  if (!cpr) return [];
  const tracks = [];
  for (const { path, mount, entry } of cpr.list(".SIT")) {
    if (mount.family !== "CPR") continue;
    try {
      const file = podPathTitle(path);
      const sit = parseMtmSit(await mount.readEntry(entry), file);
      if (sit.origin !== "CPR") continue;
      if (sit.lvlName && !cpr.find(`LEVELS\\${podPathTitle(sit.lvlName)}`)) { problems.push(`${path}: its level ${sit.lvlName} is missing`); continue; }
      const type = CPR_TRACK_TYPES[sit.trackTypeCode] ?? "Track";
      // The lap as the first racing line runs it (the SIT has no length; the road layer's is read with the track).
      const trackLength = courseLengthFt(sit.primaryCourse?.segments) || null;
      tracks.push({
        path, pod: mount.name, file, name: sit.trackName || file, locale: sit.localeName,
        game: "CPR", scope: "CPR", typeLabel: `${type} (CPR)`,
        // The SIT's own picture and icon, where it names them.
        logoBmp: bmpStem(sit.logoBmp), mapBmp: bmpStem(sit.mapBmp),
        // No weather mask in a CPR SIT: every MTM2 weather is offered.
        typeCode: sit.trackTypeCode, raceType: "circuit", weatherMask: null, trackLength,
        defaultLaps: defaultLaps("circuit", trackLength ?? undefined), ambientSound: null, level: sit.lvlName, hidden: false,
      });
    } catch (err) {
      problems.push(`${path}: ${err.message}`);
    }
  }
  return tracks;
}

/** A header's bitmap name as the UI archive is asked for it: no folder, no extension, upper case; null when it is no plain name. */
export function bmpStem(name) {
  const stem = String(name ?? "").replace(/^.*[\\/]/, "").replace(/\.bmp$/i, "").toUpperCase();
  return /^[A-Z0-9_-]+$/.test(stem) ? stem : null;
}

/**
 * The vehicles of the other games among the mounted archives (worker/foreign-truck-build.js): CPR's cars and the 4x4
 * Evolution trucks, after MTM's own, each named `<GAME>:<file>` and titled with its game, "Davis/Salles (CPR)".
 */
async function foreignTrucks(vfs, problems) {
  const trucks = [];
  for (const [game, { folder, extension, kind }] of Object.entries(FOREIGN_TRUCK_GAMES)) {
    const view = vfs.scoped?.(game);
    if (!view) continue;
    const seen = new Set();
    for (const { path, mount, entry } of view.list(extension)) {
      if (mount.family !== game || !path.toUpperCase().replace(/\//g, "\\").startsWith(`${folder}\\`)) continue;
      const file = podPathTitle(path).toUpperCase();
      if (seen.has(file)) continue;
      seen.add(file);
      try {
        const parsed = parseTruckManifest(await mount.readEntry(entry), file);
        if (parsed.kind !== kind) continue;
        trucks.push({
          path, pod: mount.name, file: foreignTruckId(game, file), name: `${parsed.manifest.truckName || file} (${game})`,
          game, scope: game, dialect: game, waves: [], hidden: false,
        });
      } catch (err) {
        problems.push(`${path}: ${err.message}`);
      }
    }
  }
  return trucks;
}

/**
 * MTM1 trucks that an MTM2 truck of the same file name shadows (worker/truck-build.js `mtm1TruckId`), each listed as
 * `MTM1:<file>`, "Bigfoot (MTM1)", marked `apart`: the catalogue offers them only with "Keep MTM1 trucks apart" on.
 */
async function mtm1ApartTrucks(vfs, problems) {
  const trucks = [];
  const seen = new Set();
  // By each manifest's own dialect, not the archive's game: an MTM1 TRUCK.POD may be mounted with the MTM2 install's
  // own archives (listed in its POD.INI), which are all taken for MTM2's.
  for (const mount of vfs.allMounts ?? vfs.mounts) {
    if (!["MTM", ""].includes(mount.family ?? "MTM")) continue;
    for (const entry of mount.archive.entries) {
      const path = entry.normalizedName;
      if (!/^TRUCK[\\/][^\\/]+\.TRK$/.test(path)) continue;
      const file = podPathTitle(path).toUpperCase();
      if (seen.has(file) || vfs.find(path)?.mount === mount) continue;
      seen.add(file);
      try {
        const parsed = parseTruckManifest(await mount.readEntry(entry), file);
        if (parsed.kind !== "mtm" || parsed.manifest.dialect !== "MTM1") continue;
        trucks.push({
          path, pod: mount.name, file: mtm1TruckId(file), name: `${parsed.manifest.truckName || file} (MTM1)`,
          dialect: "MTM1", game: "MTM1", apart: true, waves: parsed.manifest.waveFiles ?? [], hidden: HIDDEN_TRUCKS.includes(file),
        });
      } catch (err) {
        problems.push(`${path}: ${err.message}`);
      }
    }
  }
  return trucks;
}

export const HIDDEN_TRACKS = Object.freeze(["WAR.SIT", "GRAVEY.SIT"]);
export const HIDDEN_TRUCKS = Object.freeze(["CHUCK.TRK"]);

/**
 * Race types by the SIT's track type code (MONSTER_EXE_ANALYSIS.md section 6). Type 0 is the engine's free roam: no
 * course is followed and no checkpoint is tested (MTM1_MONSTER_EXE_ANALYSIS.md 2.6; MTM1's HILLCLIM.SIT is one).
 */
export const RACE_TYPES = Object.freeze({ 0: "freeroam", 1: "drag", 2: "circuit", 3: "rally", 4: "summit" });

/**
 * A track's default lap count (MONSTER_EXE_ANALYSIS.md 3, "Default lap count"): for a Circuit
 * `trunc(15000 / length + 1)` with a 6000 ft length when the SIT has none; 5 for a Summit Rumble
 * (minutes); 1 otherwise.
 */
export function defaultLaps(raceType, trackLength) {
  if (raceType === "circuit") return Math.trunc(15000 / (trackLength ?? 6000) + 1);
  return raceType === "summit" ? 5 : 1;
}

/**
 * @param {ReturnType<import("./vfs.js").createVfs>} vfs
 * @returns {Promise<{ tracks: object[], trucks: object[], problems: string[] }>}
 */
export async function buildCatalog(vfs) {
  const problems = [];
  const tracks = [];
  // Community Patch 3 writes a track that needs its engine as `.SI2`, which a 1998 install never lists; when a track is
  // there in both spellings the `.SI2` is the one its author meant for this engine.
  // The list keeps the mount order (POD.INI's), then each archive's own order, as the game's does: it is not sorted by name.
  const stemOf = (path) => podPathTitle(path).replace(/\.SI[T2]$/i, "");
  const si2 = new Map(vfs.list(".SI2").map((hit) => [stemOf(hit.path), hit]));
  const order = (hit) => (vfs.allMounts ?? vfs.mounts).indexOf(hit.mount);
  const situations = [...vfs.list(".SI2"), ...vfs.list(".SIT")]
    .map((hit, index) => ({ hit, index })).sort((a, b) => order(a.hit) - order(b.hit) || a.index - b.index).map(({ hit }) => hit);
  const seenStems = new Set();
  for (const first of situations) {
    const stem = stemOf(first.path);
    if (seenStems.has(stem)) continue;
    seenStems.add(stem);
    const { path, mount } = si2.get(stem) ?? first;
    try {
      // Other games' tracks are listed apart (CPR below; 4x4 Evolution with docs/PLAN.md F4).
      if ((mount.family ?? "MTM") !== "MTM") continue;
      const sit = parseMtmSit(await mount.readEntry((si2.get(stem) ?? first).entry), podPathTitle(path));
      // MTM2 tracks, and the MTM1 ones a Community Patch 3 install carries (its GAME.POD): the game loads both (level type 4).
      if (sit.origin !== "MTM2" && sit.origin !== "MTM1") continue;
      // A situation without its level cannot be driven (MTM1's HILLCLIM.SIT ships with no HILLCLIM.LVL).
      if (sit.lvlName && !vfs.find(`LEVELS\\${podPathTitle(sit.lvlName)}`)) { problems.push(`${path}: its level ${sit.lvlName} is missing`); continue; }
      const file = podPathTitle(path);
      tracks.push({
        path,
        pod: mount.name,
        file,
        name: sit.trackName || file,
        locale: sit.localeName,
        /** "MTM2" or "MTM1" (OpenPhotex `detectSitOrigin`, JSTrackViewer's rule: what the SIT's own lines say). */
        game: sit.origin,
        typeCode: sit.trackTypeCode,
        raceType: RACE_TYPES[sit.trackTypeCode] ?? "unsupported",
        /** A type 0 track has no race on it: it is driven in free roam and nothing else. */
        freeRoamOnly: sit.trackTypeCode === 0,
        /**
         * The SIT header's own picture, overhead map and description (MTM1's setup screens and zoom map,
         * MTM1_MONSTER_EXE_ANALYSIS.md 2.10): `UI\<logo>.BMP`, `UI\<map>.BMP` and `WORLD\<description>`, or null.
         */
        logoBmp: bmpStem(sit.logoBmp), mapBmp: bmpStem(sit.mapBmp), descriptionTxt: sit.descriptionTxt ?? null,
        /** A drag strip's par time, seconds (the fly-by line as a number), or null. */
        dragParTime: sit.dragParTime ?? null,
        weatherMask: sit.weatherMask,
        trackLength: sit.trackLength,
        defaultLaps: defaultLaps(RACE_TYPES[sit.trackTypeCode], sit.trackLength),
        ambientSound: sit.ambientSound,
        level: sit.lvlName,
        hidden: HIDDEN_TRACKS.includes(file),
      });
    } catch (err) {
      problems.push(`${path}: ${err.message}`);
    }
  }
  tracks.push(...await cprTracks(vfs, problems), ...await evoTracks(vfs, problems), ...await tvLevels(vfs, problems));
  const trucks = [];
  for (const { path, mount } of vfs.list(".TRK")) {
    // A CPR `.TRK` is a track's road layer and an Evo one another manifest: neither is an MTM truck. An archive whose
    // game is not known ("") may be an add-on truck's: its manifest says below whether it is one.
    if (!["MTM", ""].includes(mount.family ?? "MTM")) continue;
    try {
      const parsed = parseTruckManifest(await vfs.read(path), podPathTitle(path));
      if (parsed.kind !== "mtm") continue;
      const file = podPathTitle(path);
      trucks.push({
        path,
        pod: mount.name,
        file,
        name: parsed.manifest.truckName || file,
        dialect: parsed.manifest.dialect,
        /** The truck's three name clips (the .TRK "Wave File" names), for the announcer. */
        waves: parsed.manifest.waveFiles ?? [],
        hidden: HIDDEN_TRUCKS.includes(file),
      });
    } catch (err) {
      problems.push(`${path}: ${err.message}`);
    }
  }
  trucks.push(...await mtm1ApartTrucks(vfs, problems));
  trucks.push(...await foreignTrucks(vfs, problems));
  return { tracks, trucks, problems };
}
