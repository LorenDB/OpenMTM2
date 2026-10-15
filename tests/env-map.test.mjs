import test from "node:test";
import assert from "node:assert/strict";
import { skipWithoutStock, stockVfs } from "./helpers/stock.mjs";
import { truckEnvMap } from "../src/worker/env-map.js";

const colours = ({ rgba }) => new Set(Array.from({ length: rgba.length / 4 }, (_, i) => `${rgba[i * 4]},${rgba[i * 4 + 1]},${rgba[i * 4 + 2]}`)).size;

test("the truck reflection is CLOUDENV in its own colours, and in Rain, Dusk and Night the sky's sixteen (0x522ee0)", { skip: skipWithoutStock("STARTUP.POD") }, async () => {
  const vfs = stockVfs();
  const clear = await truckEnvMap(vfs, 0);
  assert.equal(clear.width, 256);
  assert.equal(clear.height, 256);
  assert.ok(colours(clear) > 16);
  for (const weather of [4, 6, 7]) assert.ok(colours(await truckEnvMap(vfs, weather)) <= 16, `weather ${weather}`);
});
