// The world in blocks (shared/object-chunks.js): everything that stands in it is cut into 512 ft blocks, and each block
// is drawn once, at the copy nearest the camera, as the game draws each cell once beside the view.

import test from "node:test";
import assert from "node:assert/strict";
import { OBJECT_CHUNK_FT, blockKey, blockShift, chunkTriangles, groupObjects, objectChunk } from "../src/shared/object-chunks.js";

const at = (x, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, z, 1];

test("a point's block is its 512 ft square", () => {
  assert.equal(OBJECT_CHUNK_FT, 512);
  assert.equal(blockKey(700, -900), "1,-2");
  assert.equal(objectChunk(at(700, -900)), "1,-2");
  assert.equal(blockKey(0, 0), "0,0");
});

test("a block is moved by whole worlds to the copy nearest the camera, however far the camera has gone", () => {
  assert.deepEqual(blockShift(256, -256, 300, -300), [0, 0]);
  // The camera at the far edge: the block at the near edge is drawn just past it.
  assert.deepEqual(blockShift(256, -256, 8100, -300), [8192, 0]);
  assert.deepEqual(blockShift(7936, -7936, 100, -100), [-8192, 8192]);
  // Three worlds away along x, and one back along z.
  assert.deepEqual(blockShift(256, -256, 3 * 8192 + 400, 8192 - 200), [3 * 8192, 8192]);
  // Half a world is the limit of what is nearest: every block is within 4096 ft of the camera on each axis.
  for (const camera of [0, 1000, 4095, 4097, 8000, 20000, -9000]) {
    for (let x = 256; x < 8192; x += 512) {
      const [dx] = blockShift(x, 0, camera, 0);
      assert.ok(Math.abs(x + dx - camera) <= 4096, `block ${x} for a camera at ${camera}`);
    }
  }
});

test("scenery is grouped into blocks that hold every placement once", () => {
  const objects = [];
  for (let x = 32; x < 8192; x += 64) for (let z = 32; z < 8192; z += 64) objects.push({ model: "PINE", matrix: at(x, -z) });
  [[100, -100], [4000, -4000], [8000, -8000]].forEach(([x, z], i) => objects.push({ model: "HUT", matrix: at(x, z), sitIndex: i }));
  const { meshes, slots } = groupObjects(objects);
  const pines = [...meshes].filter(([key]) => key.startsWith("PINE#"));
  assert.equal(pines.length, 256, "16 by 16 blocks");
  assert.equal(pines.reduce((n, [, m]) => n + m.matrices.length, 0), 128 * 128);
  // A model in few places is in blocks too: each of its places can then be drawn beside the camera by itself.
  assert.equal([...meshes].filter(([key]) => key.startsWith("HUT#")).length, 3);
  assert.deepEqual(slots[1], ["HUT#7,-8", 0]);
  for (const [key, { matrices }] of pines) {
    const [cx, cz] = key.split("#")[1].split(",").map(Number);
    for (const m of matrices) assert.ok(Math.floor(m[12] / 512) === cx && Math.floor(m[14] / 512) === cz);
  }
});

test("a mesh's triangles by block: every triangle once, in the block its first corner is in", () => {
  // Two quads of two triangles, one at x 100 and one at x 600.
  const positions = new Float32Array([100, 0, -10, 132, 0, -10, 100, 0, -42, 132, 0, -42, 600, 0, -10, 632, 0, -10, 600, 0, -42, 632, 0, -42]);
  const indices = new Uint32Array([0, 2, 1, 2, 3, 1, 4, 6, 5, 6, 7, 5]);
  const blocks = chunkTriangles(positions, indices);
  assert.deepEqual([...blocks.keys()].sort(), ["0,-1", "1,-1"]);
  assert.deepEqual([...blocks.get("0,-1")], [0, 2, 1, 2, 3, 1]);
  assert.deepEqual([...blocks.get("1,-1")], [4, 6, 5, 6, 7, 5]);
});

test("a block's bounds are those of its own triangles, not of the mesh's whole list of vertices", async () => {
  const { indexedBounds } = await import("../src/shared/object-chunks.js");
  // A strip of ground from x 0 to 8192 in 512 ft quads; each block shares the one list of vertices.
  const positions = [], indices = [];
  for (let i = 0; i < 16; i++) {
    const x = i * 512, v = positions.length / 3;
    positions.push(x, 10, -10, x + 500, 10, -10, x, 30, -500, x + 500, 30, -500);
    indices.push(v, v + 2, v + 1, v + 2, v + 3, v + 1);
  }
  const blocks = chunkTriangles(new Float32Array(positions), new Uint32Array(indices));
  assert.equal(blocks.size, 16);
  for (const [key, list] of blocks) {
    const { center, radius } = indexedBounds(positions, list);
    const cx = Number(key.split(",")[0]);
    assert.ok(Math.abs(center[0] - (cx * 512 + 250)) < 1e-6, `block ${key} is centred at x ${center[0]}`);
    assert.ok(radius < 400, `and is ${radius} ft in radius, not the world's`);
    // So with the camera at the near edge, the far blocks are drawn just behind it and the near ones stay.
    const [dx] = blockShift(center[0], center[2], 100, 0);
    assert.equal(dx, center[0] > 4196 ? -8192 : 0);
  }
  assert.deepEqual(indexedBounds(positions, []), { center: [0, 0, 0], radius: 0 });
});
