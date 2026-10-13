import { test } from "node:test";
import assert from "node:assert/strict";
import { CAB_STYLES, DEFAULT_VR, vrSettings } from "../src/game/vr/settings.js";
import { ART_FOCAL_PX, STOCK_GAUGES, panelPixel } from "../src/game/vr/cab.js";
import { PANEL_H, PANEL_HALF_FT, PANEL_LIFT_FT, PANEL_W, frontRect, needleQuad, panelBox } from "../src/game/vr/panels.js";

const near = (a, b) => Math.abs(a - b) < 1e-6;

test("the stock panels hang where the pictures' camera puts them: every pixel in the direction it was drawn in", () => {
  assert.equal(PANEL_W, 640);
  assert.equal(PANEL_H, 480);
  const box = panelBox();
  // The front picture whole, five feet ahead: 106 degrees wide, 90 tall.
  assert.deepEqual(box.front.position, [0, 0, -PANEL_HALF_FT]);
  assert.deepEqual(box.front.columns, [0, 640]);
  assert.ok(near(box.front.width, 2 * PANEL_HALF_FT * 320 / ART_FOCAL_PX) && near(box.front.height, 2 * PANEL_HALF_FT));
  // The sides hang at its edges and begin where it ends: the column that looks 53 degrees aside of ahead.
  const wide = box.front.width / 2;
  assert.ok(near(box.right.position[0], wide) && near(box.left.position[0], -wide));
  assert.deepEqual(box.right.columns.map(Math.round), [140, 640]);
  assert.deepEqual(box.left.columns.map(Math.round), [0, 500]);
  assert.ok(near(box.back.position[2], box.right.position[2] + box.right.width / 2));
  assert.deepEqual(box.back.columns.map(Math.round), [140, 500]);
  assert.deepEqual([box.front.rotationY, box.back.rotationY, box.left.rotationY, box.right.rotationY], [0, Math.PI, Math.PI / 2, -Math.PI / 2]);
  // Each side's feet per pixel is its distance over the focal length, across and up alike.
  for (const [side, distance] of [["front", PANEL_HALF_FT], ["right", wide], ["left", wide], ["back", box.back.position[2]]]) {
    const { width, height, columns } = box[side];
    assert.ok(near(width / (columns[1] - columns[0]), distance / ART_FOCAL_PX), side);
    assert.ok(near(height / PANEL_H, distance / ART_FOCAL_PX), side);
  }
  // The box closes: the sides run from the front panel's plane to the back one's, the back one from side to side.
  assert.ok(near(box.right.position[2] - box.right.width / 2, -PANEL_HALF_FT));
  assert.ok(near(box.back.width, 2 * wide));
  // A point of a side panel is seen where the pictures' camera has that pixel: the right panel's column 390, row 100.
  const column = 390, row = 100, foot = wide / ART_FOCAL_PX;
  const [from, to] = box.right.columns;
  const along = -box.right.width / 2 + (column - from) / (to - from) * box.right.width;
  // In the cab's frame -z is ahead; the art frame has z ahead.
  const point = [box.right.position[0], (PANEL_H / 2 - row) * foot, -(box.right.position[2] + along)];
  const seen = panelPixel("right", point);
  assert.ok(near(seen[0], column) && near(seen[1], row), `seen at ${seen}`);
});

test("a front panel rectangle lands where its pixels are, lifted ahead of the panel", () => {
  const box = panelBox();
  // The whole panel maps back onto itself, the lift ahead.
  const whole = frontRect([0, 0, PANEL_W, PANEL_H]);
  assert.ok(near(whole.size[0], box.front.width) && near(whole.size[1], box.front.height));
  assert.ok(near(whole.position[0], 0) && near(whole.position[1], 0));
  assert.ok(near(whole.position[2], -PANEL_HALF_FT + PANEL_LIFT_FT));
  // The stock steering wheel rect: centred, in the lower half.
  const wheel = frontRect([145, 330, 350, 150]);
  assert.ok(Math.abs(wheel.position[0]) < box.front.width * 0.05, "about the middle");
  assert.ok(wheel.position[1] < 0, "below the eyes");
  assert.ok(near(wheel.size[0] / box.front.width, 350 / PANEL_W) && near(wheel.size[1] / box.front.height, 150 / PANEL_H));
  // Its middle is seen where the picture has it.
  const seen = panelPixel("front", [wheel.position[0], wheel.position[1], PANEL_HALF_FT]);
  assert.ok(near(seen[0], 320) && near(seen[1], 405));
  // Halving the distance halves everything but the lift.
  const small = frontRect([0, 0, PANEL_W, PANEL_H], PANEL_HALF_FT / 2);
  assert.ok(near(small.size[0], box.front.width / 2) && near(small.size[1], box.front.height / 2));
});

test("a needle sits on its gauge's centre, twice its radius across", () => {
  for (const which of ["speedometer", "tachometer"]) {
    const gauge = STOCK_GAUGES[which];
    const quad = needleQuad(gauge);
    const across = 2 * gauge.radius * PANEL_HALF_FT / ART_FOCAL_PX;
    assert.ok(near(quad.size[0], across) && near(quad.size[1], across));
    // The quad's middle is the gauge's middle.
    const middle = frontRect([gauge.center[0] - gauge.radius, gauge.center[1] - gauge.radius, 2 * gauge.radius, 2 * gauge.radius]);
    assert.deepEqual(quad.position, middle.position);
    const seen = panelPixel("front", [quad.position[0], quad.position[1], PANEL_HALF_FT]);
    assert.ok(near(seen[0], gauge.center[0]) && near(seen[1], gauge.center[1]));
  }
  assert.equal(needleQuad(null), null);
  assert.equal(needleQuad(undefined), null);
});

test("cab styles: the modelled cage first, the stock panels, repaired when stored wrong", () => {
  assert.deepEqual(CAB_STYLES.map((v) => v.id), ["model", "panels"]);
  assert.equal(DEFAULT_VR.cabStyle, "model");
  assert.equal(vrSettings(undefined).cabStyle, "model");
  assert.equal(vrSettings({ cabStyle: "panels" }).cabStyle, "panels");
  assert.equal(vrSettings({ cabStyle: "cube" }).cabStyle, "model");
  assert.equal(vrSettings({ cabStyle: true }).cabStyle, "model");
});
