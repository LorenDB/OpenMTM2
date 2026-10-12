/*
  The cab around the driver in the headset (docs/VR.md, "The cab"): how its dials read, the
  camera the game's cockpit pictures were drawn through, and where the layout's pieces stand.
  Pure, so it runs under Node; render/xr/vr-cab.js draws it, and game/vr/cab-cage.js holds the
  cage as read off the pictures.

  The game's cockpit is four pictures of a roll cage with two dials on the dash bar
  (MONSTER_EXE_ANALYSIS.md section 11). The headset's cab is that cage built around the seat,
  with the pictures' own dial faces and needles that follow the game's layout.

  Needles. `POWERBIG.<h>` gives each gauge a zero angle and degrees per unit. Read against the
  dial art, angles run clockwise from twelve o'clock: the speedometer's 304.5 + 2.65 per mph puts
  20 mph straight up and 90 mph straight down, and the tachometer's 153 + 0.0261 per rpm puts
  1000 rpm straight down and 8000 straight up, where the faces print them.
*/
import { bodyTop } from "./seat.js";

/** The 640 x 480 cockpit's gauges, for an install whose layout cannot be read. */
export const STOCK_GAUGES = Object.freeze({
  speedometer: Object.freeze({ center: Object.freeze([153, 319]), radius: 32, zeroAngle: 304.5, degreesPerUnit: 2.65 }),
  tachometer: Object.freeze({ center: Object.freeze([435, 307]), radius: 24, zeroAngle: 153.0, degreesPerUnit: 0.0261 }),
});
/** Each dial's bezel radius on the 480-line panel, pixels, measured off the art (the layout's radius is the needle's). */
export const DIAL_FACE_RADIUS_480 = Object.freeze({ speedometer: 55, tachometer: 48 });
/** Where the needles stop: the faces' last marks. */
export const SPEEDOMETER_MAX_MPH = 110, TACHOMETER_MAX_RPM = 9000;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** A needle's angle for a reading, degrees clockwise from twelve o'clock. */
export function needleDegrees(gauge, reading, maximum) {
  return gauge.zeroAngle + gauge.degreesPerUnit * clamp(Number(reading) || 0, 0, maximum);
}

/** The steering wheel's turn at full lock, radians. */
export const WHEEL_TURN_RAD = 110 * Math.PI / 180;

/** The steering wheel's turn for a road-wheel angle, radians, positive to the right. */
export function wheelTurn(steer, steerLock) {
  return clamp(steer / steerLock, -1, 1) * WHEEL_TURN_RAD;
}

/** The cowl, where the deck over the firewall meets the hood: this far ahead of the eyes, feet. */
export const COWL_AHEAD_FT = 5;
/** The cowl's height against the eyes, feet, when the body has nothing there; and the range it is kept in. */
const COWL_FALLBACK_FT = -0.75, COWL_RANGE_FT = Object.freeze([-1.6, -0.4]);
/** The deck's far edge stands this far inside the body's sides, and its half width is kept in this range, feet. */
const SIDE_INSET_FT = 0.3, HALF_WIDTH_RANGE_FT = Object.freeze([2.6, 3.6]);

/**
 * The cab's cowl deck fitted to a body: `{ halfWidth, cowl }` in feet, `cowl` the height of the
 * deck's far edge against the eyes (negative: below them). `meshes` and `bounds` are the body
 * model's (scene-frame triangle soups, game-frame extents); `eye` is the seat the body gives
 * (seat.js). The deck runs from the firewall's top out to where the body's top is, five feet
 * ahead of the eyes, so it ends where the hood begins; it is never allowed above 0.4 ft under
 * the eyes.
 */
export function cabFit(meshes, bounds, eye) {
  const top = bodyTop(meshes, eye[2] + COWL_AHEAD_FT - 0.25, eye[2] + COWL_AHEAD_FT + 0.25);
  const half = bounds ? Math.max(Math.abs(bounds.min[0]), Math.abs(bounds.max[0])) : 3.5;
  return {
    halfWidth: clamp(half - SIDE_INSET_FT, ...HALF_WIDTH_RANGE_FT),
    cowl: clamp(top === null ? COWL_FALLBACK_FT : top - eye[1], ...COWL_RANGE_FT),
  };
}

/** The gear lever's places as the dash shows them, by the simulation's gear number (1 Park to 6 third). */
export const GEAR_LETTERS = Object.freeze(["P", "R", "N", "1", "2", "3"]);

/** The shift light comes on near the top of the rev range, as on the flat screen. */
export const SHIFT_LIGHT_RPM = 7500;

/*
  The camera the pictures were drawn through (docs/VR.md, "Reading the pictures").

  The four panels are one cab seen from one point, the driver's eyes, in four directions a
  quarter turn apart: ahead, right, back and left. Each is 640 x 480 with a focal length of 240
  pixels, which is 90 degrees from top to bottom and 106 from side to side, so neighbours share
  8 degrees at each edge. That reading comes from the things two panels both show: the three
  upper gauges of the bank at the right of the dash, and the strap clamps on the left pillar.

  Points are in the art frame: feet around the eyes, x right, y up, z ahead.
*/
export const ART_FOCAL_PX = 240;
export const PANEL_SIZE_PX = Object.freeze([640, 480]);
/** The panels, clockwise from ahead as seen from above. */
export const PANEL_NAMES = Object.freeze(["front", "right", "back", "left"]);
/** Each panel's view: the axis it looks along and its sign, and the axis across it (rightward) and its sign. */
const PANEL_VIEWS = Object.freeze({
  front: Object.freeze([2, 1, 0, 1]),
  right: Object.freeze([0, 1, 2, -1]),
  back: Object.freeze([2, -1, 0, -1]),
  left: Object.freeze([0, -1, 2, 1]),
});

/** The direction a panel's pixel looks along, art frame (not of unit length: its depth is the focal length). */
export function panelRay(panel, x, y) {
  const [deep, deepSign, across, acrossSign] = PANEL_VIEWS[panel];
  const ray = [0, PANEL_SIZE_PX[1] / 2 - y, 0];
  ray[deep] = deepSign * ART_FOCAL_PX;
  ray[across] = acrossSign * (x - PANEL_SIZE_PX[0] / 2);
  return ray;
}

/**
 * The point a panel's pixel shows, given where along its ray the thing is: `plane` names one
 * coordinate (`{ x }`, `{ y }` or `{ z }`, art feet) or the `range` from the eyes.
 */
export function panelPoint(panel, x, y, plane) {
  const ray = panelRay(panel, x, y);
  const [key, value] = Object.entries(plane)[0];
  const k = key === "range" ? value / Math.hypot(ray[0], ray[1], ray[2]) : value / ray["xyz".indexOf(key)];
  return [ray[0] * k, ray[1] * k, ray[2] * k];
}

/** Where a point shows on a panel, `[x, y]` pixels (it may lie off the picture), or null behind the view. */
export function panelPixel(panel, point) {
  const [deep, deepSign, across, acrossSign] = PANEL_VIEWS[panel];
  const depth = point[deep] * deepSign;
  if (!(depth > 0)) return null;
  return [
    PANEL_SIZE_PX[0] / 2 + ART_FOCAL_PX * point[across] * acrossSign / depth,
    PANEL_SIZE_PX[1] / 2 - ART_FOCAL_PX * point[1] / depth,
  ];
}

/**
 * The panel that faces a direction: the one whose quarter turn it lies in. Where two pictures
 * disagree about what stands in a direction, this one is believed.
 */
export function panelFacing(point) {
  const [x, , z] = point;
  if (Math.abs(z) >= Math.abs(x)) return z >= 0 ? "front" : "back";
  return x >= 0 ? "right" : "left";
}

/** The plane square to a panel's view, `depth` art feet off: the `plane` `panelPoint` takes. */
export function panelPlane(panel, depth) {
  const [deep, deepSign] = PANEL_VIEWS[panel];
  return { ["xyz"[deep]]: deepSign * depth };
}

/**
 * A `[x, y, w, h]` pixel rectangle of a panel as a flat piece standing square to that panel's
 * view, `depth` art feet off: `{ center, w, h, corners }`, `center` art feet, the size in
 * feet, and the corners in the picture's order: top left, top right, bottom right, bottom left.
 */
export function panelRect(panel, rect, depth) {
  const [x, y, w, h] = rect;
  const plane = panelPlane(panel, depth);
  return {
    center: panelPoint(panel, x + w / 2, y + h / 2, plane),
    w: w * depth / ART_FOCAL_PX, h: h * depth / ART_FOCAL_PX,
    corners: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => panelPoint(panel, px, py, plane)),
  };
}

/*
  The cab's scale. The pictures give directions and proportions, not a size. Taking the
  instruments at their real sizes (the tachometer a 5 inch dial) puts the dash 1.1 ft from the
  eyes; taking the cage's main tubes at 1.5 inches would put it at 1.9 ft. The art frame is
  the first of these, and the cab is built this much larger: between the two, and far enough
  off to be easy to look at in a headset. From the driving position it looks the same at any
  scale.
*/
export const CAB_SCALE = 1.25;

/** How far ahead of the eyes the dials' faces, the steering wheel and the mirror stand, art feet. */
export const DIAL_Z = 1.1, WHEEL_Z = 0.79, MIRROR_Z = 0.9;
/*
  The shifter plate. The layout draws it over the gauge bank at the right of the dash, which the
  right-hand picture shows uncovered: on a flat screen the two are never seen together, in a cab
  they are. So the plate stands where a truck's shifter does, low by the driver's right hand,
  turned to the eyes, and as large as the layout's rectangle would be this far off.
*/
export const SHIFTER_AT = Object.freeze([0.72, -0.98, 0.3]), SHIFTER_DEPTH = 0.6;

/** The stock 480-line rectangles, [x, y, w, h] pixels on the front panel: the wheel, the shifter, the shift light and the mirror frame. */
export const STOCK_WHEEL_RECT_480 = Object.freeze([145, 330, 350, 150]);
export const STOCK_SHIFTER_RECT_480 = Object.freeze([496, 272, 128, 192]);
export const STOCK_SHIFT_LIGHT_RECT_480 = Object.freeze([378, 261, 18, 19]);
export const STOCK_MIRROR_RECT_480 = Object.freeze([532, 115, 108, 56]);
/** Where the game's cockpit prints its gear readout, P R N 1 2 3 (hard-coded, exe analysis 11): [x, y, w, h] pixels. */
export const GEAR_READOUT_RECT_480 = Object.freeze([292, 416, 54, 12]);

/**
 * A dial where the layout puts its centre, its face square to the view ahead as the picture
 * has it: `{ center, radius, needle }`, art feet, `radius` the bezel's and `needle` the
 * needle's length (the layout's radius).
 */
export function dialPlace(which, gauge = STOCK_GAUGES[which], lines = 480) {
  const px = 480 / lines;
  return {
    center: panelPoint("front", gauge.center[0] * px, gauge.center[1] * px, { z: DIAL_Z }),
    radius: DIAL_FACE_RADIUS_480[which] * DIAL_Z / ART_FOCAL_PX,
    needle: gauge.radius * px * DIAL_Z / ART_FOCAL_PX,
  };
}

/**
 * The steering wheel from the layout's rectangle. The wheel frames show the top of a rim that
 * runs through the rectangle's top middle and its two bottom corners, so the rim is a circle
 * of radius (w^2 / 4 + h^2) / 2h about a point that far under the top: `{ center, radius }`,
 * art feet, the wheel square to the view ahead.
 */
export function wheelPlace(rect = STOCK_WHEEL_RECT_480) {
  const [x, y, w, h] = rect;
  const r = (w * w / 4 + h * h) / (2 * h);
  return { center: panelPoint("front", x + w / 2, y + r, { z: WHEEL_Z }), radius: r * WHEEL_Z / ART_FOCAL_PX };
}

/** The shifter plate: `{ center, w, h }`, art feet, its size from the layout's rectangle. */
export function shifterPlace(rect = STOCK_SHIFTER_RECT_480) {
  return { center: [...SHIFTER_AT], w: rect[2] * SHIFTER_DEPTH / ART_FOCAL_PX, h: rect[3] * SHIFTER_DEPTH / ART_FOCAL_PX };
}
/** The shift light and the mirror frame from the layout's rectangles: `{ center, w, h }`, art feet. */
export function shiftLightPlace(rect = STOCK_SHIFT_LIGHT_RECT_480) { return panelRect("front", rect, DIAL_Z - 0.03); }
export function mirrorPlace(rect = STOCK_MIRROR_RECT_480) { return panelRect("front", rect, MIRROR_Z); }
