/*
  Cut-out pictures (docs/VISUALS.md, "Light"): their see-through texels take the colour of the
  picture beside them, so filtering does not draw the background's colour round every leaf.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { bleedCutout } from "../src/game/cutouts.js";

/** An image from rows of letters: `G` a solid green texel, `R` a solid red one, `.` see-through black. */
function picture(rows) {
  const width = rows[0].length, height = rows.length, rgba = new Uint8Array(width * height * 4);
  rows.forEach((row, y) => [...row].forEach((c, x) => rgba.set(c === "G" ? [0, 200, 0, 255] : c === "R" ? [200, 0, 0, 255] : [0, 0, 0, 0], (y * width + x) * 4)));
  return { rgba, width, height };
}
const texel = (image, x, y) => Array.from(image.rgba.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));

test("a cut-out's background takes the picture's colour for three texels out, and stays see-through", () => {
  const image = picture([
    "...........",
    "...........",
    "...........",
    "...........",
    "...........",
    ".....G.....",
    "...........",
    "...........",
    "...........",
    "...........",
    "...........",
  ]);
  bleedCutout(image);
  assert.deepEqual(texel(image, 5, 5), [0, 200, 0, 255], "the picture itself is untouched");
  for (const [x, y] of [[4, 5], [6, 6], [5, 3], [8, 5], [2, 2], [8, 8]]) assert.deepEqual(texel(image, x, y), [0, 200, 0, 0], `(${x}, ${y}) is green and see-through`);
  // Four texels out the background keeps its own colour: filtering never reaches it.
  for (const [x, y] of [[1, 5], [5, 1], [10, 5], [5, 10]]) assert.deepEqual(texel(image, x, y), [0, 0, 0, 0], `(${x}, ${y})`);
  // One pass carries it one texel.
  const once = picture(["....", ".G..", "....", "...."]);
  bleedCutout(once, 1);
  assert.deepEqual(texel(once, 2, 1), [0, 200, 0, 0]);
  assert.deepEqual(texel(once, 3, 1), [0, 0, 0, 0]);
});

test("between two colours the background takes their mean, and the picture's edges are neighbours across the repeat", () => {
  const image = picture(["G.R"]);
  bleedCutout(image, 1);
  assert.deepEqual(texel(image, 1, 0), [100, 100, 0, 0]);
  const wrapped = picture(["G...", "....", "....", "...."]);
  bleedCutout(wrapped, 1);
  assert.deepEqual(texel(wrapped, 3, 0), [0, 200, 0, 0], "the last column is beside the first");
  assert.deepEqual(texel(wrapped, 3, 3), [0, 200, 0, 0], "and the last corner beside the first");
  assert.deepEqual(texel(wrapped, 2, 2), [0, 0, 0, 0]);
  // A picture with nothing see-through, or nothing solid, is left as it is.
  const solid = picture(["GR", "RG"]), before = solid.rgba.slice();
  bleedCutout(solid);
  assert.deepEqual(solid.rgba, before);
  const empty = picture(["..", ".."]);
  bleedCutout(empty);
  assert.deepEqual(Array.from(empty.rgba), new Array(16).fill(0));
});
