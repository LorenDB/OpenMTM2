/*
  The tops of ground boxes as ground (MTM2_PHYSICS.md 2.5 and 14.18; docs/VISUALS.md, "Tracks"): a
  bridge's deck is a ground box, and what is over it stands on it.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { createDecks } from "../src/game/ground-boxes.js";
import { skipWithoutStock, stockVfs } from "./helpers/stock.mjs";

const GRID = 256, CELLS = GRID * GRID;

test("a thing over a ground box stands on its top; one under the box, or beside it, on the ground", () => {
  const heights = new Uint8Array(CELLS).fill(20);
  const ra0 = new Uint8Array(CELLS), ra1 = new Uint8Array(CELLS);
  // A deck from 100 to 110 ft (2 ft steps) over cell (10, 20), the ground at 40 ft under it.
  ra0[20 * GRID + 10] = 50;
  ra1[20 * GRID + 10] = 55;
  const decks = createDecks({ heights, ra0, ra1 });
  const x = 10 * 32 + 16, z = 20 * 32 + 16;
  assert.equal(decks.topAt(x, z, 113), 110, "a wheel's hub over the deck");
  assert.equal(decks.topAt(x, z, 101), 110, "anything above its underside");
  assert.equal(decks.topAt(x, z, 43), null, "a wheel in the gully under it");
  assert.equal(decks.topAt(x + 32, z, 113), null, "beside it");
  assert.equal(decks.topAt(x, z, undefined), null, "no height given: the ground");
  // A level without ground boxes has no decks.
  assert.equal(createDecks({ heights, ra0: new Uint8Array(CELLS), ra1: new Uint8Array(CELLS) }), null);
  assert.equal(createDecks({ heights, ra0: null, ra1: null }), null);
});

test("Sidewinder Canyon's bridges are ground boxes with no faces of their own, and a truck on one is on its deck", { skip: skipWithoutStock() }, async () => {
  const { buildCatalog } = await import("../src/worker/catalog.js");
  const { buildTrackRender } = await import("../src/worker/track-build.js");
  const { decodeGroundBoxes } = await import("../src/vendor/openphotex/index.js");
  const vfs = stockVfs();
  const track = (await buildCatalog(vfs)).tracks.find((t) => t.path.toUpperCase().endsWith("SNAKE.SIT"));
  const build = await buildTrackRender(vfs, track.path, { raceType: "rally" });
  const { ra0, ra1 } = build.sim;
  const boxes = decodeGroundBoxes(ra0, ra1, null, GRID);
  assert.ok(boxes.length > 100);
  const decks = createDecks({ heights: build.heights, ra0, ra1 });
  // The first of them, its middle: over it, its top; under it, the canyon's floor.
  const box = boxes.find((b) => b.x === 182 && b.y === 129);
  const x = box.x * 32 + 16, z = box.y * 32 + 16, top = box.upper * 2;
  assert.equal(decks.topAt(x, z, top + 3), top);
  assert.equal(decks.topAt(x, z, box.lower * 2 - 3), null);
});
