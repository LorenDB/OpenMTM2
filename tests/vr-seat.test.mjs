import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAB_Z, EYE_FORWARD_FT, HEADROOM_FT, SEAT_LIMIT_FT, cabRoofHeight, cleanSeatOffset, moveSeat, seatEye, seatFromBody,
} from "../src/game/vr/seat.js";
import {
  DEFAULT_VR, VIEW_DISTANCES, VR_VIEWS, nextVrView, seatOffsetFor, viewRange, vrSettings, vrView, withSeatOffset,
} from "../src/game/vr/settings.js";
import { skipWithoutStock, stockVfs } from "./helpers/stock.mjs";

/** A triangle in scene coordinates from body-frame corners [right, up, forward]. */
const tri = (...corners) => corners.flatMap(([x, y, z]) => [x, y, -z]);
/** A level rectangle at height `y` over [x0, x1] by [z0, z1], as two triangles. */
const slab = (y, x0, x1, z0, z1) => [
  ...tri([x0, y, z0], [x1, y, z0], [x1, y, z1]), ...tri([x0, y, z0], [x1, y, z1], [x0, y, z1]),
];

test("the seat: a foot under the cab roof, a foot ahead of the body's origin, on the centre line", () => {
  // A pickup: hood, cab roof, bed, and a light bar behind the cab that is higher than the roof.
  const body = [{ positions: new Float32Array([
    ...slab(3.0, -3, 3, 4, 9), ...slab(4.9, -3, 3, -1, 3.5), ...slab(2.8, -3, 3, -9, -1), ...slab(7.4, -2, 2, -7.5, -6.5),
  ]) }];
  assert.ok(Math.abs(cabRoofHeight(body) - 4.9) < 1e-6);
  const eye = seatFromBody(body);
  assert.deepEqual(eye.map((v) => Math.round(v * 1000) / 1000), [0, Math.round((4.9 - HEADROOM_FT) * 1000) / 1000, EYE_FORWARD_FT]);
});

test("the seat: a roof whose corners all lie outside the cab stretch still counts", () => {
  // One big triangle over the whole body, as a van's roof may be.
  const body = [{ positions: new Float32Array(tri([-20, 5.2, -20], [20, 5.2, -20], [0, 5.2, 30])) }];
  assert.ok(Math.abs(cabRoofHeight(body) - 5.2) < 1e-6);
  // Nothing over the stretch: no roof to read, and the seat falls back to a stock height.
  const tail = [{ positions: new Float32Array(slab(6, -3, 3, CAB_Z[0] - 6, CAB_Z[0] - 1)) }];
  assert.equal(cabRoofHeight(tail), null);
  assert.equal(cabRoofHeight([]), null);
  assert.deepEqual(seatFromBody([]), [0, 4.9 - HEADROOM_FT, EYE_FORWARD_FT]);
});

test("the seat: the player's offset stays within its limits", () => {
  assert.deepEqual(cleanSeatOffset(undefined), [0, 0, 0]);
  assert.deepEqual(cleanSeatOffset([99, -99, "x"]), [SEAT_LIMIT_FT[0], -SEAT_LIMIT_FT[1], 0]);
  let offset = [0, 0, 0];
  for (let i = 0; i < 100; i++) offset = moveSeat(offset, [0, 0.25, 0]);
  assert.deepEqual(offset, [0, SEAT_LIMIT_FT[1], 0]);
  assert.deepEqual(moveSeat([0.25, 0, 0], [-0.25, 0, 0.5]), [0, 0, 0.5]);
  assert.deepEqual(seatEye([0, 3.9, 1], [0.5, -0.25, 1]), [0.5, 3.65, 2]);
});

test("VR preferences: defaults, repair of stored values, and a seat offset per truck", () => {
  assert.deepEqual(vrSettings(undefined), { ...DEFAULT_VR, seats: {} });
  const repaired = vrSettings({ view: "moon", horizonLock: "yes", renderScale: 9, foveation: -1, steering: "wheel", viewDistance: "to the moon", seats: { "bigfoot.trk": [0, 50, 0], "x.trk": [0, 0, 0] } });
  assert.equal(repaired.view, "cab");
  assert.equal(repaired.viewDistance, "full");
  assert.equal(vrSettings({ viewDistance: "short" }).viewDistance, "short");
  assert.equal(repaired.horizonLock, true);
  assert.equal(repaired.renderScale, 1.5);
  assert.equal(repaired.foveation, 0);
  assert.equal(repaired.steering, "wheel");
  assert.deepEqual(repaired.seats, { "BIGFOOT.TRK": [0, SEAT_LIMIT_FT[1], 0] });
  assert.deepEqual(seatOffsetFor(repaired, "Bigfoot.trk"), [0, SEAT_LIMIT_FT[1], 0]);
  assert.deepEqual(seatOffsetFor(repaired, "other.trk"), [0, 0, 0]);
  const moved = withSeatOffset(repaired, "other.trk", [0.5, 0, 0]);
  assert.deepEqual(moved.seats["OTHER.TRK"], [0.5, 0, 0]);
  assert.equal("OTHER.TRK" in withSeatOffset(moved, "OTHER.TRK", [0, 0, 0]).seats, false);
});

test("VR views: the cab first, then the two chase views, cycling", () => {
  assert.deepEqual(VR_VIEWS.map((v) => v.id), ["cab", "chaseNear", "chaseFar"]);
  assert.equal(nextVrView("cab"), "chaseNear");
  assert.equal(nextVrView("chaseFar"), "cab");
  assert.equal(nextVrView("nonsense"), "cab");
  assert.equal(vrView("chaseFar").back, 50);
  assert.equal(vrView("nonsense").id, "cab");
});

test("the seat in every stock truck is inside the cab, under the roof and above the hood", { skip: skipWithoutStock() }, async () => {
  const { buildTruckRender } = await import("../src/worker/truck-build.js");
  const { buildCatalog } = await import("../src/worker/catalog.js");
  const { createPaletteResolver } = await import("../src/worker/palette-resolver.js");
  const vfs = stockVfs();
  const catalog = await buildCatalog(vfs);
  const palettes = createPaletteResolver(vfs, "MTM2", null);
  assert.ok(catalog.trucks.length >= 10);
  for (const truck of catalog.trucks) {
    const build = await buildTruckRender(vfs, truck.file, palettes);
    const roof = cabRoofHeight(build.parts.body.meshes);
    assert.ok(roof > 4.2 && roof < 5.8, `${truck.file}: cab roof at ${roof}`);
    const eye = seatFromBody(build.parts.body.meshes);
    assert.ok(eye[1] > 3.2 && eye[1] < 4.8, `${truck.file}: eyes at ${eye[1]}`);
    // The whole body is taller than the cab roof on trucks with a light bar or a wing.
    assert.ok(roof <= build.parts.body.bounds.max[1] + 1e-6);
  }
});

test("the headset's view distance draws the fog in, in proportion, and never out", () => {
  assert.deepEqual(VIEW_DISTANCES.map((v) => [v.id, v.feet]), [["full", Infinity], ["medium", 4000], ["short", 2500]]);
  // Clear weather: the fog from 2500 to 7000 ft.
  assert.deepEqual(viewRange("full", 2500, 7000), { near: 2500, far: 7000 });
  assert.deepEqual(viewRange("medium", 2500, 7000), { near: 2500 * 4000 / 7000, far: 4000 });
  const short = viewRange("short", 2500, 7000);
  assert.equal(short.far, 2500);
  assert.ok(Math.abs(short.near / short.far - 2500 / 7000) < 1e-12, "the fog keeps its proportions");
  // Weather that already sees less far is left as it is: rain's 300 to 1024 ft, dense fog's 0 to 128.
  assert.deepEqual(viewRange("short", 300, 1024), { near: 300, far: 1024 });
  assert.deepEqual(viewRange("medium", 0, 128), { near: 0, far: 128 });
  // An unknown choice is the full view.
  assert.deepEqual(viewRange("nonsense", 2500, 7000), { near: 2500, far: 7000 });
});
