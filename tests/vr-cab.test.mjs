import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ART_FOCAL_PX, CAB_SCALE, COWL_AHEAD_FT, DIAL_FACE_RADIUS_480, DIAL_Z, GEAR_LETTERS, GEAR_READOUT_RECT_480, MIRROR_Z,
  PANEL_NAMES, PANEL_SIZE_PX, SHIFTER_AT, SHIFT_LIGHT_RPM, SPEEDOMETER_MAX_MPH, STOCK_GAUGES, STOCK_MIRROR_RECT_480,
  STOCK_SHIFT_LIGHT_RECT_480, STOCK_SHIFTER_RECT_480, STOCK_WHEEL_RECT_480, TACHOMETER_MAX_RPM, WHEEL_TURN_RAD, WHEEL_Z,
  cabFit, dialPlace, mirrorPlace, needleDegrees, panelFacing, panelPixel, panelPlane, panelPoint, panelRay, panelRect,
  shifterPlace, shiftLightPlace, wheelPlace, wheelTurn,
} from "../src/game/vr/cab.js";
import {
  ART_FITTINGS, ART_WALLS, AUX_GAUGES, AUX_Z, BAY_X, BAY_Z, COWL_Y, DASH_Z, DIAGONAL_BOTTLE, DOME_LIGHT, FIREWALL_Z, FLOOR_FT,
  HEADER_Y, HEADER_Z, HEADLINER_Y, PILLAR_CLAMPS, PUSH_BUTTONS, RAIL_Y, REAR_BOTTLE, REAR_FRAME_Z, REAR_TOP_Y, REAR_Z,
  SEAT_BACK_TILT_RAD, SEAT_BACK_TOP_FT, SEAT_CUSHION_TOP_FT, SEAT_CUSHION_Z, SHIFT_LAMP, SIDE_X, SILL_Y, SWITCH_BUTTONS,
  TUBE_DIAMETER, WALL_X, cageTubes, pillarLine, postBrackets, rearFrameBars, rearFrameBolts, rearGussets,
} from "../src/game/vr/cab-cage.js";
import { HEADROOM_FT } from "../src/game/vr/seat.js";
import { seatFromBody } from "../src/game/vr/seat.js";
import { cockpitArt, loadCockpit } from "../src/worker/cockpit-art.js";
import { buildCatalog } from "../src/worker/catalog.js";
import { createPaletteResolver } from "../src/worker/palette-resolver.js";
import { buildTruckRender } from "../src/worker/truck-build.js";
import { skipWithoutStock, stockVfs } from "./helpers/stock.mjs";

/** A level rectangle at height `y` over [x0, x1] by [z0, z1] (body frame), as scene-frame triangles. */
const slab = (y, x0, x1, z0, z1) => [
  [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z0], [x1, y, z1], [x0, y, z1],
].flatMap(([x, yy, z]) => [x, yy, -z]);
/** How far a needle angle is from a direction on the dial, degrees. */
const off = (degrees, direction) => Math.abs(((degrees - direction + 540) % 360) - 180);

test("the needles: degrees clockwise from twelve o'clock, as the dial faces print them (exe analysis 11)", () => {
  const { speedometer, tachometer } = STOCK_GAUGES;
  // The layout's own numbers.
  assert.deepEqual([speedometer.center, speedometer.radius, speedometer.zeroAngle, speedometer.degreesPerUnit], [[153, 319], 32, 304.5, 2.65]);
  assert.deepEqual([tachometer.center, tachometer.radius, tachometer.zeroAngle, tachometer.degreesPerUnit], [[435, 307], 24, 153.0, 0.0261]);
  // The speedometer's face has 20 mph at the top and 90 at the bottom.
  assert.ok(off(needleDegrees(speedometer, 20, SPEEDOMETER_MAX_MPH), 0) < 3);
  assert.ok(off(needleDegrees(speedometer, 90, SPEEDOMETER_MAX_MPH), 180) < 3.5);
  // The tachometer's has 1000 rpm at the bottom and 8000 at the top.
  assert.ok(off(needleDegrees(tachometer, 1000, TACHOMETER_MAX_RPM), 180) < 1);
  assert.ok(off(needleDegrees(tachometer, 8000, TACHOMETER_MAX_RPM), 0) < 2);
  // At rest the needle is on the zero angle.
  assert.equal(needleDegrees(speedometer, 0, SPEEDOMETER_MAX_MPH), 304.5);
  assert.equal(needleDegrees(tachometer, 0, TACHOMETER_MAX_RPM), 153);
});

test("the needles stop at the faces' last marks, and a reading that is no number reads zero", () => {
  const { speedometer, tachometer } = STOCK_GAUGES;
  assert.equal(needleDegrees(speedometer, 500, SPEEDOMETER_MAX_MPH), needleDegrees(speedometer, SPEEDOMETER_MAX_MPH, SPEEDOMETER_MAX_MPH));
  assert.equal(needleDegrees(speedometer, -30, SPEEDOMETER_MAX_MPH), speedometer.zeroAngle);
  assert.equal(needleDegrees(tachometer, 99999, TACHOMETER_MAX_RPM), tachometer.zeroAngle + tachometer.degreesPerUnit * TACHOMETER_MAX_RPM);
  assert.equal(needleDegrees(tachometer, NaN, TACHOMETER_MAX_RPM), tachometer.zeroAngle);
  assert.equal(needleDegrees(tachometer, undefined, TACHOMETER_MAX_RPM), tachometer.zeroAngle);
  // Neither needle goes all the way around.
  assert.ok(speedometer.degreesPerUnit * SPEEDOMETER_MAX_MPH < 360);
  assert.ok(tachometer.degreesPerUnit * TACHOMETER_MAX_RPM < 360);
  // The dial's bezel is wider than its needle is long.
  assert.ok(DIAL_FACE_RADIUS_480.speedometer > speedometer.radius && DIAL_FACE_RADIUS_480.tachometer > tachometer.radius);
});

test("the steering wheel turns with the road wheels, to its own lock and no further", () => {
  const lock = 0.4;
  assert.equal(wheelTurn(0, lock), 0);
  assert.ok(Math.abs(wheelTurn(lock, lock) - WHEEL_TURN_RAD) < 1e-12);
  assert.ok(Math.abs(wheelTurn(-lock / 2, lock) + WHEEL_TURN_RAD / 2) < 1e-12);
  assert.equal(wheelTurn(5, lock), WHEEL_TURN_RAD);
  assert.equal(wheelTurn(-5, lock), -WHEEL_TURN_RAD);
});

test("the gear plate reads P R N 1 2 3, by the simulation's gear numbers 1 to 6", () => {
  assert.deepEqual([...GEAR_LETTERS], ["P", "R", "N", "1", "2", "3"]);
});

test("the cab's fit: the cowl deck ends on the hood, five feet ahead of the eyes, inside the body's width", () => {
  const eye = [0, 3.9, 1];
  // A hood 0.9 ft under the eyes where the cowl is, and a body 7 ft wide.
  const hood = [{ positions: new Float32Array(slab(3.0, -3.5, 3.5, eye[2] + COWL_AHEAD_FT - 1, eye[2] + COWL_AHEAD_FT + 2)) }];
  const bounds = { min: [-3.5, 0, -8], max: [3.5, 5, 8] };
  const fit = cabFit(hood, bounds, eye);
  assert.ok(Math.abs(fit.cowl - (3.0 - 3.9)) < 1e-6);
  assert.ok(Math.abs(fit.halfWidth - 3.2) < 1e-9);
  // A hood as high as the eyes, or far below them: the dash stays where the driver can see over it and the dials.
  const high = [{ positions: new Float32Array(slab(4.2, -3, 3, 5, 8)) }], low = [{ positions: new Float32Array(slab(0.5, -3, 3, 5, 8)) }];
  assert.equal(cabFit(high, bounds, eye).cowl, -0.4);
  assert.equal(cabFit(low, bounds, eye).cowl, -1.6);
  // Nothing there (a body that ends before the cowl), no body at all, an odd width.
  assert.equal(cabFit([], bounds, eye).cowl, -0.75);
  assert.deepEqual(cabFit(undefined, undefined, eye), { halfWidth: 3.2, cowl: -0.75 });
  assert.equal(cabFit([], { min: [-1, 0, 0], max: [1, 0, 0] }, eye).halfWidth, 2.6);
  assert.equal(cabFit([], { min: [-9, 0, 0], max: [4, 0, 0] }, eye).halfWidth, 3.6);
});

test("stock trucks: every cab fits its body", { skip: skipWithoutStock() }, async () => {
  const vfs = stockVfs();
  const catalog = await buildCatalog(vfs);
  const palettes = createPaletteResolver(vfs, "MTM2", null);
  assert.ok(catalog.trucks.length >= 20);
  for (const truck of catalog.trucks) {
    const { body } = (await buildTruckRender(vfs, truck.file, palettes)).parts;
    const eye = seatFromBody(body.meshes);
    const fit = cabFit(body.meshes, body.bounds, eye);
    assert.ok(fit.cowl <= -0.4 && fit.cowl >= -1.6, `${truck.file}: the dash's far edge is ${fit.cowl} ft against the eyes`);
    assert.ok(fit.halfWidth >= 2.6 && fit.halfWidth <= 3.6, `${truck.file}: half width ${fit.halfWidth}`);
    // The deck is no wider than the body it ends in, and the cage stands well inside both.
    const half = Math.max(Math.abs(body.bounds.min[0]), Math.abs(body.bounds.max[0]));
    assert.ok(fit.halfWidth <= half, truck.file);
    assert.ok(BAY_X * CAB_SCALE < half, `${truck.file}: the dash bay is ${BAY_X * CAB_SCALE} ft either way in a body ${half}`);
  }
});

test("stock cockpit: the dashboard panel and the layout's two gauges", { skip: skipWithoutStock() }, async () => {
  const art = await cockpitArt(stockVfs());
  assert.equal(art.height, 480);
  assert.deepEqual([art.panel.width, art.panel.height, art.panel.rgba.length], [640, 480, 640 * 480 * 4]);
  for (const which of ["speedometer", "tachometer"]) {
    const gauge = art[which], stock = STOCK_GAUGES[which];
    assert.deepEqual([[...gauge.center], gauge.radius, gauge.zeroAngle, gauge.degreesPerUnit], [[...stock.center], stock.radius, stock.zeroAngle, stock.degreesPerUnit]);
    // The dial's face is on the panel around the gauge's centre: not the blank black of the window.
    const r = DIAL_FACE_RADIUS_480[which] - 8;
    let lit = 0, all = 0;
    for (let y = gauge.center[1] - r; y <= gauge.center[1] + r; y += 4) {
      for (let x = gauge.center[0] - r; x <= gauge.center[0] + r; x += 4) {
        if (Math.hypot(x - gauge.center[0], y - gauge.center[1]) > r) continue;
        const i = (y * 640 + x) * 4;
        all++;
        if (art.panel.rgba[i] + art.panel.rgba[i + 1] + art.panel.rgba[i + 2] > 24) lit++;
      }
    }
    assert.ok(lit / all > 0.5, `${which}: ${lit} of ${all} sampled points on the dial are drawn`);
  }
});

test("no cockpit in the install: no art, and the cab draws plain dials", async () => {
  assert.equal(await cockpitArt({ read: async () => null }), null);
});

const near = (a, b, within = 1e-9) => Math.abs(a - b) <= within;
const along = (from, to, t) => from.map((c, i) => c + (to[i] - c) * t);
const degrees = (radians) => radians * 180 / Math.PI;

test("the pictures' camera: four views a quarter turn apart, 90 degrees tall and 106 wide", () => {
  assert.equal(ART_FOCAL_PX, 240);
  assert.deepEqual([...PANEL_SIZE_PX], [640, 480]);
  assert.deepEqual([...PANEL_NAMES], ["front", "right", "back", "left"]);
  // From top to bottom a right angle; from side to side more, so neighbours overlap.
  assert.ok(near(degrees(2 * Math.atan(PANEL_SIZE_PX[1] / 2 / ART_FOCAL_PX)), 90, 1e-9));
  assert.ok(near(degrees(2 * Math.atan(PANEL_SIZE_PX[0] / 2 / ART_FOCAL_PX)), 106.26, 0.01));
  // Each panel's middle looks along its own way: ahead, right, back, left (x right, y up, z ahead).
  const unit = (v) => v.map((c) => c / Math.hypot(...v) || 0);
  assert.deepEqual(unit(panelRay("front", 320, 240)), [0, 0, 1]);
  assert.deepEqual(unit(panelRay("right", 320, 240)), [1, 0, 0]);
  assert.deepEqual(unit(panelRay("back", 320, 240)), [0, 0, -1]);
  assert.deepEqual(unit(panelRay("left", 320, 240)), [-1, 0, 0]);
  // A pixel right of the middle looks to that view's right, one above it looks up.
  assert.ok(panelRay("front", 400, 240)[0] > 0 && panelRay("right", 400, 240)[2] < 0);
  assert.ok(panelRay("back", 400, 240)[0] < 0 && panelRay("left", 400, 240)[2] > 0);
  for (const panel of PANEL_NAMES) assert.ok(panelRay(panel, 320, 100)[1] > 0, panel);
});

test("a pixel and the point it shows go both ways, on any plane or at any range", () => {
  for (const panel of PANEL_NAMES) {
    for (const [x, y] of [[17, 33], [320, 240], [611, 402]]) {
      const [deep] = Object.keys(panelPlane(panel, 1));
      for (const plane of [panelPlane(panel, 0.93), { range: 2.5 }, { y: y < 240 ? 0.6 : -0.6 }]) {
        if ("y" in plane && y === 240) continue;
        const point = panelPoint(panel, x, y, plane), back = panelPixel(panel, point);
        assert.ok(near(back[0], x, 1e-9) && near(back[1], y, 1e-9), `${panel} ${x},${y} ${JSON.stringify(plane)}`);
        if ("range" in plane) assert.ok(near(Math.hypot(...point), 2.5, 1e-9));
      }
      assert.ok(deep === "x" || deep === "z");
    }
    // What is behind a view does not show on it.
    assert.equal(panelPixel(panel, panelRay(panel, 320, 240).map((c) => -c)), null);
  }
  // A rectangle stands square to its panel's view: its corners in the picture's order, its size by the depth.
  const rect = panelRect("left", [100, 300, 48, 24], 0.93);
  assert.ok(rect.corners.every((corner) => near(corner[0], -0.93)));
  assert.ok(near(rect.w, 48 * 0.93 / 240) && near(rect.h, 24 * 0.93 / 240));
  assert.deepEqual(panelPixel("left", rect.corners[0]).map(Math.round), [100, 300]);
  assert.deepEqual(panelPixel("left", rect.corners[2]).map(Math.round), [148, 324]);
  assert.deepEqual(panelPixel("left", rect.center).map(Math.round), [124, 312]);
});

test("each picture is believed over the quarter turn it faces, which is its columns 80 to 560", () => {
  assert.equal(panelFacing([0.2, 0.5, 1]), "front");
  assert.equal(panelFacing([1, -0.3, 0.9]), "right");
  assert.equal(panelFacing([-0.1, 0, -1]), "back");
  assert.equal(panelFacing([-1, 0.9, -0.99]), "left");
  // The corner between ahead and right, 45 degrees off each: column 560 of one, 80 of the other.
  const corner = [1, 0, 1];
  assert.ok(near(panelPixel("front", corner)[0], 560) && near(panelPixel("right", corner)[0], 80));
  assert.ok(near(panelPixel("back", [1, 0, -1])[0], 80) && near(panelPixel("left", [-1, 0, -1])[0], 80));
});

test("the camera's reading: what two pictures both show agrees through it", () => {
  // The gauge bank's upper three, on the front panel and on the right one (measured centres).
  const bank = [[[526, 345], [42, 372]], [[581, 347], [89, 365]], [[635, 350], [129, 360]]];
  for (const [front, right] of bank) {
    const seen = panelPixel("right", panelPoint("front", front[0], front[1], { z: AUX_Z }));
    assert.ok(Math.hypot(seen[0] - right[0], seen[1] - right[1]) < 40, `gauge at ${front} shows at ${seen.map(Math.round)}, the picture has ${right}`);
    // A focal length of 320 (a right angle from side to side) would put it far off: left of the picture's edge.
    const narrow = 320 - 320 * 320 / (front[0] - 320);
    assert.ok(right[0] - narrow > 100, `gauge at ${front} with a 320 pixel focal length: column ${narrow}`);
  }
  // The left pillar's strap clamps, on the front panel and on the left one.
  for (const [front, left] of [[[75, 113], [543, 118]], [[103, 243], [603, 250]]]) {
    const seen = panelPixel("left", panelPoint("front", front[0], front[1], { z: 1 }));
    assert.ok(Math.hypot(seen[0] - left[0], seen[1] - left[1]) < 25, `clamp at ${front} shows at ${seen.map(Math.round)}, the picture has ${left}`);
  }
});

test("the layout's pieces through the camera: the dials, the wheel, the shift light, the mirror (exe analysis 11)", () => {
  assert.deepEqual([...STOCK_WHEEL_RECT_480], [145, 330, 350, 150]);
  assert.deepEqual([...STOCK_SHIFTER_RECT_480], [496, 272, 128, 192]);
  assert.deepEqual([...STOCK_SHIFT_LIGHT_RECT_480], [378, 261, 18, 19]);
  assert.deepEqual([...STOCK_MIRROR_RECT_480], [532, 115, 108, 56]);
  assert.equal(SHIFT_LIGHT_RPM, 7500);
  // Each dial stands where the layout has its centre, its bezel as wide as the art's and its needle as long as the layout's.
  for (const which of ["speedometer", "tachometer"]) {
    const place = dialPlace(which), gauge = STOCK_GAUGES[which];
    assert.deepEqual(panelPixel("front", place.center).map(Math.round), [...gauge.center]);
    assert.equal(place.center[2], DIAL_Z);
    assert.ok(near(place.radius * ART_FOCAL_PX / DIAL_Z, DIAL_FACE_RADIUS_480[which], 1e-9));
    assert.ok(near(place.needle * ART_FOCAL_PX / DIAL_Z, gauge.radius, 1e-9));
  }
  // The 400-line layout's numbers land on the same dial.
  const small = { center: [153 * 400 / 480, 319 * 400 / 480], radius: 32 * 400 / 480 };
  assert.ok(dialPlace("speedometer", small, 400).center.every((c, i) => near(c, dialPlace("speedometer").center[i], 1e-9)));
  // The art's own scale: the tachometer's bezel a little over a 5 inch dial's, the wheel a 14 inch one.
  assert.ok(near(dialPlace("tachometer").radius * 2 * 12, 5.3, 0.1));
  const wheel = wheelPlace();
  assert.ok(near(wheel.radius * 2 * 12, 14, 0.1));
  assert.equal(wheel.center[2], WHEEL_Z);
  // The rim runs through the rectangle's top middle and its two bottom corners.
  const rimPx = wheel.radius * ART_FOCAL_PX / WHEEL_Z, [cx, cy] = panelPixel("front", wheel.center);
  assert.ok(near(cx, 320) && near(cy - rimPx, 330, 1e-9));
  assert.ok(near(Math.hypot(145 - cx, 480 - cy), rimPx, 1e-9) && near(Math.hypot(495 - cx, 480 - cy), rimPx, 1e-9));
  // The hub is under the picture: only the top of the wheel shows, as in the game's frames.
  assert.ok(cy > 480);
  // The shift light and the mirror are their rectangles, square to the view ahead.
  const lamp = shiftLightPlace(), mirror = mirrorPlace();
  assert.deepEqual(panelPixel("front", lamp.center).map(Math.round), [387, 271]);
  assert.deepEqual(panelPixel("front", mirror.center).map(Math.round), [586, 143]);
  assert.equal(mirror.center[2], MIRROR_Z);
  assert.ok(near(mirror.w / mirror.h, 108 / 56, 1e-9) && near(lamp.w / lamp.h, 18 / 19, 1e-9));
  // The gear readout is where the game prints it: inside 292,418 to 346,427, a little larger.
  const [gx, gy, gw, gh] = GEAR_READOUT_RECT_480;
  assert.ok(gx === 292 && gx + gw === 346 && gy <= 418 && gy + gh >= 427);
});

test("the shifter plate stands by the driver's right hand, under every picture, clear of the gauge bank", () => {
  const plate = shifterPlace();
  assert.deepEqual(plate.center, [...SHIFTER_AT]);
  // Its shape is the layout's rectangle's.
  assert.ok(near(plate.w / plate.h, 128 / 192, 1e-9));
  const [x, y, z] = plate.center;
  assert.ok(x > 0 && y < 0, "right of the driver and below the eyes");
  // More than 45 degrees down: below the pictures' lower edge, where they show nothing.
  assert.ok(degrees(Math.atan2(-y, Math.hypot(x, z))) > 45);
  // The layout would put it over the bank: every one of the bank's gauges lies in its rectangle or beside it.
  const [rx, ry, rw, rh] = STOCK_SHIFTER_RECT_480;
  assert.ok(AUX_GAUGES.filter(([gx, gy]) => gx > rx && gx < rx + rw && gy > ry && gy < ry + rh).length >= 4);
  // Where it stands, none of them is behind it: they are all higher.
  for (const [gx, gy] of AUX_GAUGES) {
    const gauge = panelPoint("front", gx, gy, { z: AUX_Z });
    assert.ok(degrees(Math.atan2(-gauge[1], Math.hypot(gauge[0], gauge[2]))) < 40);
  }
});

test("the cab's scale: between the instruments' and the tubes', the dials about half a metre off", () => {
  assert.equal(CAB_SCALE, 1.25);
  const tacho = dialPlace("tachometer").center;
  const metres = Math.hypot(...tacho) * CAB_SCALE * 0.3048;
  assert.ok(metres > 0.45 && metres < 0.55, `the tachometer is ${metres} m from the eyes`);
  // The main tubes come out between an inch and an inch and a half, the padding under three and a half.
  assert.ok(TUBE_DIAMETER.paint * CAB_SCALE * 12 > 1.2 && TUBE_DIAMETER.paint * CAB_SCALE * 12 < 1.6);
  assert.ok(TUBE_DIAMETER.pad * CAB_SCALE * 12 < 3.5);
  assert.ok(TUBE_DIAMETER.chrome < TUBE_DIAMETER.paint && TUBE_DIAMETER.paint < TUBE_DIAMETER.pad);
});

test("the cage: the same both sides, every tube of some length, and all of it under the body's roof", () => {
  const tubes = cageTubes();
  assert.ok(tubes.length > 50);
  for (const t of tubes) {
    assert.ok([...t.from, ...t.to, t.diameter].every(Number.isFinite), JSON.stringify(t));
    assert.ok(Math.hypot(...t.from.map((c, i) => c - t.to[i])) > 0.02 && t.diameter > 0);
    assert.ok(["pad", "paint", "chrome", "cableRed", "cableWhite", "cableDark"].includes(t.kind), t.kind);
  }
  // Every structural tube has its mirror image (the cables are one side's own).
  const structure = tubes.filter((t) => !t.kind.startsWith("cable"));
  const same = (a, b) => a.every((c, i) => near(c, b[i], 1e-9));
  for (const t of structure) {
    const mirrored = { from: [-t.from[0], t.from[1], t.from[2]], to: [-t.to[0], t.to[1], t.to[2]] };
    assert.ok(structure.some((o) => o.kind === t.kind && ((same(o.from, mirrored.from) && same(o.to, mirrored.to)) || (same(o.from, mirrored.to) && same(o.to, mirrored.from)))),
      `${t.kind} ${t.from} to ${t.to} has no mirror`);
  }
  // The eyes are a foot under the body's roof (seat.js): the highest padding stays under it at the cab's scale.
  const top = Math.max(...tubes.map((t) => Math.max(t.from[1], t.to[1]) + t.diameter / 2));
  assert.ok(top * CAB_SCALE < HEADROOM_FT, `the cage's top is ${top * CAB_SCALE} ft over the eyes`);
  assert.ok(HEADLINER_Y > top && HEADLINER_Y * CAB_SCALE < HEADROOM_FT);
  // The planes: sides either side, the hoop behind, the dash beyond the dials, the header nearer than the dash.
  assert.ok(SIDE_X > 0 && REAR_Z < 0 && DASH_Z > DIAL_Z && HEADER_Z < DASH_Z && HEADER_Y > RAIL_Y && REAR_TOP_Y > RAIL_Y);
});

test("the cage's members show where the pictures have them", () => {
  const tubes = cageTubes();
  const find = (kind, test) => tubes.find((t) => t.kind === kind && test(t));
  // The header: front panel row 71, from column 117 to 528.
  const header = find("pad", (t) => near(t.from[0], -t.to[0]) && t.from[2] === HEADER_Z);
  assert.ok(near(panelPixel("front", header.from)[1], 71, 2) && near(panelPixel("front", header.from)[0], 117, 4) && near(panelPixel("front", header.to)[0], 528, 4));
  // The padded bar's depth on the picture: 67 pixels for a bar overhead at that slant.
  const slant = Math.hypot(HEADER_Y, HEADER_Z);
  assert.ok(near(ART_FOCAL_PX * TUBE_DIAMETER.pad * slant / HEADER_Z ** 2, 67, 6));
  // The left pillar: on the front panel through (72, 110) and (100, 250), on the left one through (563, 130) and (614, 250).
  // The two pictures disagree about its foot by some thirty pixels; it stands between them.
  const pillar = pillarLine(-1), right = pillarLine(1);
  const at = (panel, row) => {
    for (let t = 0; t <= 1; t += 0.001) {
      const px = panelPixel(panel, along(pillar.top, pillar.foot, t));
      if (px && px[1] >= row) return px[0];
    }
    return NaN;
  };
  assert.ok(near(at("front", 110), 72, 8) && near(at("front", 250), 100, 16));
  assert.ok(near(at("left", 130), 563, 12) && near(at("left", 250), 614, 20));
  assert.deepEqual(right.top, [-pillar.top[0], pillar.top[1], pillar.top[2]]);
  // It leaves the padding at the front panel's row 100: its top is inside the rail's pad.
  assert.ok(pillar.top[1] > RAIL_Y && pillar.top[1] - RAIL_Y < TUBE_DIAMETER.pad);
  assert.ok(PILLAR_CLAMPS.left.length === 3 && PILLAR_CLAMPS.right.length === 2);
  // The padded upright beside the head: the left panel's middle columns, from the roof rail down past the door bar.
  const upright = find("pad", (t) => t.from[0] === -SIDE_X && Math.abs(t.from[2]) < 0.2 && t.to[1] < 0);
  for (const end of [upright.from, upright.to]) assert.ok(panelPixel("left", end)[0] > 315 && panelPixel("left", end)[0] < 360);
  assert.ok(near(ART_FOCAL_PX * TUBE_DIAMETER.pad / SIDE_X, 59, 4));
  // The dash bars: front panel rows 350 and 398, edge to edge.
  const bars = tubes.filter((t) => t.kind === "chrome" && t.from[2] === DASH_Z && t.to[2] === DASH_Z);
  assert.deepEqual(bars.map((t) => Math.round(panelPixel("front", t.from)[1])), [350, 398]);
  for (const bar of bars) assert.deepEqual([panelPixel("front", bar.from)[0], panelPixel("front", bar.to)[0]].map(Math.round), [0, 640]);
  // The dials are carried on them: in front of the bars, their bottoms at the upper one.
  assert.ok(DIAL_Z < DASH_Z);
  // The rear hoop: its posts at 45 degrees on the back panel (columns 78 and 562), its top bar on row 90 and its crossbar on 347.
  const post = find("chrome", (t) => t.from[0] === -SIDE_X && t.from[2] === REAR_Z && t.to[2] === REAR_Z && t.to[0] === -SIDE_X);
  assert.ok(near(panelPixel("back", post.from)[0], 562, 12) && near(panelPixel("back", [SIDE_X, 0, REAR_Z])[0], 78, 12));
  assert.ok(near(panelPixel("left", post.from)[0], 69, 12));
  assert.ok(near(panelPixel("back", [0, REAR_TOP_Y, REAR_Z])[1], 90, 10));
  const crossbar = find("chrome", (t) => t.from[2] === REAR_Z && near(t.from[0], -t.to[0]) && t.from[1] < 0);
  assert.ok(near(panelPixel("back", crossbar.from)[1], 347, 2));
  // The padded V: each leg from beside the top bar's middle to the hoop's lower corner, not crossing the other.
  const legs = tubes.filter((t) => t.kind === "pad" && t.from[2] === REAR_Z && t.to[2] === REAR_Z);
  assert.equal(legs.length, 2);
  for (const leg of legs) assert.ok(Math.sign(leg.from[0]) === Math.sign(leg.to[0]) && Math.abs(leg.to[0]) > Math.abs(leg.from[0]) && leg.to[1] < leg.from[1]);
});

test("the rear window's frame stands just behind the hoop, bolted, with gussets in the hoop's corners", () => {
  assert.ok(REAR_FRAME_Z < REAR_Z && REAR_Z - REAR_FRAME_Z < 0.1);
  const bars = rearFrameBars();
  assert.equal(bars.length, 4);
  for (const bar of bars) assert.ok(bar.length === 4 && bar.every((corner) => near(corner[2], REAR_FRAME_Z)));
  // The uprights at back panel columns 121 and 521, the bars across on rows 118 and 301.
  const columns = bars.slice(0, 2).map((bar) => Math.round((panelPixel("back", bar[0])[0] + panelPixel("back", bar[1])[0]) / 2));
  assert.deepEqual(columns, [121, 521]);
  const bolts = rearFrameBolts();
  assert.equal(bolts.length, 13);
  for (const bolt of bolts) {
    // Every bolt is on a bar.
    const [x, y] = panelPixel("back", bolt);
    assert.ok(bars.some((bar) => {
      const xs = bar.map((c) => panelPixel("back", c)[0]), ys = bar.map((c) => panelPixel("back", c)[1]);
      return x >= Math.min(...xs) && x <= Math.max(...xs) && y >= Math.min(...ys) && y <= Math.max(...ys);
    }), `bolt at ${Math.round(x)}, ${Math.round(y)}`);
  }
  const gussets = rearGussets();
  assert.equal(gussets.length, 4);
  assert.ok(gussets.every((triangle) => triangle.length === 3) && gussets.filter((t) => t[0][0] > 0).length === 2);
  assert.equal(postBrackets().length, 2);
  // The dome light hangs under the roof at the right rear, ahead of the hoop.
  assert.ok(DOME_LIGHT.center[0] > 0 && DOME_LIGHT.center[2] > REAR_Z && DOME_LIGHT.center[1] + DOME_LIGHT.radius < HEADLINER_Y);
  assert.deepEqual(panelPixel("back", DOME_LIGHT.center).map(Math.round), [127, 100]);
});

test("the room: a narrow cab with a wide bay across its front, and the pictures' own walls cut to their quarter turns", () => {
  assert.ok(WALL_X > SIDE_X && BAY_X > WALL_X && FIREWALL_Z > DASH_Z && BAY_Z < HEADER_Z);
  // The bay holds the whole gauge bank and the dash bars' ends.
  for (const [x, y, r] of AUX_GAUGES) assert.ok(panelPoint("front", x + r, y, { z: AUX_Z })[0] < BAY_X);
  assert.ok(panelPoint("front", 640, 350, { z: DASH_Z })[0] < BAY_X);
  // The firewall's top is the front panel's row 322; the sill is under the door bar.
  assert.ok(near(panelPixel("front", [0, COWL_Y, FIREWALL_Z])[1], 322, 1e-9));
  assert.ok(SILL_Y < 0 && SILL_Y > COWL_Y && FLOOR_FT / CAB_SCALE < -FIREWALL_Z);
  for (const { panel, rect, plane } of ART_WALLS) {
    const [x, y, w, h] = rect;
    assert.ok(x >= 80 && x + w <= 560, `${panel} ${rect}: inside the quarter turn`);
    assert.ok(y + h <= 480 && y >= 195);
    // Each hangs square to its view, behind the cage's own plane there.
    const [key, value] = Object.entries(plane)[0];
    assert.deepEqual(Object.keys(panelPlane(panel, 1)), [key]);
    assert.ok(Math.abs(value) >= (key === "x" ? SIDE_X : -REAR_Z));
  }
  // The side walls stop where the bay begins, so the bank is not behind them.
  const sideWall = ART_WALLS.find((wall) => wall.panel === "right" && wall.rect[3] > 100);
  assert.ok(near(panelPoint("right", sideWall.rect[0], 400, sideWall.plane)[2], BAY_Z, 0.01));
});

test("the fittings stand proud of the walls behind them; the bank, the lamp, the buttons and the bottles are where the pictures show them", () => {
  for (const [name, { panel, rect, depth, thick }] of Object.entries(ART_FITTINGS)) {
    const [x, y, w, h] = rect;
    assert.ok(x >= 0 && y >= 0 && x + w <= 640 && y + h <= 480 && thick > 0, name);
    const wall = ART_WALLS.find((candidate) => candidate.panel === panel);
    if (wall) assert.ok(depth < Math.abs(Object.values(wall.plane)[0]), `${name} stands in front of its wall`);
    else assert.ok(depth < FIREWALL_Z, `${name} stands in front of the firewall`);
  }
  // Six gauges in the bank; one cut off by a picture's edge takes a whole one's face.
  assert.equal(AUX_GAUGES.length, 6);
  for (const [x, y, r, face] of AUX_GAUGES) {
    const [fx, fy, fr] = AUX_GAUGES[face];
    assert.ok(fx + fr <= 640 && fy + fr <= 480, "the face shown is all on the picture");
    if (x + r <= 640 && y + r <= 480) assert.deepEqual([fx, fy], [x, y]);
  }
  assert.ok(AUX_Z > DIAL_Z);
  // The shift lamp is the layout's shift light: inside its rectangle.
  const [lx, ly, lw, lh] = STOCK_SHIFT_LIGHT_RECT_480;
  assert.ok(SHIFT_LAMP.center[0] > lx && SHIFT_LAMP.center[0] < lx + lw && SHIFT_LAMP.center[1] > ly && SHIFT_LAMP.center[1] < ly + lh);
  // The switch plates' buttons are on the plates.
  const [px, py, pw, ph] = ART_FITTINGS.switchPlates.rect;
  for (const [bx, by] of SWITCH_BUTTONS) assert.ok(bx > px && bx < px + pw && by > py && by < py + ph);
  // Two push buttons, right of the bank's first column; the bottle's cap shows on the front panel at (542, 277).
  assert.equal(PUSH_BUTTONS.length, 2);
  assert.ok(PUSH_BUTTONS.every((button) => button.center[0] > 1 && button.radius > 0.05));
  const cap = along(DIAGONAL_BOTTLE.center, DIAGONAL_BOTTLE.center.map((c, i) => c + DIAGONAL_BOTTLE.axis[i]), 0.5);
  assert.deepEqual(panelPixel("front", cap).map(Math.round), [542, 277]);
  assert.ok(near(Math.hypot(...DIAGONAL_BOTTLE.axis), DIAGONAL_BOTTLE.length, 1e-9));
  // Its top end is the nearer one.
  assert.ok(Math.hypot(...cap) < Math.hypot(...DIAGONAL_BOTTLE.center));
  // The extinguisher stands in the left rear corner, inside the cage.
  assert.ok(REAR_BOTTLE.center[0] < 0 && REAR_BOTTLE.center[0] > -SIDE_X && REAR_BOTTLE.center[2] < 0 && REAR_BOTTLE.center[2] > REAR_Z);
});

test("the port's own seat sits under the eyes, its back low enough to leave the back picture clear", () => {
  assert.ok(SEAT_CUSHION_TOP_FT < -2 && SEAT_BACK_TOP_FT > SEAT_CUSHION_TOP_FT && FLOOR_FT < SEAT_CUSHION_TOP_FT);
  assert.ok(SEAT_BACK_TILT_RAD > 0 && SEAT_BACK_TILT_RAD < 0.5);
  // The back's top is more than 45 degrees under the eyes, looking back.
  assert.ok(-SEAT_BACK_TOP_FT > SEAT_CUSHION_Z[1] + 0.12);
});

test("stock pictures: the cage and the fittings stand on what the pictures draw", { skip: skipWithoutStock() }, async () => {
  const art = await loadCockpit(stockVfs());
  /** Whether a panel's pixel is drawn (not the see-through black); null off the picture. */
  const drawn = (panel, x, y) => {
    const px = Math.round(x), py = Math.round(y);
    if (px < 0 || py < 0 || px >= 640 || py >= 480) return null;
    return art.panels[panel].rgba[(py * 640 + px) * 4 + 3] > 0;
  };
  // Each tube's middle line, shown on the picture that faces it: on drawn pixels nearly everywhere.
  let all = 0, hit = 0;
  for (const t of cageTubes()) {
    let count = 0, on = 0;
    for (let i = 0; i <= 20; i++) {
      const point = along(t.from, t.to, i / 20), panel = panelFacing(point);
      const is = drawn(panel, ...panelPixel(panel, point));
      if (is === null) continue;
      count++;
      if (is) on++;
    }
    all += count;
    hit += on;
    if (count >= 5) assert.ok(on / count >= 0.6, `${t.kind} ${t.from.map((c) => c.toFixed(2))} to ${t.to.map((c) => c.toFixed(2))}: ${on} of ${count} on the art`);
  }
  assert.ok(all > 1000 && hit / all > 0.95, `${hit} of ${all} points of the cage are on the art`);
  // The walls and fittings are cut from wholly drawn parts of their pictures.
  for (const piece of [...ART_WALLS, ...Object.values(ART_FITTINGS)]) {
    const [x, y, w, h] = piece.rect;
    let count = 0, on = 0;
    for (let py = y; py < y + h; py += 2) for (let px = x; px < x + w; px += 2) { count++; if (drawn(piece.panel, px, py)) on++; }
    assert.ok(on / count > 0.9, `${piece.panel} ${piece.rect}: ${on} of ${count} drawn`);
  }
  // The bank's gauges and the dome light are drawn where they are said to be.
  for (const [x, y, , face] of AUX_GAUGES) if (AUX_GAUGES[face][0] === x) assert.ok(drawn("front", x, Math.min(y, 479)));
  assert.ok(drawn("back", ...panelPixel("back", DOME_LIGHT.center)));
  // The windows are see-through where the cab leaves them open: ahead, and beside the driver's head.
  assert.equal(drawn("front", 320, 200), false);
  assert.equal(drawn("left", 200, 240), false);
  assert.equal(drawn("back", 320, 260), false);
});
