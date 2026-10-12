/*
  The roll cage and its fittings as the game's four cockpit pictures show them (docs/VR.md,
  "Reading the pictures"). Each member is written down the way it was read: a pixel on a
  panel, on the plane the member stands in, through the pictures' camera (game/vr/cab.js). So
  the numbers here are panel pixels and a handful of planes, and the cage can be checked
  against the pictures by projecting it back (tests/vr-cab.test.mjs).

  Everything is in the art frame: feet around the eyes at the instruments' own scale, x right,
  y up, z ahead. render/xr/vr-cab.js builds it CAB_SCALE times larger. Pure, so it runs under
  Node.

  The planes. The cage is a box: its sides stand 0.93 ft either side of the eyes (the padded
  upright beside the driver's head is 59 pixels wide on the side panels and the header's pad
  67 on the front one, the same pad at those distances), the rear hoop 0.96 ft behind them (its
  posts stand at 45 degrees on the back panel and on the side ones), the header 0.95 ft ahead
  and the dash bars 1.15 ft ahead, a little beyond the dials they carry.
*/
import { DIAL_Z, panelPoint } from "./cab.js";

/** The cage's planes, art feet: its sides, the rear hoop, the dash bars and the header. */
export const SIDE_X = 0.93, REAR_Z = -0.96, DASH_Z = 1.15, HEADER_Z = 0.95;
/** The roof rails' height, the header's, and the rear hoop's top bar's. */
export const RAIL_Y = 0.5, HEADER_Y = 0.67, REAR_TOP_Y = 0.57;
/** Tube diameters, art feet, from their widths on the panels: the painted main tubes, the bright secondary ones, and the padding. */
export const TUBE_DIAMETER = Object.freeze({ paint: 0.096, chrome: 0.05, pad: 0.225 });

/** A pixel of the left panel on the cage's left side, of the back panel on the rear hoop, of the front panel at a depth. */
const side = (x, y) => panelPoint("left", x, y, { x: -SIDE_X });
const rear = (x, y, z = REAR_Z) => panelPoint("back", x, y, { z });
const ahead = (x, y, z = DASH_Z) => panelPoint("front", x, y, { z });
const flip = ([x, y, z]) => [-x, y, z];

/*
  Where the A-pillar meets the roof rail and the header's end, inside the padding, and the
  pillar's foot, on the left. The rail climbs to that joint over its last third; the pillar
  comes out from under the pad at front panel row 100.
*/
const PILLAR_TOP = Object.freeze([-SIDE_X, 0.62, 0.838]), PILLAR_FOOT = Object.freeze([-SIDE_X, -0.5, 1.23]);
const RAIL_RISE_Z = 0.5;
/** The painted diagonal across the front of each side window: left panel (435, 185) to (618, 315), where it meets the pillar. */
const DIAGONAL = Object.freeze([side(435, 185), side(618, 315)]);
const HEADER_END = Object.freeze([-0.81, HEADER_Y, HEADER_Z]);
/** How far back the roof rail's padding runs, and where the padded bar crosses behind the head. */
const RAIL_PAD_END_Z = -0.78;
export const HEAD_BAR_Z = -0.43;

/*
  The tubes. `[kind, from, to, diameter]`: kind is `pad` (foam over a tube), `paint` (the black
  main tubes), `chrome` (the bright secondary ones) or a cable. Those listed under `PAIRED`
  stand on the left and are mirrored to the right; the cage is the same both sides.
*/
const PAIRED = [
  // The header's ends drop to the roof rails, which run back to the rear hoop: padded as far
  // as the driver's head can reach, bare behind.
  ["pad", HEADER_END, PILLAR_TOP],
  ["pad", PILLAR_TOP, [-SIDE_X, RAIL_Y, RAIL_RISE_Z]],
  ["pad", [-SIDE_X, RAIL_Y, RAIL_RISE_Z], [-SIDE_X, RAIL_Y, RAIL_PAD_END_Z]],
  ["chrome", [-SIDE_X, RAIL_Y, RAIL_PAD_END_Z], [-SIDE_X, RAIL_Y, REAR_Z], 0.06],
  // The A-pillar: front panel (72, 110) to (100, 250), left panel (563, 130) to (614, 250).
  ["paint", PILLAR_TOP, PILLAR_FOOT],
  // The padded upright beside the head and its bare foot: left panel (325, 130) to (350, 330) to (380, 430).
  ["pad", side(325, 130), side(350, 330)],
  ["chrome", side(350, 330), side(380, 430), 0.07],
  // The door bars under the window: left panel rows 333 and 377.
  ["chrome", side(85, 333), side(510, 333), 0.04],
  ["chrome", side(120, 377), side(520, 377), 0.035],
  // The long diagonal from the rear post's head down to the sill, and the short braces at each end of the window.
  ["chrome", side(66, 162), side(300, 445), 0.055],
  ["chrome", side(72, 258), side(135, 330)],
  ["chrome", side(500, 255), side(440, 330)],
  // The painted diagonal from its mount under the roof rail down to the pillar.
  ["paint", ...DIAGONAL],
  // The mount: two short dark tubes along the rail.
  ["paint", side(410, 147), side(466, 147), 0.06],
  ["paint", side(414, 172), side(466, 172), 0.06],
  // The rear hoop's posts.
  ["chrome", [-SIDE_X, REAR_TOP_Y, REAR_Z], [-SIDE_X, -1.0, REAR_Z]],
  // The padded inverted V behind the seat, each leg from beside the top bar's middle down to the
  // hoop's lower corner: back panel (333, 90) to (552, 347), its ends bare.
  ["chrome", rear(333, 90), rear(354, 114), 0.08],
  ["pad", rear(354, 114), rear(540, 334)],
  ["chrome", rear(540, 334), rear(552, 347), 0.08],
  // Two thin tubes from the rail's rear node in and down toward the seat's head.
  ["chrome", side(125, 118), [-0.5, 0.29, -0.67], 0.035],
  ["chrome", side(160, 133), [-0.52, 0.2, -0.6], 0.03],
  // The roof's rear diagonals, from the hoop's top bar out to the rails.
  ["paint", [-0.53, REAR_TOP_Y, REAR_Z], [-SIDE_X, RAIL_Y + 0.04, -0.5], 0.06],
];
const CENTRE = [
  // The header over the windscreen: front panel row 71, sixty pixels deep.
  ["pad", HEADER_END, flip(HEADER_END)],
  // The padded bar behind the head.
  ["pad", [-SIDE_X, RAIL_Y, HEAD_BAR_Z], [SIDE_X, RAIL_Y, HEAD_BAR_Z]],
  // The dash bars: front panel rows 350 and 398, the full width of the picture.
  ["chrome", ahead(0, 350), ahead(640, 350), 0.055],
  ["chrome", ahead(0, 398), ahead(640, 398), 0.055],
  // The short bar under the dash: front panel row 443.
  ["chrome", ahead(220, 443, 1.2), ahead(420, 443, 1.2), 0.03],
  // The rear hoop's top bar and its lower crossbar: back panel rows 90 and 347.
  ["chrome", [-SIDE_X, REAR_TOP_Y, REAR_Z], [SIDE_X, REAR_TOP_Y, REAR_Z]],
  ["chrome", [-1.3, -0.428, REAR_Z], [1.3, -0.428, REAR_Z]],
];

/** The cables down the pillars: the left one red, the right one white and running on along the roof rail. */
const CABLE_DIAMETER = 0.014, CABLE_INSET = 0.05, CABLE_X = 0.8;
const CABLE_RUN = Object.freeze([[105, 108], [140, 112], [180, 128], [250, 128], [300, 122], [330, 115], [460, 79]]);
const inward = ([x, y, z], dz = -CABLE_INSET) => [x + Math.sign(-x) * CABLE_INSET * 0.6, y, z + dz];
const CABLES = [
  ["cableRed", inward([-SIDE_X, RAIL_Y - 0.1, 0.9]), inward(PILLAR_FOOT), CABLE_DIAMETER],
  ["cableWhite", inward(flip([-SIDE_X, RAIL_Y - 0.1, 0.9])), inward(flip(PILLAR_FOOT)), CABLE_DIAMETER],
  // The right side's two white cables run on under the roof rail's padding and up into the roof
  // behind the head, just clear of the pad: right panel (105, 108) to (460, 79).
  ...[0, 5].flatMap((drop) => CABLE_RUN.slice(1).map(([x, y], i) => [
    "cableWhite", panelPoint("right", CABLE_RUN[i][0], CABLE_RUN[i][1] + drop, { x: CABLE_X }), panelPoint("right", x, y + drop, { x: CABLE_X }), CABLE_DIAMETER,
  ])),
  // And two dark ones run down behind its padded upright: right panel column 340, rows 240 to 420.
  ...[0, 0.03].map((back) => ["cableDark", [SIDE_X - 0.03, 0.02, -0.05 - back], [SIDE_X - 0.03, -0.7, -0.06 - back], CABLE_DIAMETER]),
];

/** The strap clamps around each pillar, as fractions of the way down it: front panel rows 113 and 243 (left), 142 and 252 (right). */
export const PILLAR_CLAMPS = Object.freeze({ left: Object.freeze([0.143, 0.554, 0.607]), right: Object.freeze([0.232, 0.58]) });

const tube = ([kind, from, to, diameter]) => ({ kind, from: [...from], to: [...to], diameter: diameter ?? TUBE_DIAMETER[kind] });

/** Every tube of the cage: `{ kind, from, to, diameter }`, art feet. */
export function cageTubes() {
  return [
    ...PAIRED.flatMap((t) => [tube(t), tube([t[0], flip(t[1]), flip(t[2]), t[3]])]),
    ...CENTRE.map(tube),
    ...CABLES.map(tube),
  ];
}

/** A pillar's line, for what is strapped to it: `{ top, foot }` art feet; `sideSign` is -1 left, 1 right. */
export function pillarLine(sideSign) {
  return sideSign < 0 ? { top: [...PILLAR_TOP], foot: [...PILLAR_FOOT] } : { top: flip(PILLAR_TOP), foot: flip(PILLAR_FOOT) };
}

/*
  The rear window: a frame of bolted flat bar standing just behind the hoop (the posts cross in
  front of it). Back panel: uprights at columns 121 and 521 from row 118 to 301, a top bar on
  rows 112 to 125 and a bottom one on 297 to 305, both the picture's full width; bolts down
  the uprights and along both bars.
*/
export const REAR_FRAME_Z = -1.0;
const frame = (x, y) => rear(x, y, REAR_FRAME_Z);
/** The frame's flat bars as four-cornered plates, art feet, corners in order around each. */
export function rearFrameBars() {
  const bar = (x0, y0, x1, y1) => [frame(x0, y0), frame(x1, y0), frame(x1, y1), frame(x0, y1)];
  return [bar(112, 118, 130, 301), bar(512, 118, 530, 301), bar(-20, 112, 660, 125), bar(-20, 297, 660, 305)];
}
/** The frame's bolt heads, art feet. */
export function rearFrameBolts() {
  return [
    [120, 145], [120, 207], [120, 262], [522, 145], [522, 207], [522, 265],
    [175, 118], [321, 118], [460, 118], [12, 302], [175, 302], [460, 302], [628, 302],
  ].map(([x, y]) => frame(x, y));
}
/** The gusset plates in the hoop's lower corners, as triangles, art feet: back panel around (78, 285) and (562, 285). */
export function rearGussets() {
  const z = REAR_Z - 0.01;
  const left = [
    [rear(40, 300, z), rear(70, 270, z), rear(70, 300, z)],
    [rear(86, 275, z), rear(111, 300, z), rear(86, 300, z)],
  ];
  return [...left, ...left.map((t) => t.map(flip).reverse())];
}

/** The plates that hold the long diagonals' heads at the rear posts: left panel (80, 140) to (120, 200), and its mirror. */
export function postBrackets() {
  const left = [side(82, 140), side(125, 145), side(120, 200), side(98, 190)].map(([x, y, z]) => [x + 0.012, y, z]);
  return [left, left.map(flip).reverse()];
}

/** The dome light under the roof at the right rear: back panel (127, 100), 32 pixels in radius, a little ahead of the hoop. */
export const DOME_LIGHT = Object.freeze({ center: Object.freeze(rear(127, 100, -0.9)), radius: 32 * 0.9 / 240 });

/*
  The room behind the cage. Below the windows the pictures are closed: tread plate and wire
  mesh on the sides, the rear wall under the window, a firewall under the dash. The dash is
  wider than the cage (its bars and the gauge bank run to the front picture's edges), so the
  room is a narrow cab with a wide bay across its front.
*/
export const WALL_X = 0.965, BAY_X = 1.7, BAY_Z = 0.724, FIREWALL_Z = 1.45, HEADLINER_Y = 0.79;
/** The sill the side walls rise to, and the cowl the firewall rises to (front panel row 322). */
export const SILL_Y = -0.394, COWL_Y = -(322 - 240) / 240 * FIREWALL_Z;

/*
  The pictures' own lower walls, hung in the room where they are: `{ panel, rect, plane }`, a
  `[x, y, w, h]` pixel rectangle of a panel on a plane square to its view. Each is cut to the
  quarter turn its panel faces (columns 80 to 560), short of the dash bay on the sides.
*/
export const ART_WALLS = Object.freeze([
  Object.freeze({ panel: "left", rect: Object.freeze([80, 338, 420, 142]), plane: Object.freeze({ x: -WALL_X }) }),
  Object.freeze({ panel: "left", rect: Object.freeze([80, 195, 46, 143]), plane: Object.freeze({ x: -WALL_X }) }),
  Object.freeze({ panel: "right", rect: Object.freeze([140, 338, 420, 142]), plane: Object.freeze({ x: WALL_X }) }),
  Object.freeze({ panel: "right", rect: Object.freeze([514, 195, 46, 143]), plane: Object.freeze({ x: WALL_X }) }),
  Object.freeze({ panel: "back", rect: Object.freeze([80, 305, 480, 175]), plane: Object.freeze({ z: REAR_FRAME_Z }) }),
]);

/*
  Fittings cut from the pictures and stood proud of what is behind them: `{ panel, rect, depth,
  thick }`, a pixel rectangle on a plane square to its panel's view `depth` art feet off, with
  `thick` feet of body behind it.
*/
export const ART_FITTINGS = Object.freeze({
  // The two rocker switch panels: six switches each, on the left and right walls.
  switchesLeft: Object.freeze({ panel: "left", rect: Object.freeze([184, 402, 94, 42]), depth: 0.9, thick: 0.065 }),
  switchesRight: Object.freeze({ panel: "right", rect: Object.freeze([148, 344, 120, 68]), depth: 0.88, thick: 0.085 }),
  // The box behind the seat with its two line gauges.
  rearBox: Object.freeze({ panel: "back", rect: Object.freeze([286, 362, 142, 118]), depth: 0.9, thick: 0.1 }),
  // The electrical box in the right rear corner.
  fuseBox: Object.freeze({ panel: "right", rect: Object.freeze([546, 342, 70, 110]), depth: 0.8, thick: 0.165 }),
  // On the dash: the hinged switch plates with their red buttons, the column plate between the dials, and the lamp bracket by the tachometer.
  switchPlates: Object.freeze({ panel: "front", rect: Object.freeze([44, 340, 61, 52]), depth: DASH_Z - 0.03, thick: 0.02 }),
  columnPlate: Object.freeze({ panel: "front", rect: Object.freeze([283, 362, 90, 32]), depth: DASH_Z - 0.03, thick: 0.012 }),
  lampBracket: Object.freeze({ panel: "front", rect: Object.freeze([486, 286, 28, 58]), depth: DIAL_Z + 0.03, thick: 0.02 }),
  speedoBracket: Object.freeze({ panel: "front", rect: Object.freeze([120, 362, 66, 37]), depth: DIAL_Z + 0.02, thick: 0.05 }),
  tachoBracket: Object.freeze({ panel: "front", rect: Object.freeze([410, 360, 50, 33]), depth: DIAL_Z + 0.02, thick: 0.05 }),
});

/** The switch plates' two red buttons, front panel pixels, and their radius. */
export const SWITCH_BUTTONS = Object.freeze([Object.freeze([61, 373]), Object.freeze([91, 374])]);
export const SWITCH_BUTTON_RADIUS_PX = 5.5;

/*
  The gauge bank at the right of the dash: `[x, y, r, face]`, front panel pixels, `face` the
  index of the gauge whose face stands in for one the picture cuts off at its edge. They stand
  square to the view ahead like the dials.
*/
export const AUX_GAUGES = Object.freeze([
  Object.freeze([526, 345, 21, 0]), Object.freeze([581, 347, 22, 1]), Object.freeze([635, 350, 22, 1]),
  Object.freeze([548, 415, 22, 3]), Object.freeze([608, 427, 24, 4]), Object.freeze([566, 480, 24, 3]),
]);
export const AUX_Z = 1.16;

/** The tachometer's shift lamp, front panel pixels: its centre and radius. */
export const SHIFT_LAMP = Object.freeze({ center: Object.freeze([384, 270]), radius: 8.5 });

/** The two push buttons right of the bottle: the blue fuel one the front panel shows at (608, 285), the red fire one the right panel shows beside it. */
export const PUSH_BUTTONS = Object.freeze([
  Object.freeze({ panel: "front", center: Object.freeze(ahead(608, 285, 1.1)), radius: 15 * 1.1 / 240 }),
  Object.freeze({ panel: "right", center: Object.freeze(panelPoint("right", 150, 285, { z: 1.08 })), radius: 0.066 }),
]);

/*
  The red bottle by the right side's painted diagonal, its top end toward the driver. The front
  panel shows its cap nearly end on at (542, 277), 20 pixels in radius, and its far end at
  (575, 315); it stands along those two rays, nearer than the diagonal. And the extinguisher
  in the left rear corner, which the left and back panels put in different places; it stands
  between the two.
*/
const BOTTLE_TOP = ahead(542, 277, 0.79), BOTTLE_END = ahead(575, 315, 0.94);
export const DIAGONAL_BOTTLE = Object.freeze({
  center: Object.freeze(BOTTLE_TOP.map((c, i) => (c + BOTTLE_END[i]) / 2)),
  axis: Object.freeze(BOTTLE_TOP.map((c, i) => c - BOTTLE_END[i])),
  radius: 20 * 0.79 / 240, length: Math.hypot(...BOTTLE_TOP.map((c, i) => c - BOTTLE_END[i])),
});
export const REAR_BOTTLE = Object.freeze({ center: Object.freeze([-0.78, -0.48, -0.84]), radius: 0.055, length: 0.43 });

/** The port's own bucket seat, which no picture shows (every one of these trucks has one): real feet against the eyes. */
export const SEAT_CUSHION_TOP_FT = -2.55, SEAT_CUSHION_Z = Object.freeze([-0.5, 0.75]);
export const SEAT_BACK_TOP_FT = -1.05, SEAT_BACK_TILT_RAD = 0.21;
/** The floor under the seat, real feet against the eyes. */
export const FLOOR_FT = -3.4;
