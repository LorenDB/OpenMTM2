import test from "node:test";
import assert from "node:assert/strict";
import { NAME_COLOURS, nameTagLineColour, nameTagPaintKey } from "../src/render/name-tag-style.js";

test("an extension colour repaints every line of a truck name tag", () => {
  assert.equal(nameTagLineColour(0), NAME_COLOURS[0]);
  assert.equal(nameTagLineColour(1), NAME_COLOURS[1]);
  assert.equal(nameTagLineColour(0, "#2979ff"), "#2979ff");
  assert.equal(nameTagLineColour(1, "#2979ff"), "#2979ff");
  assert.notEqual(nameTagPaintKey(["Driver", "Truck"], "#2979ff"), nameTagPaintKey(["Driver", "Truck"], "#e8231c"));
});
