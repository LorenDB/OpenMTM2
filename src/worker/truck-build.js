/*
  A truck's models for drawing (MONSTER_EXE_ANALYSIS.md section 3, 0x4bfa10).

  TRUCK\<name>.TRK names the parts: the body MODELS\<truckModelBaseName>.BIN, the tires
  MODELS\<tireModelBaseName>16L.BIN and 16R.BIN (the full-detail left and right tires; 10 and 08
  are the lower levels of detail; an MTM1 TRK names one whole model, MODELS\<tireModelName>, for every
  corner), and the axle model. The four wheel anchors are the TRK's
  `static_bpos` values in body feet (FR, FL, RR, RL); a tire model is drawn with its origin there.
*/
import { MTM_WHEEL_KEYS } from "../vendor/openphotex/truck/mtm-trk.js";
import { normalizePodPath, podPathTitle } from "../vendor/openphotex/pod/paths.js";
import { parseTruckManifest } from "../vendor/openphotex/truck/manifest.js";
import { decodeModel } from "./models.js";
import { artStem, loadAoMap, loadArtTexture, loadNormalMap } from "./art-texture.js";
import { buildForeignTruckRender, parseForeignTruckId } from "./foreign-truck-build.js";
import { createPaletteResolver } from "./palette-resolver.js";

/*
  Monster Truck Madness 1's trucks share their file names with MTM2's (BIGFOOT.TRK, BIGFOOT.BIN), and a name goes to the
  first archive mounted, MTM2's. With "Keep MTM1 trucks apart" (Options, Advanced) an MTM1 truck that MTM2 shadows is
  listed again as `MTM1:<file>`, and built from MTM1's archives first: its own manifest, body, tires, art and palettes.
  No file is renamed; only the lookup order changes for that truck.
*/
/** `MTM1:<file>` for an MTM1 truck kept apart. */
export const mtm1TruckId = (file) => `MTM1:${podPathTitle(file).toUpperCase()}`;
/** The file of an `MTM1:<file>` id, or null. */
export function parseMtm1TruckId(id) {
  const match = /^MTM1:(.+)$/i.exec(String(id ?? ""));
  return match ? podPathTitle(match[1]).toUpperCase() : null;
}

/** The first mounted archive whose `TRUCK\<file>` is an MTM1 manifest, or null. */
export async function mtm1Home(vfs, file) {
  const path = normalizePodPath(`TRUCK\\${file}`);
  for (const mount of vfs.allMounts ?? vfs.mounts ?? []) {
    const entry = mount.archive.entries.find((e) => e.normalizedName === path);
    if (!entry) continue;
    try {
      const parsed = parseTruckManifest(await mount.readEntry(entry), file);
      if (parsed.kind === "mtm" && parsed.manifest.dialect === "MTM1") return mount;
    } catch { /* not a truck */ }
  }
  return null;
}

async function model(vfs, name) {
  if (!name) return null;
  const title = podPathTitle(name).toUpperCase();
  const file = title.endsWith(".BIN") ? title : `${title}.BIN`;
  const bytes = await vfs.read(`MODELS\\${file}`);
  return bytes ? decodeModel(bytes, file) : null;
}

/** How many bytes of built trucks are kept for the next build (a preview, a race, a restart). */
const TRUCK_CACHE_BYTES = 128 * 1024 * 1024;
/** Per VFS view: file -> { promise, bytes }, least recently used first. A new set of mounts is a new view. */
const TRUCK_CACHE = new WeakMap();

function bufferBytes(value, seen = new Set()) {
  if (!value || typeof value !== "object") return 0;
  if (ArrayBuffer.isView(value)) {
    if (seen.has(value.buffer)) return 0;
    seen.add(value.buffer);
    return value.buffer.byteLength;
  }
  let sum = 0;
  for (const v of Array.isArray(value) ? value : Object.values(value)) sum += bufferBytes(v, seen);
  return sum;
}

/**
 * `buildTruckRender`, kept: a truck built once for a view of the archives is built from memory the next time, as a
 * copy, since a reply hands its buffers to the page. Its textures do not depend on the track: a model's palette is
 * found before the track's is ever asked for (OpenPhotex `paletteCandidates`, MTM2 and CPR origins).
 */
export async function cachedTruckRender(vfs, trkName, paletteResolver) {
  const key = String(trkName).toUpperCase();
  if (!TRUCK_CACHE.has(vfs)) TRUCK_CACHE.set(vfs, new Map());
  const cache = TRUCK_CACHE.get(vfs);
  let hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
  } else {
    hit = { promise: buildTruckRender(vfs, trkName, paletteResolver), bytes: 0 };
    cache.set(key, hit);
    hit.promise.then((truck) => {
      hit.bytes = bufferBytes(truck);
      let total = 0;
      for (const item of cache.values()) total += item.bytes;
      // The least recently used go first, never the one just built.
      for (const [k, item] of cache) {
        if (total <= TRUCK_CACHE_BYTES || item === hit) break;
        cache.delete(k);
        total -= item.bytes;
      }
    }, () => { if (cache.get(key) === hit) cache.delete(key); });
  }
  const truck = await hit.promise;
  return truck ? structuredClone(truck) : truck;
}

/**
 * The race's trucks, `files`, into `models` by file title, those it holds already left as they are: built at once, and
 * written in the order named.
 */
export async function buildTrucks(models, files, build) {
  const fresh = [...new Set(files.map((f) => podPathTitle(f).toUpperCase()))].filter((file) => !(file in models));
  const built = await Promise.all(fresh.map(build));
  fresh.forEach((file, i) => { models[file] = built[i]; });
}

/**
 * @param {ReturnType<import("./vfs.js").createVfs>} vfs
 * @param {string} trkName e.g. "bigfoot.trk"
 * @param {ReturnType<import("./palette-resolver.js").createPaletteResolver>} paletteResolver
 */
export async function buildTruckRender(vfs, trkName, paletteResolver) {
  // A CPR car or a 4x4 Evolution truck (`<GAME>:<file>`) is built from its own game's files.
  if (parseForeignTruckId(trkName)) return buildForeignTruckRender(vfs, trkName);
  const mtm1 = parseMtm1TruckId(trkName);
  if (mtm1) {
    // The archive that holds the MTM1 manifest first, then MTM1's other archives, then the rest.
    const home = await mtm1Home(vfs, mtm1);
    let view = vfs.preferGame?.("MTM1") ?? vfs;
    if (home) view = view.preferMount?.(home.name) ?? view;
    const built = await buildTruckRender(view, mtm1, createPaletteResolver(view, "MTM1", null));
    return built ? { ...built, file: mtm1TruckId(mtm1), name: `${built.name} (MTM1)` } : null;
  }
  const title = podPathTitle(trkName).toUpperCase();
  const bytes = await vfs.read(`TRUCK\\${title.endsWith(".TRK") ? title : `${title}.TRK`}`);
  if (!bytes) return null;
  const { manifest } = parseTruckManifest(bytes, title);
  const tireBase = manifest.tireModelBaseName ?? "";
  // The parts' models, read and decoded at once.
  const partNames = {
    body: manifest.truckModelBaseName,
    tireLeft: `${tireBase}16L`,
    tireRight: `${tireBase}16R`,
    // Community Patch 3 trucks may carry a tire per corner (16FR, 16FL, 16RR, 16RL), used where present (JSTruckViewer).
    tireFR: `${tireBase}16FR`, tireFL: `${tireBase}16FL`,
    tireRR: `${tireBase}16RR`, tireRL: `${tireBase}16RL`,
    axle: manifest.axleModelName,
    driveshaft: "DRVSHAFT",
  };
  const partModels = await Promise.all(Object.values(partNames).map((name) => model(vfs, name)));
  const parts = Object.fromEntries(Object.keys(partNames).map((key, i) => [key, partModels[i]]));
  // Monster Truck Madness 1's TRK names the whole tire model (`tireModelName wheel13.bin`), one for every corner, where
  // MTM2's names a base that takes the level of detail and the side. Its wheels are centred and even, so one serves both.
  if (!parts.tireLeft && !parts.tireRight && !parts.tireFR && tireBase) {
    parts.tireLeft = parts.tireRight = await model(vfs, tireBase);
  }
  // The suspension parts drawn between the axles and the body (game/suspension.js).
  const suspension = manifest.axlebarOffset && manifest.driveshaftPos ? {
    axlebar: manifest.axlebarOffset, driveshaft: manifest.driveshaftPos,
    shockTexture: (manifest.shockTextureName ?? "shock.raw").toUpperCase(), barTexture: (manifest.barTextureName ?? "axlebar.raw").toUpperCase(),
  } : null;
  const anchors = MTM_WHEEL_KEYS.map((key) => {
    const a = manifest.wheelAnchors[key];
    return a ? [a.x, a.y, a.z] : null;
  });

  // Each texture the parts name, the first mesh to name it saying whether it is a cutout, and a mesh's own texture with
  // its normal and occlusion maps; all read at once, then kept in the order they were named.
  const wanted = new Map();
  for (const part of Object.values(parts)) {
    for (const mesh of part?.meshes ?? []) {
      for (const frame of (mesh.textureFrames ?? []).slice(1)) {
        if (!wanted.has(frame)) wanted.set(frame, { cutout: mesh.cutout, maps: false });
      }
      const name = mesh.textureName;
      if (name && !wanted.has(name)) wanted.set(name, { cutout: mesh.cutout, maps: true });
    }
  }
  const loads = await Promise.all([...wanted].map(([name, { cutout, maps }]) => Promise.all([
    loadArtTexture(vfs, name, paletteResolver, { cutout }), maps ? loadNormalMap(vfs, name) : null, maps ? loadAoMap(vfs, name) : null,
  ])));
  const textures = {};
  [...wanted.keys()].forEach((name, i) => {
    const [image, normal, ao] = loads[i];
    textures[name] = image;
    if (normal) textures[`${artStem(name)}_N`] = normal;
    if (ao) textures[`${artStem(name)}_AO`] = ao;
  });
  const suspensionArt = suspension ? [suspension.shockTexture, suspension.barTexture] : [];
  const suspensionImages = await Promise.all(suspensionArt.map((name) => loadArtTexture(vfs, name, paletteResolver)));
  suspensionArt.forEach((name, i) => { textures[name] = suspensionImages[i]; });
  // The lamps (game/truck-lights.js): each with its lens bitmap and, when it throws a beam, the cone's texture.
  const lights = (manifest.lights ?? []).map((l) => ({
    type: l.type ?? 0, pos: [l.pos?.x ?? 0, l.pos?.y ?? 0, l.pos?.z ?? 0], radius: l.bitmapRadius ?? 0,
    heading: l.heading ?? 0, pitch: l.pitch ?? 0, spin: l.spinSpeed ?? 0,
    coneLength: l.coneLength ?? 0, coneBase: l.coneBaseRadius ?? 0, coneRim: l.coneRimRadius ?? 0,
    coneTexture: (l.coneTexture ?? "").toUpperCase(), source: (l.sourceBitmap ?? "").toUpperCase(),
    msOn: l.msOn ?? 0, msOff: l.msOff ?? 0,
  }));
  const lightNames = [...new Set(lights.flatMap((l) => [l.source, l.coneLength > 0 ? l.coneTexture : ""]).filter(Boolean))];
  const lightImages = await Promise.all(lightNames.map((name) => loadArtTexture(vfs, name, paletteResolver)));
  const lightTextures = Object.fromEntries(lightNames.map((name, i) => [name, lightImages[i]]));
  const scrapePoints = (manifest.scrapePoints ?? []).map((v) => [v.x, v.y, v.z]);
  return { file: title, name: manifest.truckName, parts, anchors, scrapePoints, textures, suspension, lights, lightTextures };
}
