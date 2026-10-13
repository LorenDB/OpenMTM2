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
    detail down). Its bodies model their own suspension, so no axle, bar, shock or driveshaft is added.

  No lamps, no cockpit and no crash dents: those are read from MTM2's own files, which these vehicles do not have.
  The physics is MTM2's (docs/PLAN.md Stage 3.1): the manifest gives the wheel positions and the hull points, the
  wheel models their size (`tire`), and everything else is the monster truck's.
*/
import {
  CMD_NORMAL_SCALE, CMD_POSITION_SCALE, CMD_UV_SCALE, EVO_WHEEL_KEYS, MTM_WHEEL_KEYS, cmdFaceTriangles, cmdWingPackages, parseCprCmd,
  parseTruckManifest, podPathTitle,
} from "../vendor/openphotex/index.js";
import { loadArtTexture } from "./art-texture.js";
import { decodeSmfModel, loadEvoModelTextures } from "./evo-models.js";
import { decodeModel } from "./models.js";
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
  const tireBase = stemOf(manifest.tireModelBaseName);
  const tire = async (side) => {
    for (const detail of ["16", "12", "08"]) {
      const model = tireBase ? await smf(`${tireBase}${detail}${side}`) : null;
      if (model?.meshes.length) return model;
    }
    return null;
  };
  const parts = { body: await smf(stemOf(manifest.truckModelBaseName)), tireLeft: await tire("L"), tireRight: await tire("R") };
  if (!parts.body?.meshes.length) return null;
  const textures = await loadEvoModelTextures(view, parts);
  return {
    name: manifest.truckName, parts, textures,
    anchors: EVO_WHEEL_KEYS.map((key) => xyz(manifest.wheelAnchors[key])),
    scrapePoints: (manifest.scrapePoints ?? []).map(xyz),
    tire: tireSize(parts.tireLeft ?? parts.tireRight), game,
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
 * scrapePoints, textures, tire, suspension: null, lights: [], lightTextures: {} }`, `file` its `<GAME>:<file>` name.
 */
export async function buildForeignTruckRender(vfs, id) {
  const named = parseForeignTruckId(id);
  const view = named && vfs.scoped?.(named.game);
  if (!view) return null;
  const built = named.game === "CPR" ? await cprCar(view, named.file) : await evoTruck(view, named.file, named.game);
  if (!built || built.anchors.some((a) => !a)) return null;
  return { ...built, file: foreignTruckId(named.game, named.file), suspension: null, lights: [], lightTextures: {} };
}
