/*
  Vehicles of the other Terminal Reality games, in the shape a truck is drawn in (worker/truck-build.js):
  CART Precision Racing's cars (`VEHICLE\<name>.CAR`) and 4x4 Evolution 1 and 2's trucks (`TRUCK\<name>.TRK`).
  OpenPhotex reads the manifests and the models; the assembly follows JSTruckViewer's.

  A vehicle of another game is named `<GAME>:<file>` ("CPR:DAVIS.CAR", "EVO2:CBLS24.TRK"): the two Evolution games
  share file names with each other, so the file alone does not say which is meant. Its files are looked up as its own
  game sees them (worker/vfs.js `scoped`).

  - A CPR car is its body (`MODELS\<name>.CMD`, the high-detail model, or a `.BIN`) and four wheel models, one per
    corner. Of the body's two wing packages the road-course one is drawn. The driver's helmet is left out.
  - An Evolution truck is its body (`MODELS\<name>.SMF`) and its tires (`<tire base>16L` and `16R`, else the next
    detail down). As 4x42.exe does (game/evo-suspension.js), a body's AXLEF and AXLER groups are taken out of it,
    recentred and scaled to their axle's track, and drawn at the axles; a truck with an axle-bar texture (AMT.TRK) has
    the game's bars and shocks too.

  No lamps, no cockpit and no crash dents: those are read from MTM2's own files, which these vehicles do not have.
  The physics is MTM2's (docs/PLAN.md Stage 3.1): the manifest gives the wheel positions and the hull points, the
  wheel models their size (`tire`), and everything else is the monster truck's.
*/
import { CMD_NORMAL_SCALE, CMD_POSITION_SCALE, CMD_UV_SCALE, cmdFaceTriangles, cmdWingPackages, parseCprCmd } from "../vendor/openphotex/cpr/cmd.js";
import { EVO_WHEEL_KEYS } from "../vendor/openphotex/evo/trk.js";
import { MTM_WHEEL_KEYS } from "../vendor/openphotex/truck/mtm-trk.js";
import { parseEvoParts } from "../vendor/openphotex/evo/parts.js";
import { parseTruckManifest } from "../vendor/openphotex/truck/manifest.js";
import { podPathTitle } from "../vendor/openphotex/pod/paths.js";
import * as evoSim from "../vendor/openphotex/sim/evo/index.js";
import { loadArtTexture } from "./art-texture.js";
import { decodeSmfModel, loadEvoModelTextures, loadEvoTexture } from "./evo-models.js";
import { decodeModel } from "./models.js";
import { AMT_SUSPENSION, EVO_BAR_AXLE_SPAN } from "../game/evo-suspension.js";
import { createPaletteResolver } from "./palette-resolver.js";

/** The games whose vehicles are listed beside MTM's trucks, and where each keeps its manifests. */
export const FOREIGN_TRUCK_GAMES = Object.freeze({
  CPR: Object.freeze({ folder: "VEHICLE", extension: ".CAR", kind: "cpr-car" }),
  EVO1: Object.freeze({ folder: "TRUCK", extension: ".TRK", kind: "evo" }),
  EVO2: Object.freeze({ folder: "TRUCK", extension: ".TRK", kind: "evo" }),
});

/** `<GAME>:<file>` for a vehicle of another game. */
export const foreignTruckId = (game, file) => `${game}:${podPathTitle(file).toUpperCase()}`;

/** `{ game, file }` of a `<GAME>:<file>` name, or null for an MTM truck's plain file name. */
export function parseForeignTruckId(id) {
  const match = /^(CPR|EVO1|EVO2):(.+)$/i.exec(String(id ?? ""));
  return match ? { game: match[1].toUpperCase(), file: podPathTitle(match[2]).toUpperCase() } : null;
}

const xyz = (v) => (v ? [v.x, v.y, v.z] : null);
const stemOf = (name) => podPathTitle(name ?? "").toUpperCase().replace(/\.[^.]*$/, "");

/**
 * A CPR `.CMD` body as a model (worker/models.js's shape). The file's numbers are fixed point and its axes x lateral,
 * y up, z forward; like every model here the scene mirrors z. The speedway wing package is left out.
 */
export function decodeCmdModel(text, name) {
  const cmd = parseCprCmd(text, name);
  const textureName = (cmd.textureName ?? "").toUpperCase();
  const speedway = new Set(cmdWingPackages(cmd.parts.map((part) => part.name))?.speedway ?? []);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const meshes = [];
  for (const part of cmd.parts) {
    if (speedway.has(part.name)) continue;
    const at = (i) => [
      (part.vertices[i * 3] + part.center.x) * CMD_POSITION_SCALE,
      (part.vertices[i * 3 + 1] + part.center.y) * CMD_POSITION_SCALE,
      (part.vertices[i * 3 + 2] + part.center.z + cmd.lowDetailCenterZ) * CMD_POSITION_SCALE,
    ];
    const positions = [], normals = [], uvs = [];
    for (const face of part.faces) {
      const points = face.corners.map((corner) => { const [x, y, z] = at(corner.vertexIndex); return { x, y, z }; });
      for (const triangle of cmdFaceTriangles(points)) {
        for (const k of triangle) {
          const corner = face.corners[k], p = points[k], n = corner.vertexIndex * 3;
          const nx = part.normals[n] * CMD_NORMAL_SCALE, ny = part.normals[n + 1] * CMD_NORMAL_SCALE, nz = part.normals[n + 2] * CMD_NORMAL_SCALE;
          const length = Math.hypot(nx, ny, nz) || 1;
          positions.push(p.x, p.y, -p.z);
          normals.push(nx / length, ny / length, -nz / length);
          uvs.push(corner.u / CMD_UV_SCALE, corner.v / CMD_UV_SCALE);
          [p.x, p.y, p.z].forEach((value, a) => { if (value < lo[a]) lo[a] = value; if (value > hi[a]) hi[a] = value; });
        }
      }
    }
    if (!positions.length) continue;
    meshes.push({
      groupName: part.name, textureName, textureFrames: null, color: textureName ? null : 0x9b9b9b, cutout: false, blended: false,
      emissive: false, material: null, normalStrength: 1, doubleSided: true,
      positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs),
    });
  }
  return { name, meshes, textureNames: textureName ? [textureName] : [], frameNames: null, bounds: meshes.length ? { min: lo, max: hi } : null };
}

/**
 * A tire model's size in feet, `{ radiusFt, widthFt }`: half its height and its extent across, or null when it has no
 * geometry. The simulation rolls the vehicle on tires of this size in place of a monster truck's.
 */
export function tireSize(model) {
  const b = model?.bounds;
  if (!b) return null;
  const radiusFt = Math.max(b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2, widthFt = b.max[0] - b.min[0];
  return radiusFt > 0 && widthFt > 0 ? { radiusFt, widthFt } : null;
}

/**
 * The body's group named `pattern` (AXLEF, AXLER) taken out of it as a model of its own: recentred on its box and scaled
 * alike on every axis to `span` feet across (0x5d3ad0). Null when the body has no such group.
 */
function takeAxle(body, pattern, span, name) {
  const meshes = body.meshes.filter((m) => pattern.test(m.groupName));
  if (!meshes.length || !(span > 0)) return null;
  body.meshes = body.meshes.filter((m) => !meshes.includes(m));
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const { positions } of meshes) {
    for (let i = 0; i < positions.length; i++) { const a = i % 3; if (positions[i] < lo[a]) lo[a] = positions[i]; if (positions[i] > hi[a]) hi[a] = positions[i]; }
  }
  const centre = lo.map((v, a) => (v + hi[a]) / 2), scale = span / ((hi[0] - lo[0]) || 1);
  const moved = meshes.map((m) => ({ ...m, positions: m.positions.map((v, i) => (v - centre[i % 3]) * scale) }));
  const half = hi.map((v, a) => ((v - lo[a]) / 2) * scale);
  return { name, meshes: moved, textureNames: [...new Set(moved.map((m) => m.textureName).filter(Boolean))], frameNames: null, bounds: { min: half.map((v) => -v), max: half } };
}

/** The parts list (PARTS\\PARTS.TXT) of the view's archives, read once per view; empty without one. */
const partsLists = new WeakMap();
function evoParts(view) {
  if (!partsLists.has(view)) {
    partsLists.set(view, Promise.resolve().then(() => view.read("PARTS\\PARTS.TXT")).then((bytes) => (bytes ? parseEvoParts(bytes) : [])).catch(() => []));
  }
  return partsLists.get(view);
}

async function evoTruck(view, file, game) {
  const bytes = await view.read(`TRUCK\\${file}`);
  if (!bytes) return null;
  const parsed = parseTruckManifest(bytes, file);
  if (parsed.kind !== "evo") return null;
  const manifest = parsed.manifest;
  const smf = async (stem) => {
    const data = stem ? await view.read(`MODELS\\${stem}.SMF`) : null;
    return data ? decodeSmfModel(data, `${stem}.SMF`) : null;
  };
  // Its stock parts fitted (a Class 2 or 3 version: docs/EVO2_PHYSICS.md 2.1): figures, lift and tires.
  const fitted = manifest.stockParts?.length
    ? evoSim.applyEvoParts(evoSim.evoSpecFromTrk(manifest), manifest.stockParts, await evoParts(view))
    : { spec: evoSim.evoSpecFromTrk(manifest), liftFt: 0, tireModelBase: null };
  const tireBase = fitted.tireModelBase ?? stemOf(manifest.tireModelBaseName);
  const tire = async (side) => {
    for (const detail of ["16", "12", "08"]) {
      const model = tireBase ? await smf(`${tireBase}${detail}${side}`) : null;
      if (model?.meshes.length) return model;
    }
    return null;
  };
  const parts = { body: await smf(stemOf(manifest.truckModelBaseName)), tireLeft: await tire("L"), tireRight: await tire("R") };
  if (!parts.body?.meshes.length) return null;
  // A lift kit lowers the wheels' anchors: the body stands higher on them.
  const anchors = EVO_WHEEL_KEYS.map((key) => xyz(manifest.wheelAnchors[key])).map((a) => (a && fitted.liftFt ? [a[0], a[1] - fitted.liftFt, a[2]] : a));
  const tireFt = tireSize(parts.tireLeft ?? parts.tireRight);
  // An axle-bar texture (0x5ed4b0): AMT.TRK's own, or one the manifest names (stock manifests name none).
  const barName = stemOf(manifest.barTextureName) && stemOf(manifest.barTextureName) !== "NULL" ? manifest.barTextureName : null;
  const amt = file === "AMT.TRK";
  const bars = amt ? AMT_SUSPENSION : barName ? {
    shockTexture: stemOf(manifest.shockTextureName) !== "NULL" ? manifest.shockTextureName : null, barTexture: barName,
    axlebar: manifest.axlebarOffset ?? { x: 0, y: 0, z: 0 }, driveshaft: manifest.driveshaftPos ?? { x: 0, y: 0, z: 0 },
  } : null;
  const body = parts.body;
  if (anchors.every(Boolean)) {
    const span = (r, l) => (r[0] - l[0]) * (bars ? EVO_BAR_AXLE_SPAN : 1);
    parts.axleFront = takeAxle(body, /^AXLEFL?$/i, span(anchors[0], anchors[1]), `${body.name}#AXLEF`);
    parts.axleRear = takeAxle(body, /^AXLERL?$/i, span(anchors[2], anchors[3]), `${body.name}#AXLER`);
  }
  const textures = await loadEvoModelTextures(view, parts);
  let evoSuspension = null;
  if (bars && tireFt && anchors[0]) {
    for (const name of [bars.shockTexture, bars.barTexture]) {
      const title = name && podPathTitle(name).toUpperCase();
      if (title && !(title in textures)) { const image = await loadEvoTexture(view, title); if (image) textures[title] = image; }
    }
    // The low-detail body's height (0x5ff4d0); the body as drawn, without its axles, stands in for it.
    let top = -Infinity, bottom = Infinity;
    for (const { positions } of body.meshes) for (let i = 1; i < positions.length; i += 3) { top = Math.max(top, positions[i]); bottom = Math.min(bottom, positions[i]); }
    evoSuspension = {
      shockTexture: bars.shockTexture && podPathTitle(bars.shockTexture).toUpperCase(), barTexture: podPathTitle(bars.barTexture).toUpperCase(),
      axlebar: bars.axlebar, inner: anchors[0][0] - tireFt.widthFt / 2 - 0.5, tall: top - bottom > 7.5,
    };
  }
  return {
    name: manifest.truckName, parts, textures, anchors,
    scrapePoints: (manifest.scrapePoints ?? []).map(xyz),
    tire: tireFt, game, evoSuspension,
    // The vehicle's own figures for the 4x4 Evolution physics (OpenPhotex evoSim; docs/EVO2_PHYSICS.md 2).
    evoSpec: fitted.spec,
  };
}

async function cprCar(view, file) {
  const bytes = await view.read(`VEHICLE\\${file}`);
  if (!bytes) return null;
  const parsed = parseTruckManifest(bytes, file);
  if (parsed.kind !== "cpr-car") return null;
  const manifest = parsed.manifest;
  const palettes = createPaletteResolver(view, "CPR", null);
  const model = async (name) => {
    const title = podPathTitle(name ?? "").toUpperCase();
    if (!title) return null;
    const data = await view.read(`MODELS\\${title}`);
    if (!data) return null;
    return title.endsWith(".CMD") ? decodeCmdModel(new TextDecoder("windows-1252").decode(data), title) : decodeModel(data, title);
  };
  const wheel = (key) => model(manifest.wheelModelNames?.[key]);
  const parts = {
    body: await model(manifest.truckModelName),
    tireFR: await wheel("faxle.rtire.static_bpos"), tireFL: await wheel("faxle.ltire.static_bpos"),
    tireRR: await wheel("raxle.rtire.static_bpos"), tireRL: await wheel("raxle.ltire.static_bpos"),
  };
  if (!parts.body?.meshes.length) return null;
  parts.tireLeft = parts.tireFL ?? parts.tireRL;
  parts.tireRight = parts.tireFR ?? parts.tireRR;
  const textures = {};
  for (const part of Object.values(parts)) {
    for (const mesh of part?.meshes ?? []) {
      const name = mesh.textureName;
      if (name && !(name in textures)) textures[name] = await loadArtTexture(view, name, palettes, { cutout: mesh.cutout });
    }
  }
  return {
    name: manifest.truckName, parts, textures,
    anchors: MTM_WHEEL_KEYS.map((key) => xyz(manifest.wheelAnchors[key])),
    scrapePoints: (manifest.scrapePoints ?? []).map(xyz),
    tire: tireSize(parts.tireLeft ?? parts.tireRight), game: "CPR",
  };
}

/**
 * A vehicle of another game for drawing, or null when its files are not mounted: `{ file, name, game, parts, anchors,
 * scrapePoints, textures, tire, suspension: null, evoSuspension, lights: [], lightTextures: {} }`, `file` its `<GAME>:<file>` name.
 */
export async function buildForeignTruckRender(vfs, id) {
  const named = parseForeignTruckId(id);
  const view = named && vfs.scoped?.(named.game);
  if (!view) return null;
  const built = named.game === "CPR" ? await cprCar(view, named.file) : await evoTruck(view, named.file, named.game);
  if (!built || built.anchors.some((a) => !a)) return null;
  return { ...built, file: foreignTruckId(named.game, named.file), suspension: null, lights: [], lightTextures: {} };
}
