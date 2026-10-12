/*
  The mesh of the drawn ground (docs/VISUALS.md, "Terrain"): cut as finely as each cell needs,
  with no cracks between cells or between the two levels of detail.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { mtm2Sim } from "../src/vendor/openphotex/index.js";
import { buildReliefData, createRelief } from "../src/game/terrain-relief.js";
import { CHUNK_CELLS, TOLERANCES_FT, VIEW_NEAR_FT, buildReliefMesh, viewDistances } from "../src/worker/relief-mesh.js";
import { buildTerrainAtlas, buildTerrainMesh } from "../src/worker/terrain-mesh.js";
import { skipWithoutStock, stockVfs } from "./helpers/stock.mjs";

const GRID = 256, CELLS = GRID * GRID;
const atlas = buildTerrainAtlas([null, null]);

/** Level ground with a hill, a cliff and a pit near the middle, clear of the chunk borders except where the cliff crosses one. */
function testLevel() {
  const heights = new Uint8Array(CELLS).fill(20);
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const hill = Math.max(0, 30 - Math.hypot(col - 40, row - 40) * 2.2);
      const cliff = col >= 120 && col < 135 && row > 20 && row < 110 ? 70 : 0;
      const pit = Math.max(0, 12 - Math.hypot(col - 90, row - 150));
      heights[row * GRID + col] = Math.round(20 + hill + cliff - pit);
    }
  }
  return heights;
}

function meshOf(heights, options = {}) {
  const clr = new Uint16Array(CELLS);
  const data = buildReliefData({ clr, textureValues: [1200, 100] });
  const relief = createRelief({ heights, ...data });
  return { relief, clr, mesh: buildReliefMesh({ heights, clr, lte: null, atlas, relief, ...options }) };
}

const position = (lod, v) => [lod.positions[v * 3], lod.positions[v * 3 + 1], lod.positions[v * 3 + 2]];
const key = (p) => `${p[0]},${p[2]}`;

/** Every edge of every triangle, by the places of its ends: how many triangles use it in each direction. */
function edgeUse(lod) {
  const edges = new Map();
  for (let i = 0; i < lod.indices.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = position(lod, lod.indices[i + k]), b = position(lod, lod.indices[i + (k + 1) % 3]);
      const forward = `${key(a)}|${key(b)}`, back = `${key(b)}|${key(a)}`;
      if (edges.has(back)) edges.get(back).back++; else if (edges.has(forward)) edges.get(forward).forward++; else edges.set(forward, { forward: 1, back: 0, a, b });
    }
  }
  return edges;
}

test("a level with nothing to smooth is the game's own two triangles a cell", () => {
  const heights = new Uint8Array(CELLS).fill(33);
  const { mesh } = meshOf(heights);
  assert.deepEqual(mesh.cuts, { 1: CELLS, 2: 0, 4: 0, 8: 0 });
  for (const lod of [mesh.fine, mesh.coarse]) {
    assert.equal(lod.indices.length, CELLS * 6);
    assert.equal(lod.positions.length, CELLS * 4 * 3);
    assert.equal(lod.chunks.length, (GRID / CHUNK_CELLS) ** 2);
  }
  assert.equal(mesh.toleranceFt, TOLERANCES_FT[0]);
});

test("rough cells are cut finer, smooth ones are not, and every vertex is on the drawn surface", () => {
  const heights = testLevel();
  const { mesh, relief } = meshOf(heights);
  assert.ok(mesh.cuts[8] > 50, `cliff cells in eight parts: ${mesh.cuts[8]}`);
  assert.ok(mesh.cuts[1] > CELLS * 0.9, `most of the level is plain: ${mesh.cuts[1]}`);
  const { fine } = mesh;
  for (let v = 0; v < fine.positions.length / 3; v += 7) {
    const [x, y, z] = position(fine, v);
    assert.ok(Math.abs(y - relief.heightAt(x, -z)) < 1e-4, `vertex ${v} at ${x}, ${-z}`);
  }
  // Far from the features the mesh is the simulation's surface exactly.
  const terrain = mtm2Sim.createTerrain(heights);
  assert.equal(relief.heightAt(200 * 32 + 7, 200 * 32 + 3), mtm2Sim.terrainHeightAt(terrain, 200 * 32 + 7, 200 * 32 + 3));
});

test("no cracks: every edge inside the mesh is shared by exactly two triangles, facing up", () => {
  const { mesh } = meshOf(testLevel());
  for (const [name, lod] of [["fine", mesh.fine], ["coarse", mesh.coarse]]) {
    // Facing up: anticlockwise seen from above.
    for (let i = 0; i < lod.indices.length; i += 3) {
      const a = position(lod, lod.indices[i]), b = position(lod, lod.indices[i + 1]), c = position(lod, lod.indices[i + 2]);
      const e1 = [b[0] - a[0], b[2] - a[2]], e2 = [c[0] - a[0], c[2] - a[2]];
      assert.ok(e1[1] * e2[0] - e1[0] * e2[1] > 0, `${name} triangle ${i / 3}`);
    }
    let rim = 0;
    for (const [id, use] of edgeUse(lod)) {
      // The same two ends carry the same heights from both sides.
      if (use.forward === 1 && use.back === 1) continue;
      // The world's own rim: x or z at 0 or 8192, where the mesh ends and its copy begins.
      const onRim = (use.a[0] === use.b[0] && (use.a[0] === 0 || use.a[0] === 8192)) || (use.a[2] === use.b[2] && (use.a[2] === 0 || use.a[2] === -8192));
      assert.ok(onRim && use.forward + use.back === 1, `${name} edge ${id} used ${use.forward}+${use.back}`);
      rim++;
    }
    assert.ok(rim >= 4 * GRID, `${name}: the rim is there`);
  }
});

test("points that share a place share a height, so cells meet to the last bit", () => {
  const { mesh } = meshOf(testLevel());
  const seen = new Map();
  for (let v = 0; v < mesh.fine.positions.length / 3; v++) {
    const p = position(mesh.fine, v), k = key(p);
    if (seen.has(k)) assert.equal(p[1], seen.get(k), k); else seen.set(k, p[1]);
  }
});

test("the two levels of detail meet point for point on every chunk border, and nowhere need more", () => {
  const { mesh } = meshOf(testLevel());
  const border = (lod) => {
    const points = new Map();
    for (let v = 0; v < lod.positions.length / 3; v++) {
      const p = position(lod, v);
      if (p[0] % (CHUNK_CELLS * 32) === 0 || p[2] % (CHUNK_CELLS * 32) === 0) points.set(key(p), p[1]);
    }
    return points;
  };
  const fine = border(mesh.fine), coarse = border(mesh.coarse);
  assert.equal(fine.size, coarse.size);
  for (const [k, y] of fine) assert.equal(coarse.get(k), y, k);
  // The cliff crosses the border between the first two chunk rows (row 64), so that border is cut finely in both.
  assert.ok([...fine.keys()].some((k) => k.endsWith(`,${-64 * 32}`) && Number(k.split(",")[0]) % 32 !== 0));
  // Away from the borders the coarse level is two triangles a cell.
  assert.ok(mesh.coarse.indices.length < mesh.fine.indices.length);
  assert.ok(mesh.coarse.indices.length < CELLS * 6 * 1.01, "barely more than the plain mesh");
  assert.ok(mesh.coarse.indices.length > CELLS * 6, "but more: the border edges the cliff crosses");
});

test("a tight budget cuts the level more coarsely instead of overrunning it", () => {
  const heights = testLevel();
  const open = meshOf(heights).mesh;
  const tight = meshOf(heights, { vertexBudget: 290000 }).mesh;
  assert.ok(tight.toleranceFt > open.toleranceFt);
  assert.ok(tight.fine.positions.length < open.fine.positions.length);
  assert.ok(tight.cuts[8] < open.cuts[8]);
});

test("a cell is cut for how far off it is seen: along the course to the tolerance, further off as much coarser as it is further", () => {
  // A course across the hill (cells about row 40, column 40); the cliff (columns 120 to 135) lies some 2000 ft past its end.
  const course = [{ startFt: [500, 0, 1296], endFt: [2100, 0, 1296] }];
  const seen = viewDistances([course]);
  assert.equal(VIEW_NEAR_FT, 60);
  assert.equal(seen[40 * GRID + 40], 1, "the hill the course crosses");
  assert.ok(Math.abs(seen[40 * GRID + 127] - (127.5 * 32 - 2100) / VIEW_NEAR_FT) < 1, `the cliff: ${seen[40 * GRID + 127]}`);
  // The world wraps: a cell at its east edge is near a course that starts at its west edge.
  assert.ok(viewDistances([[{ startFt: [10, 0, 1296], endFt: [300, 0, 1296] }]])[40 * GRID + 255] < 1.5);
  assert.ok(viewDistances([]).every((v) => v === 1), "with no course every cell is seen from near");

  const heights = testLevel();
  const open = meshOf(heights).mesh, along = meshOf(heights, { courses: [course] }).mesh;
  assert.equal(along.toleranceFt, open.toleranceFt);
  assert.ok(along.cuts[8] < open.cuts[8] && along.fine.positions.length < open.fine.positions.length);
  // Beside the course the cut is the same.
  const beside = (lod) => { let n = 0; for (let v = 0; v < lod.positions.length / 3; v++) { const [x, , z] = position(lod, v); if (x > 900 && x < 1700 && Math.abs(-z - 1296) < 50) n++; } return n; };
  assert.equal(beside(along.fine), beside(open.fine));
  // A budget too small for the tightest tolerance everywhere still affords it where the cameras are.
  const tight = meshOf(heights, { vertexBudget: 290000 }).mesh, tightAlong = meshOf(heights, { vertexBudget: 290000, courses: [course] }).mesh;
  assert.ok(tight.toleranceFt > TOLERANCES_FT[0]);
  assert.equal(tightAlong.toleranceFt, TOLERANCES_FT[0]);
});

test("textures and baked shade are the plain mesh's: tile corners at the cell's corners, the LTE in between", () => {
  const heights = testLevel();
  const clr = new Uint16Array(CELLS);
  clr[40 * GRID + 40] = 1 | (1 << 14);
  const lte = new Uint8Array(CELLS * 7).fill(200);
  lte[(40 * GRID + 40) * 7] = 100;
  const relief = createRelief({ heights, ...buildReliefData({ clr, textureValues: [1200, 1200] }) });
  const mesh = buildReliefMesh({ heights, clr, lte, atlas, relief });
  const plain = buildTerrainMesh({ heights, clr, lte, atlas });
  assert.equal(mesh.hasLte, true);
  // The four corners of cell (40, 40) in the fine mesh carry the plain mesh's uvs for that cell.
  const cell = 40 * GRID + 40;
  const want = [0, 1, 2, 3].map((k) => [plain.uvs[(cell * 4 + k) * 2], plain.uvs[(cell * 4 + k) * 2 + 1]]);
  const { fine } = mesh;
  const range = fine.chunks[0];
  const found = new Set();
  for (let i = range.start; i < range.start + range.count; i++) {
    const v = fine.indices[i], [x, , z] = position(fine, v);
    const k = [[1280, -1280], [1312, -1280], [1312, -1312], [1280, -1312]].findIndex(([px, pz]) => px === x && pz === z);
    if (k < 0) continue;
    const uv = [fine.uvs[v * 2], fine.uvs[v * 2 + 1]];
    if (Math.abs(uv[0] - want[k][0]) < 1e-6 && Math.abs(uv[1] - want[k][1]) < 1e-6) found.add(k);
  }
  assert.deepEqual([...found].sort(), [0, 1, 2, 3]);
  // The corner with the dark LTE byte is dark; the shade is a byte per channel.
  let darkest = 255;
  for (let v = 0; v < fine.positions.length / 3; v++) if (fine.positions[v * 3] === 1280 && fine.positions[v * 3 + 2] === -1280) darkest = Math.min(darkest, fine.colors[v * 3]);
  assert.equal(darkest, 100);
});

test("with the level's sun, a rough cell's shade follows how its relief faces the light", () => {
  const heights = testLevel();
  const lit = meshOf(heights, { sunVector: [46333, -46333, 0] }).mesh.fine;
  const unlit = meshOf(heights).mesh.fine;
  assert.equal(lit.colors.length, unlit.colors.length);
  let changed = 0, same = 0;
  for (let v = 0; v < lit.colors.length / 3; v++) {
    if (lit.colors[v * 3] !== unlit.colors[v * 3]) changed++; else same++;
    assert.ok(lit.colors[v * 3] >= 127 && lit.colors[v * 3] <= 255);
  }
  assert.ok(changed > 500, `${changed} vertices take the light`);
  assert.ok(same > changed, "plain ground keeps its baked shade");
});

test("a stadium's footprint limits the mesh", () => {
  const heights = testLevel();
  const footprint = { col0: 113, col1: 127, row0: 93, row1: 107 };
  const clr = new Uint16Array(CELLS);
  const relief = createRelief({ heights, ...buildReliefData({ clr, textureValues: [1200], footprint }) });
  const mesh = buildReliefMesh({ heights, clr, lte: null, atlas, relief, footprint });
  const drawn = mesh.cuts[1] + mesh.cuts[2] + mesh.cuts[4] + mesh.cuts[8];
  assert.equal(drawn, 14 * 14);
  for (let v = 0; v < mesh.fine.positions.length / 3; v++) {
    const [x, , z] = position(mesh.fine, v);
    assert.ok(x >= 113 * 32 && x <= 127 * 32 && -z >= 93 * 32 && -z <= 107 * 32);
  }
});

test("what stands on the ground holds it to the game's: objects by their model's reach, ramps by their box", async () => {
  const { groundKeepouts } = await import("../src/worker/track-build.js");
  const models = {
    "BARN.BIN": { bounds: { min: [-30, 0, -40], max: [30, 25, 40] } },
    "TREE.BIN": { bounds: { min: [-8, 0, -0.1], max: [8, 30, 0.1] } },
    "SIGN.BIN": { bounds: { min: [-900, 0, -900], max: [900, 10, 900] } },
    "BANNER.BIN": { bounds: { min: [-20, 40, -1], max: [20, 50, 1] } },
  };
  const boxes = [
    { positionFt: [100, 12, 200] }, { positionFt: [500, 12, 600] }, { positionFt: [900, 12, 900] }, { positionFt: [50, 12, 50] }, { positionFt: null },
  ];
  const objects = [
    { model: "BARN.BIN", sitIndex: 0 }, { model: "TREE.BIN", sitIndex: 1, billboard: true }, { model: "SIGN.BIN", sitIndex: 2 },
    { model: "BANNER.BIN", sitIndex: 3 }, { model: "BARN.BIN", sitIndex: 4 }, { model: "GONE.BIN", sitIndex: 0 },
  ];
  const ramps = [{ positionFt: [1000, 12, 2000], sizeFt: [60, 80, 10] }];
  const keepouts = groundKeepouts({ objects, boxes, ramps, models, groundAt: () => 12 });
  assert.deepEqual(keepouts, [
    { x: 100, z: 200, radius: 50 },    // the barn: its footprint's half diagonal
    { x: 500, z: 600, radius: 8 },     // the tree faces the camera: half its width
    { x: 900, z: 900, radius: 400 },   // nothing holds more than 400 ft
    { x: 1000, z: 2000, radius: 50 },  // the ramp: its length and width, not its height
  ]);
  // The banner hangs 40 ft over the ground and is left out; so are a box with no place and a model that did not load.
});

test("stock tracks: the drawn ground is built within its budget, and is the game's wherever something stands on it", { skip: skipWithoutStock("POD.INI") }, async () => {
  const { buildTrackRender } = await import("../src/worker/track-build.js");
  const { DEFAULT_VERTEX_BUDGET } = await import("../src/worker/relief-mesh.js");
  const vfs = stockVfs();
  for (const name of ["TPARK", "ROCKQRY", "SUMMIT1"]) {
    const plain = await buildTrackRender(vfs, `WORLD\\${name}.SIT`);
    assert.ok(plain.terrain.indices && !plain.terrain.relief && plain.relief === null && plain.groundMap === null && plain.puddles === null, `${name}: nothing extra unless asked`);
    const build = await buildTrackRender(vfs, `WORLD\\${name}.SIT`, { visuals: { smoothing: true, groundMap: true, puddles: true } });
    const { fine, coarse } = build.terrain.relief;
    assert.ok(fine.positions.length / 3 <= DEFAULT_VERTEX_BUDGET, `${name}: ${fine.positions.length / 3} vertices`);
    assert.ok(coarse.indices.length <= fine.indices.length);
    assert.equal(build.terrain.hasLte, plain.terrain.hasLte);
    assert.equal(build.groundMap.heights.length, build.groundMap.side ** 2);
    assert.equal(build.puddles.depth.length, build.puddles.side ** 2);
    const relief = createRelief({ heights: build.heights, ...build.relief });
    // Every drawn object and every ground box stands on ground that is exactly the game's.
    for (let k = 0; k < build.relief.keepouts.length; k += 4) assert.equal(relief.offsetAt(build.relief.keepouts[k], build.relief.keepouts[k + 1]), 0, `${name}: object ${k / 4}`);
    for (let i = 0; i < build.groundBoxes?.positions.length; i += 300) {
      const x = build.groundBoxes.positions[i], z = -build.groundBoxes.positions[i + 2];
      assert.ok(Math.abs(relief.offsetAt(x, z)) < 1e-9, `${name}: ground box corner at ${x}, ${z}`);
    }
    // Along the course, the drawn ground is the smoothing of the game's and no more: inches as a rule.
    const offsets = [];
    for (const straight of build.sim.course) {
      for (let s = 0; s <= 1; s += 0.02) offsets.push(Math.abs(relief.offsetAt(straight.startFt[0] + (straight.endFt[0] - straight.startFt[0]) * s, straight.startFt[2] + (straight.endFt[2] - straight.startFt[2]) * s)));
    }
    offsets.sort((a, b) => a - b);
    assert.ok(offsets[Math.floor(offsets.length / 2)] < 0.25, `${name}: median ${offsets[Math.floor(offsets.length / 2)]} ft off along the course`);
  }
});

test("built for Snow, every vertex carries the snow's settled depth, and the mesh is cut for the snow's surface too", async () => {
  const { createSnowCover, SNOW_DEPTH_SCALE_FT, SNOW_MAX_FT, SNOW_TRACK_SHARE } = await import("../src/game/snow-cover.js");
  // Level ground with a course across it: nothing to smooth, so without snow it is two triangles a cell.
  const heights = new Uint8Array(CELLS).fill(30), clr = new Uint16Array(CELLS);
  const course = [{ startFt: [1000, 0, 3000], endFt: [5000, 0, 3000], trackWidthFt: 40 }];
  const data = buildReliefData({ clr, textureValues: [200], courses: [course] });
  const relief = createRelief({ heights, ...data });
  const snow = createSnowCover({ relief, calm: data.calm, held: data.smooth });
  const bare = buildReliefMesh({ heights, clr, lte: null, atlas, relief });
  const mesh = buildReliefMesh({ heights, clr, lte: null, atlas, relief, snow });
  assert.equal(bare.fine.snow, undefined);
  assert.deepEqual(bare.cuts, { 1: CELLS, 2: 0, 4: 0, 8: 0 });
  // The bank beside the course is a few feet wide: the cells it crosses are cut for it, the open ground is not.
  assert.ok(mesh.cuts[4] + mesh.cuts[8] > 200, `cells cut finely: ${mesh.cuts[4]} + ${mesh.cuts[8]}`);
  assert.ok(mesh.cuts[1] > CELLS * 0.97, `open ground stays whole: ${mesh.cuts[1]}`);
  for (const lod of [mesh.fine, mesh.coarse]) {
    assert.equal(lod.snow.length, lod.positions.length / 3);
    const byPlace = new Map();
    let onCourse = 0, open = 0;
    for (let v = 0; v < lod.snow.length; v++) {
      const [x, , z] = position(lod, v);
      // The byte is the depth at the vertex.
      if (v % 11 === 0) assert.equal(lod.snow[v], Math.min(255, Math.round((Math.fround(snow.depthAt(x, -z)) / SNOW_DEPTH_SCALE_FT) * 255)), `vertex ${v}`);
      // Points that share a place share a depth: lifted, the snow's surface has no cracks either.
      const k = key([x, 0, z]);
      if (byPlace.has(k)) assert.equal(lod.snow[v], byPlace.get(k), k); else byPlace.set(k, lod.snow[v]);
      if (Math.abs(-z - 3000) < 8 && x > 1500 && x < 4500) onCourse = Math.max(onCourse, lod.snow[v]);
      if (Math.abs(-z - 6000) < 40) open = Math.max(open, lod.snow[v]);
    }
    // Thin along the course, deep on the open ground.
    assert.ok((onCourse / 255) * SNOW_DEPTH_SCALE_FT <= SNOW_MAX_FT * SNOW_TRACK_SHARE + 0.01, `on the course ${onCourse}`);
    assert.ok((open / 255) * SNOW_DEPTH_SCALE_FT > SNOW_MAX_FT * 0.8, `open ground ${open}`);
  }
  // Still watertight.
  for (const [id, use] of edgeUse(mesh.fine)) {
    if (use.forward === 1 && use.back === 1) continue;
    const onRim = (use.a[0] === use.b[0] && (use.a[0] === 0 || use.a[0] === 8192)) || (use.a[2] === use.b[2] && (use.a[2] === 0 || use.a[2] === -8192));
    assert.ok(onRim && use.forward + use.back === 1, `edge ${id} used ${use.forward}+${use.back}`);
  }
});

test("stock: a race in Snow is built with the snow's depth, with or without the smoothed ground, within the budget", { skip: skipWithoutStock("POD.INI") }, async () => {
  const { buildTrackRender } = await import("../src/worker/track-build.js");
  const { DEFAULT_VERTEX_BUDGET } = await import("../src/worker/relief-mesh.js");
  const vfs = stockVfs();
  for (const smoothing of [true, false]) {
    const build = await buildTrackRender(vfs, "WORLD\\ALASKA.SIT", { weather: 5, visuals: { smoothing, snow: true } });
    const { fine, coarse } = build.terrain.relief;
    assert.equal(fine.snow.length, fine.positions.length / 3);
    assert.equal(coarse.snow.length, coarse.positions.length / 3);
    assert.ok(fine.positions.length / 3 <= DEFAULT_VERTEX_BUDGET, `${fine.positions.length / 3} vertices`);
    assert.ok(build.snowCover.calm.length > 0 && build.snowCover.held.length === 65536);
    // Without the smoothed ground the mesh is the game's ground, cut only for the snow: nothing for the main thread to redraw.
    assert.equal(build.relief === null, !smoothing);
    let deepest = 0;
    for (const byte of fine.snow) if (byte > deepest) deepest = byte;
    const { SNOW_DEPTH_SCALE_FT, SNOW_MAX_FT } = await import("../src/game/snow-cover.js");
    assert.ok((deepest / 255) * SNOW_DEPTH_SCALE_FT > SNOW_MAX_FT * 0.9, `deepest ${deepest}`);
  }
  // Not in Snow: no depth, no data.
  const clear = await buildTrackRender(vfs, "WORLD\\ALASKA.SIT", { weather: 0, visuals: { smoothing: true } });
  assert.equal(clear.terrain.relief.fine.snow, undefined);
  assert.equal(clear.snowCover, null);
});
