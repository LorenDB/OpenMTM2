/*
  The cab around the driver in the headset (docs/VR.md, "The cab").

  A truck's body model is a shell seen from outside: from the seat its insides are not drawn, and
  the driver would hang in the air above the axles. The game's own cockpit is four pictures of a
  roll cage seen from the driver's eyes; this is that cage built in the round, so the driver
  sits in something, with a frame that stays still against the truck (which is also what keeps
  a moving view comfortable).

  The cab belongs to the truck: it hangs from the drawn truck at the seat the body gives
  (game/vr/seat.js), and so pitches and rolls with it, also when the horizon is locked. Its
  parts are in feet around the eyes, x right, y up, -z ahead.

  How it is made (docs/VR.md, "Reading the pictures"):
  - the cage's tubes and plates are game/vr/cab-cage.js, read off the pictures through the
    camera they were drawn with (game/vr/cab.js), built CAB_SCALE times the art's own size;
  - what the pictures show below the windows (tread plate, wire mesh, switch panels, hoses, the
    box behind the seat) is the pictures themselves, hung on the room's walls where they are
    and cut to the quarter turn each faces; the fittings that stand proud are cut out again in
    front. A texture coordinate is the pixel a point shows at through the pictures' camera, so
    from the driving position every such piece looks as the game drew it;
  - the dials, the gauge bank, the bottles and the wheel are modelled, with the pictures' own
    faces; the needles follow the game's layout.

  Nothing here is lit by the scene: the pictures carry their own light, and the modelled parts
  are shaded to match. The cab dims with the weather (`update`'s `light`), all but its lit
  instruments: the needles, the gear readout and the shift lamp. Without the
  install's cockpit the cage stands bare, with plain dials and a text gear plate.
*/
import * as THREE from "three";
import { mtm2Sim } from "../../vendor/openphotex/index.js";
import {
  ART_FOCAL_PX, CAB_SCALE, COWL_AHEAD_FT, GEAR_LETTERS, GEAR_READOUT_RECT_480, PANEL_SIZE_PX, SHIFT_LIGHT_RPM,
  SPEEDOMETER_MAX_MPH, STOCK_GAUGES, TACHOMETER_MAX_RPM, dialPlace, mirrorPlace, needleDegrees, panelPixel,
  panelPoint, panelRect, shifterPlace, shiftLightPlace, wheelPlace, wheelTurn,
} from "../../game/vr/cab.js";
import {
  ART_FITTINGS, ART_WALLS, AUX_GAUGES, AUX_Z, BAY_X, BAY_Z, COWL_Y, DASH_Z, DOME_LIGHT, FIREWALL_Z, FLOOR_FT, HEADLINER_Y,
  HEAD_BAR_Z,
  DIAGONAL_BOTTLE, PILLAR_CLAMPS, PUSH_BUTTONS, REAR_BOTTLE, REAR_FRAME_Z, SEAT_BACK_TILT_RAD, SEAT_BACK_TOP_FT,
  SEAT_CUSHION_TOP_FT, SEAT_CUSHION_Z, SHIFT_LAMP, SILL_Y, SWITCH_BUTTONS, SWITCH_BUTTON_RADIUS_PX,
  TUBE_DIAMETER, WALL_X, cageTubes, pillarLine, postBrackets, rearFrameBars, rearFrameBolts, rearGussets,
} from "../../game/vr/cab-cage.js";
import { mphFromFeetPerSecond } from "../race-gauges.js";
import { Soup, addSheet, addTriangle, addTube, canvasTexture, carpetTexture, foamTexture, plateTexture, treadTexture, tubeTexture } from "./cab-kit.js";

const S = CAB_SCALE;
const FACE_PX = 256;
/** A padded bar is cut into lengths about this long, art feet, with the tube showing between them. */
const PAD_LENGTH = 0.42, PAD_GAP = 0.014;
/** How far the room's plain walls stand behind the pictures hung on them, art feet. */
const BEHIND = 0.02;
/** The cowl deck's far edge sits this far under the body's top there, feet, so the hood covers it. */
const DECK_DROP_FT = 0.15;
/** The roof's sheet reaches this far to each side and ahead, art feet: past the bars, so no sky shows around it. */
const ROOF_X = 1.45, ROOF_Z = 1.3;
/** The drawn textures repeat this often, art feet: about the pictures' own grain at arm's length. */
const GRAIN = 0.27;
/** The steering wheel's rim and hub, as parts of its radius, and where its upper spokes stand, radians from upright. */
const RIM_PART = 0.107, HUB_PART = 0.33, SPOKE_TURNS = Object.freeze([-0.97, 0.97, Math.PI]);

/** An art-frame point (feet, z ahead) in the cab's frame, at the cab's scale. */
const V = (p) => new THREE.Vector3(p[0] * S, p[1] * S, -p[2] * S);
/** A colour as linear `[r, g, b]`, for a vertex. */
const rgb = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const WHITE = rgb(0xf2f1f1), RED = rgb(0xc8181a), DARK = rgb(0x1c1c1f), BLACK = rgb(0x0c0c0e), GREY = rgb(0x77777a);
const CABLE = Object.freeze({ cableRed: RED, cableWhite: rgb(0xd8d8d8), cableDark: rgb(0x2a2a2c) });
/** The shifter's frames: the part of their width left off at the left, and the part the plate proper spans. */
const SHIFTER_CUT = 36 / 128, SHIFTER_PLATE = Object.freeze([38 / 128, 101 / 128]);
const SILVER = rgb(0xa4a3a2), LIGHT = rgb(0xcfcfd1), AMBER = rgb(0xf08a1c), FOAM = rgb(0x1b1b1a), BAR = rgb(0x3a3a3e);

/** A dial's face drawn plain, with the game's marks: for an install without the cockpit. */
function plainFace(which) {
  return canvasTexture(FACE_PX, FACE_PX, (g) => {
    const gauge = STOCK_GAUGES[which], half = FACE_PX / 2, speed = which === "speedometer";
    const maximum = speed ? 100 : TACHOMETER_MAX_RPM, step = speed ? 10 : 1000;
    g.fillStyle = "#0b0c0e";
    g.fillRect(0, 0, FACE_PX, FACE_PX);
    g.strokeStyle = g.fillStyle = "#f2f2f2";
    g.lineWidth = 3;
    g.font = "bold 22px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (let v = 0; v <= maximum; v += step) {
      const a = needleDegrees(gauge, v, maximum) * Math.PI / 180, sin = Math.sin(a), cos = -Math.cos(a);
      g.beginPath();
      g.moveTo(half + sin * half * 0.82, half + cos * half * 0.82);
      g.lineTo(half + sin * half * 0.94, half + cos * half * 0.94);
      g.stroke();
      g.fillText(String(speed ? v : v / 1000), half + sin * half * 0.66, half + cos * half * 0.66);
    }
    g.fillStyle = "#e0251c";
    g.font = "bold 16px system-ui, sans-serif";
    g.fillText(speed ? "MPH" : "RPM x1000", half, half + half * 0.3);
  });
}

/**
 * @param {{ cockpit?: object|null, stock?: object|null, fit: { halfWidth: number, cowl: number }, look?: string }} options
 *   `cockpit` is the asset worker's dashboard art (worker/cockpit-art.js `cockpitArt`), `stock`
 *   its cockpit pictures (worker/cockpit-art.js `loadCockpit`), `fit` the cab's fit to the body
 *   (game/vr/cab.js `cabFit`)
 */
export function createVrCab({ cockpit = null, stock = null, fit, look = "classic" }) {
  const root = new THREE.Group();
  root.name = "vr-cab";
  root.visible = false;
  const disposables = [], materials = [];
  const keep = (thing) => { disposables.push(thing); return thing; };
  const sharp = look !== "enhanced";
  /**
   * An unlit material: the cab carries its own light, and `update` dims them all together,
   * but for those that `glow` (the needles, the gear readout, the shift lamp: lit instruments).
   */
  const material = (options, { glow = false } = {}) => {
    const made = keep(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false, fog: false, ...options }));
    if (!glow) materials.push(made);
    return made;
  };
  const layout = stock?.layout ?? null;

  // The pictures as textures. A picture's see-through black is backed dark here: the pieces
  // cut from them are shaped by their own geometry.
  function pictureTexture(image, { backing = "#0c0c0e" } = {}) {
    if (!image) return null;
    const { width, height, rgba } = image;
    const raw = document.createElement("canvas");
    raw.width = width;
    raw.height = height;
    raw.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), width, height), 0, 0);
    const texture = keep(canvasTexture(width, height, (g) => {
      if (backing) {
        g.fillStyle = backing;
        g.fillRect(0, 0, width, height);
      }
      g.drawImage(raw, 0, 0);
    }));
    if (sharp) texture.magFilter = THREE.NearestFilter;
    return texture;
  }
  // The front panel uncut where the worker has it (the dials' black is drawn, not see-through).
  const frontImage = cockpit?.height === 480 && cockpit.panel ? cockpit.panel : stock?.panels?.front ?? null;
  const pictures = {
    front: pictureTexture(frontImage), left: pictureTexture(stock?.panels?.left),
    right: pictureTexture(stock?.panels?.right), back: pictureTexture(stock?.panels?.back),
  };
  // What the triangles are gathered into: one mesh each.
  const soups = {
    chrome: new Soup(), paint: new Soup(), pad: new Soup({ colors: true }), flat: new Soup({ colors: true }),
    tread: new Soup(), plate: new Soup(), carpet: new Soup(),
    front: new Soup(), left: new Soup(), right: new Soup(), back: new Soup(),
  };
  const maps = {
    // A bright tube is dark at its edges with a hard highlight off its middle and a dark band
    // under it; a painted one black with a soft sheen.
    chrome: keep(tubeTexture([[-1, 20], [-0.9, 70], [-0.55, 150], [-0.34, 255], [-0.16, 250], [0.02, 150], [0.3, 60], [0.5, 40], [0.72, 120], [0.92, 90], [1, 25]])),
    paint: keep(tubeTexture([[-1, 6], [-0.75, 16], [-0.4, 44], [-0.22, 92], [-0.08, 60], [0.15, 26], [0.6, 14], [1, 6]])),
    // The padding's foam, the tread plate dark and lit, the headliner's carpet: drawn to look like the pictures'.
    pad: keep(foamTexture()), tread: keep(treadTexture()), plate: keep(plateTexture()), carpet: keep(carpetTexture()),
  };
  /** A cab-frame point's place on a picture, as texture coordinates. */
  const onPicture = (panel) => (x, y, z) => {
    const pixel = panelPixel(panel, [x, y, -z]) ?? [0, 0];
    return [pixel[0] / PANEL_SIZE_PX[0], 1 - pixel[1] / PANEL_SIZE_PX[1]];
  };
  const project = { front: onPicture("front"), left: onPicture("left"), right: onPicture("right"), back: onPicture("back") };

  // ---- The cage -------------------------------------------------------------------------
  const padShade = (cos) => 0.5 + 0.5 * Math.max(0, cos);
  function pad(a, b, radius) {
    const length = a.distanceTo(b), pieces = Math.max(1, Math.round(length / (PAD_LENGTH * S)));
    // The tube it is wrapped around shows between the lengths.
    addTube(soups.chrome, a, b, radius * 0.5, { radial: 8 });
    const gap = pieces > 1 ? PAD_GAP * S / length : 0, lip = Math.min(0.2, 0.03 * S * pieces / length);
    for (let i = 0; i < pieces; i++) {
      const from = a.clone().lerp(b, i / pieces + (i ? gap / 2 : 0)), to = a.clone().lerp(b, (i + 1) / pieces - (i + 1 < pieces ? gap / 2 : 0));
      addTube(soups.pad, from, to, radius, {
        radial: 12, tile: 1 / (GRAIN * S), turns: 2, caps: true, around: padShade,
        rings: [[0, 0.8], [lip, 1], [1 - lip, 1], [1, 0.8]],
      });
    }
  }
  for (const t of cageTubes()) {
    const a = V(t.from), b = V(t.to), radius = t.diameter * S / 2;
    if (t.kind === "pad") pad(a, b, radius);
    else if (t.kind === "paint") addTube(soups.paint, a, b, radius, { radial: 12 });
    else if (t.kind === "chrome") addTube(soups.chrome, a, b, radius, { radial: 10 });
    else addTube(soups.flat, a, b, radius, { radial: 6, color: CABLE[t.kind] ?? LIGHT, around: (cos) => 0.7 + 0.3 * cos });
  }
  // The strap clamps around the pillars.
  for (const [sideSign, name] of [[-1, "left"], [1, "right"]]) {
    const { top, foot } = pillarLine(sideSign);
    for (const part of PILLAR_CLAMPS[name]) {
      const at = top.map((c, i) => c + (foot[i] - c) * part), on = top.map((c, i) => c + (foot[i] - c) * (part + 0.016));
      addTube(soups.flat, V(at), V(on), (TUBE_DIAMETER.paint / 2 + 0.02) * S, { radial: 12, color: LIGHT, around: (cos) => 0.55 + 0.45 * cos });
    }
  }

  // The rear window's frame of bolted flat bar, the hoop's gussets, the brackets on the posts.
  for (const bar of rearFrameBars()) addSheet(soups.flat, bar.map(V), { color: BAR });
  for (const bolt of rearFrameBolts()) {
    soups.flat.add(new THREE.CylinderGeometry(0.016 * S, 0.016 * S, 0.012 * S, 8).rotateX(Math.PI / 2),
      new THREE.Matrix4().setPosition(V([bolt[0], bolt[1], bolt[2] + 0.008])), { color: LIGHT, shade: 0.6 });
  }
  for (const gusset of rearGussets()) addTriangle(soups.flat, gusset.map(V), GREY);
  for (const bracket of postBrackets()) addSheet(soups.flat, bracket.map(V), { color: BAR });

  // ---- The room: walls, firewall, floor, headliner -----------------------------------------
  const floorY = FLOOR_FT / S;
  /** A wall between two art-frame corners (top first), with the tread plate repeating over it. */
  const tread = (corners, soup = soups.tread) => addSheet(soup, corners.map(V), { tile: GRAIN * S });
  // The plain walls stand a little behind the pictures' own, which hang in front of them.
  const wallX = WALL_X + BEHIND, rearZ = REAR_FRAME_Z - BEHIND, toeZ = FIREWALL_Z + 0.5;
  for (const x of [-1, 1]) {
    // Each side: under the window from the rear wall to the dash bay, the step out to the bay, the bay's side.
    tread([[x * wallX, SILL_Y, rearZ], [x * wallX, SILL_Y, BAY_Z], [x * wallX, floorY, BAY_Z], [x * wallX, floorY, rearZ]]);
    tread([[x * wallX, SILL_Y, BAY_Z], [x * BAY_X, SILL_Y, BAY_Z], [x * BAY_X, floorY, BAY_Z], [x * wallX, floorY, BAY_Z]]);
    tread([[x * BAY_X, SILL_Y, BAY_Z], [x * BAY_X, COWL_Y, FIREWALL_Z], [x * BAY_X, floorY, FIREWALL_Z], [x * BAY_X, floorY, BAY_Z]]);
    // And on beside the toe board.
    tread([[x * BAY_X, COWL_Y, FIREWALL_Z], [x * BAY_X, COWL_Y, toeZ], [x * BAY_X, floorY, toeZ], [x * BAY_X, floorY, FIREWALL_Z]]);
    // The quarter panel beside the rear post, bright tread plate.
    tread([[x * wallX, 0.18, rearZ], [x * wallX, 0.18, -0.784], [x * wallX, SILL_Y, -0.784], [x * wallX, SILL_Y, rearZ]], soups.plate);
  }
  // The firewall under the dash, sloping away to the toe board; the rear wall under its window; the floor.
  tread([[-BAY_X, COWL_Y, FIREWALL_Z], [BAY_X, COWL_Y, FIREWALL_Z], [BAY_X, -FIREWALL_Z, FIREWALL_Z], [-BAY_X, -FIREWALL_Z, FIREWALL_Z]]);
  tread([[-BAY_X, -FIREWALL_Z, FIREWALL_Z], [BAY_X, -FIREWALL_Z, FIREWALL_Z], [BAY_X, floorY, toeZ], [-BAY_X, floorY, toeZ]]);
  tread([[-wallX, -0.27, rearZ], [wallX, -0.27, rearZ], [wallX, floorY, rearZ], [-wallX, floorY, rearZ]]);
  tread([[-BAY_X, floorY, toeZ], [BAY_X, floorY, toeZ], [BAY_X, floorY, rearZ], [-BAY_X, floorY, rearZ]]);
  // Over the rear window: a strip of tread plate where the light catches it, dark above to the roof.
  tread([[-1.4, 0.6, rearZ], [1.4, 0.6, rearZ], [1.4, 0.5, rearZ], [-1.4, 0.5, rearZ]], soups.plate);
  tread([[-1.4, HEADLINER_Y, rearZ], [1.4, HEADLINER_Y, rearZ], [1.4, 0.6, rearZ], [-1.4, 0.6, rearZ]]);
  // The roof: the headliner's carpet ahead of the padded bar behind the head, tread plate behind
  // it, and the dark spine across over the driver.
  addSheet(soups.carpet, [[-ROOF_X, HEADLINER_Y, ROOF_Z], [ROOF_X, HEADLINER_Y, ROOF_Z], [ROOF_X, HEADLINER_Y, HEAD_BAR_Z], [-ROOF_X, HEADLINER_Y, HEAD_BAR_Z]].map(V), { tile: GRAIN * S });
  tread([[-ROOF_X, HEADLINER_Y, HEAD_BAR_Z], [ROOF_X, HEADLINER_Y, HEAD_BAR_Z], [ROOF_X, HEADLINER_Y, rearZ], [-ROOF_X, HEADLINER_Y, rearZ]]);
  addSheet(soups.flat, [[-ROOF_X, HEADLINER_Y - 0.01, 0.0], [ROOF_X, HEADLINER_Y - 0.01, 0.0], [ROOF_X, HEADLINER_Y - 0.01, -0.12], [-ROOF_X, HEADLINER_Y - 0.01, -0.12]].map(V), { color: BLACK });
  // The cowl deck: from the firewall's top out to the hood, so the view over the dash does not
  // fall through the body's empty shell. It runs under the hood where the body has one.
  const deck = [
    V([-BAY_X, COWL_Y, FIREWALL_Z]), V([BAY_X, COWL_Y, FIREWALL_Z]),
    new THREE.Vector3(Math.max(fit.halfWidth, BAY_X * S), fit.cowl - DECK_DROP_FT, -COWL_AHEAD_FT),
    new THREE.Vector3(-Math.max(fit.halfWidth, BAY_X * S), fit.cowl - DECK_DROP_FT, -COWL_AHEAD_FT),
  ];
  addSheet(soups.tread, deck, { tile: GRAIN * S });

  // The pictures' own lower walls, where the install has them.
  for (const { panel, rect, plane } of ART_WALLS) {
    if (!pictures[panel]) continue;
    const [x, y, w, h] = rect;
    addSheet(soups[panel], [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => V(panelPoint(panel, px, py, plane))), { uv: project[panel] });
  }
  /** A fitting cut from a picture, standing proud on a dark body. Returns its middle, the cab's frame. */
  function fitting({ panel, rect, depth, thick }) {
    // The body runs straight away from the eyes, so from the driving position only the face shows.
    const face = panelRect(panel, rect, depth);
    const front = face.corners.map(V), back = front.map((p) => p.clone().multiplyScalar(1 + thick / depth));
    if (pictures[panel]) addSheet(soups[panel], front, { uv: project[panel] });
    else addSheet(soups.flat, front, { color: GREY });
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      addSheet(soups.flat, [front[i], front[j], back[j], back[i]], { color: DARK });
    }
    return V(face.center);
  }
  for (const key of Object.keys(ART_FITTINGS)) fitting(ART_FITTINGS[key]);
  // The switch plates' red buttons stand out of them.
  const plates = ART_FITTINGS.switchPlates;
  for (const [bx, by] of SWITCH_BUTTONS) {
    const r = SWITCH_BUTTON_RADIUS_PX * plates.depth / ART_FOCAL_PX * S;
    soups.flat.add(new THREE.CylinderGeometry(r, r, 0.03 * S, 12).rotateX(Math.PI / 2),
      new THREE.Matrix4().setPosition(V(panelPoint("front", bx, by, { z: plates.depth - 0.012 }))), { color: RED, shade: 0.5 });
  }

  // ---- The dials ---------------------------------------------------------------------------
  const needleMaterial = material({ color: 0xe8201c }, { glow: true });
  /** A round instrument standing square to the view ahead: housing, bezel and, from the picture, its face. */
  function instrument(center, radius, { face = null, bezel = WHITE, depth = 0.1 } = {}) {
    const at = V(center), r = radius * S;
    soups.flat.add(new THREE.CylinderGeometry(r * 0.97, r * 0.9, depth * S, 24).rotateX(Math.PI / 2),
      new THREE.Matrix4().setPosition(at.x, at.y, at.z - depth * S / 2 - 0.004), { color: DARK, shade: 0.7 });
    soups.flat.add(new THREE.TorusGeometry(r * 0.955, r * 0.045, 8, 36), new THREE.Matrix4().setPosition(at), { color: bezel, shade: 0.45 });
    if (!pictures.front) return;
    // The face is the picture's: its own, or another gauge's where the picture cuts this one off.
    const from = V(face ?? center), move = new THREE.Matrix4().setPosition(at.clone().sub(from));
    soups.front.add(new THREE.CircleGeometry(r * 0.92, 32), new THREE.Matrix4().setPosition(from), { uv: project.front, after: move });
  }
  function dial(which) {
    const gauge = cockpit?.[which] ?? STOCK_GAUGES[which];
    const place = dialPlace(which, gauge, cockpit?.height ?? 480);
    instrument(place.center, place.radius);
    const group = new THREE.Group();
    group.position.copy(V(place.center));
    if (!pictures.front) {
      const plain = new THREE.Mesh(keep(new THREE.CircleGeometry(place.radius * S * 0.9, 32)), material({ map: keep(plainFace(which)) }));
      group.add(plain);
    }
    const length = place.needle * S;
    const needle = new THREE.Mesh(keep(new THREE.BoxGeometry(0.014 * S, length * 1.15, 0.006 * S).translate(0, length * 0.425, 0.012 * S)), needleMaterial);
    const pivot = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.022 * S, 0.022 * S, 0.02 * S, 12).rotateX(Math.PI / 2).translate(0, 0, 0.012 * S)), needleMaterial);
    group.add(needle, pivot);
    root.add(group);
    return { gauge, needle, place };
  }
  const speedo = dial("speedometer"), tacho = dial("tachometer");

  // The tachometer's shift lamp on its arm: amber, and lit with the game's own art near the top of the revs.
  const lampAt = V(panelPoint("front", SHIFT_LAMP.center[0], SHIFT_LAMP.center[1], { z: DASH_Z - 0.07 }));
  const lampR = SHIFT_LAMP.radius * (DASH_Z - 0.07) / ART_FOCAL_PX * S;
  soups.flat.add(new THREE.CylinderGeometry(lampR, lampR * 0.9, 0.05 * S, 14).rotateX(Math.PI / 2), new THREE.Matrix4().setPosition(lampAt.x, lampAt.y, lampAt.z - 0.025 * S), { color: AMBER, shade: 0.5 });
  addTube(soups.flat, lampAt.clone().add(new THREE.Vector3(0, 0, -0.03 * S)), V(tacho.place.center).add(new THREE.Vector3(-tacho.place.radius * S * 0.7, tacho.place.radius * S * 0.7, -0.03 * S)), 0.012 * S, { radial: 6, color: LIGHT });
  let lamp = null;
  if (stock?.shiftLight) {
    const lit = pictureTexture(stock.shiftLight, { backing: null });
    const spot = shiftLightPlace(layout?.shiftLightRect);
    lamp = new THREE.Mesh(keep(new THREE.PlaneGeometry(spot.w * S * 1.15, spot.h * S * 1.15)), material({ map: lit, transparent: true }, { glow: true }));
    lamp.position.copy(lampAt).add(new THREE.Vector3(0, 0, 0.004 * S));
    lamp.visible = false;
    root.add(lamp);
  }

  // The gauge bank at the right of the dash, on its two rails: only with the picture, whose
  // faces they wear.
  if (pictures.front) AUX_GAUGES.forEach(([x, y, r, faceOf]) => {
    const source = AUX_GAUGES[faceOf];
    instrument(panelPoint("front", x, y, { z: AUX_Z }), r * AUX_Z / ART_FOCAL_PX,
      { face: panelPoint("front", source[0], source[1], { z: AUX_Z }), bezel: LIGHT, depth: 0.12 });
  });
  for (const [y, x0] of pictures.front ? [[373, 502], [455, 524]] : []) {
    addTube(soups.flat, V(panelPoint("front", x0, y, { z: AUX_Z + 0.05 })), V(panelPoint("front", 668, y, { z: AUX_Z + 0.05 })), 0.016 * S, { radial: 6, color: DARK, around: (cos) => 0.6 + 0.4 * cos });
  }

  // The push buttons on their posts.
  for (const { panel, radius, center } of PUSH_BUTTONS) {
    const at = V(center), r = radius * S;
    if (pictures[panel]) soups[panel].add(new THREE.CircleGeometry(r, 20), new THREE.Matrix4().setPosition(at), { uv: project[panel] });
    else soups.flat.add(new THREE.CircleGeometry(r, 20), new THREE.Matrix4().setPosition(at), { color: RED });
    soups.flat.add(new THREE.CylinderGeometry(r, r, 0.03 * S, 20).rotateX(Math.PI / 2), new THREE.Matrix4().setPosition(at.x, at.y, at.z - 0.017 * S), { color: DARK, shade: 0.6 });
    addTube(soups.flat, new THREE.Vector3(at.x, at.y - r, at.z - 0.02 * S), new THREE.Vector3(at.x, V([0, COWL_Y, 0]).y, at.z - 0.02 * S), 0.02 * S, { radial: 6, color: DARK, around: (cos) => 0.6 + 0.4 * cos });
  }

  // ---- Bottles -----------------------------------------------------------------------------
  /** A red bottle along `axis`: its body, a bright band, a neck at its lower end. */
  function bottle(center, axis, radius, length, { band = null } = {}) {
    const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().normalize());
    const place = (along) => new THREE.Matrix4().compose(center.clone().addScaledVector(axis, along), turn, new THREE.Vector3(1, 1, 1));
    soups.flat.add(new THREE.CylinderGeometry(radius, radius, length, 18), place(0), { color: RED, shade: 0.75 });
    if (band) soups.flat.add(new THREE.CylinderGeometry(radius * 1.03, radius * 1.03, length * band[1], 18), place(length * band[0]), { color: band[2], shade: 0.75 });
    soups.flat.add(new THREE.CylinderGeometry(radius * 0.3, radius * 0.55, length * 0.16, 12), place(-length * 0.58), { color: SILVER, shade: 0.7 });
    for (const along of [0.3, -0.3]) soups.flat.add(new THREE.TorusGeometry(radius * 1.05, radius * 0.07, 6, 18).rotateX(Math.PI / 2), place(length * along), { color: BLACK });
  }
  bottle(V(DIAGONAL_BOTTLE.center), V(DIAGONAL_BOTTLE.axis).normalize(), DIAGONAL_BOTTLE.radius * S, DIAGONAL_BOTTLE.length * S);
  bottle(V(REAR_BOTTLE.center), new THREE.Vector3(0, 1, 0), REAR_BOTTLE.radius * S, REAR_BOTTLE.length * S, { band: [-0.08, 0.42, SILVER] });

  // The dome light: a bright rim around the picture's own lens.
  const dome = V(DOME_LIGHT.center), domeR = DOME_LIGHT.radius * S;
  soups.flat.add(new THREE.CylinderGeometry(domeR, domeR * 0.8, 0.07 * S, 20).rotateX(Math.PI / 2), new THREE.Matrix4().setPosition(dome.x, dome.y, dome.z + 0.036 * S), { color: SILVER, shade: 0.6 });
  if (pictures.back) soups.back.add(new THREE.CircleGeometry(domeR * 0.96, 24).rotateY(Math.PI), new THREE.Matrix4().setPosition(dome.x, dome.y, dome.z - 0.001), { uv: project.back });
  addTube(soups.chrome, dome.clone().add(new THREE.Vector3(0, domeR, 0.03 * S)), new THREE.Vector3(dome.x, HEADLINER_Y * S, dome.z + 0.03 * S), 0.012 * S, { radial: 6 });

  // ---- The seat, the port's own ---------------------------------------------------------------
  const [cushionZ0, cushionZ1] = SEAT_CUSHION_Z, cushionMid = (cushionZ0 + cushionZ1) / 2;
  const box = (w, h, d, x, y, z, color, tiltX = 0) => soups.flat.add(new THREE.BoxGeometry(w, h, d),
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tiltX), new THREE.Vector3(1, 1, 1)), { color, shade: 0.7 });
  box(1.5, 0.4, cushionZ1 - cushionZ0, 0, SEAT_CUSHION_TOP_FT - 0.2, cushionMid, FOAM);
  box(0.6, FLOOR_FT - SEAT_CUSHION_TOP_FT + 0.4, 0.6, 0, (FLOOR_FT + SEAT_CUSHION_TOP_FT - 0.4) / 2, cushionMid, DARK);
  box(1.5, SEAT_BACK_TOP_FT - SEAT_CUSHION_TOP_FT, 0.3, 0, (SEAT_BACK_TOP_FT + SEAT_CUSHION_TOP_FT) / 2, cushionZ1 + 0.12, FOAM, -SEAT_BACK_TILT_RAD);
  for (const x of [-0.78, 0.78]) box(0.22, 0.55, cushionZ1 - cushionZ0 - 0.1, x, SEAT_CUSHION_TOP_FT - 0.1, cushionMid + 0.1, FOAM);

  // ---- The meshes --------------------------------------------------------------------------
  const mesh = (soup, options) => {
    if (soup.empty) return;
    root.add(new THREE.Mesh(keep(soup.build()), material(options)));
  };
  mesh(soups.chrome, { map: maps.chrome });
  mesh(soups.paint, { map: maps.paint });
  mesh(soups.pad, { map: maps.pad, vertexColors: true });
  mesh(soups.flat, { vertexColors: true });
  mesh(soups.tread, { map: maps.tread });
  mesh(soups.plate, { map: maps.plate });
  mesh(soups.carpet, { map: maps.carpet });
  for (const panel of ["front", "left", "right", "back"]) if (pictures[panel]) mesh(soups[panel], { map: pictures[panel] });

  // ---- The steering wheel ------------------------------------------------------------------
  // Foam rim, drilled silver spokes and a domed hub, as the game's wheel frames show them; it
  // stands where the layout's rectangle puts it, square to the view ahead.
  const wheel = wheelPlace(layout?.steeringWheel), wheelR = wheel.radius * S;
  const mount = new THREE.Group();
  mount.position.copy(V(wheel.center));
  const spin = new THREE.Group();
  const rim = new Soup({ colors: true }), metal = new Soup({ colors: true });
  rim.add(new THREE.TorusGeometry(wheelR * (1 - RIM_PART), wheelR * RIM_PART, 10, 40), null, { color: [1, 1, 1], shade: 0.5 });
  for (const turn of SPOKE_TURNS) {
    const spoke = new THREE.Matrix4().makeRotationZ(-turn);
    metal.add(new THREE.BoxGeometry(wheelR * 0.1, wheelR * (1 - 2 * RIM_PART - HUB_PART * 0.6), 0.02 * S).translate(0, wheelR * (HUB_PART * 0.6 + (1 - 2 * RIM_PART - HUB_PART * 0.6) / 2), 0), spoke, { color: SILVER, shade: 0.5 });
    // The three lightening holes down each spoke.
    for (const part of [0.5, 0.64, 0.78]) {
      metal.add(new THREE.CircleGeometry(wheelR * (0.022 + 0.018 * (0.78 - part) / 0.28), 10).translate(0, wheelR * part, 0.011 * S), spoke, { color: BLACK });
    }
  }
  metal.add(new THREE.SphereGeometry(wheelR * HUB_PART, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 0.45), null, { color: GREY, shade: 0.8 });
  spin.add(new THREE.Mesh(keep(rim.build()), material({ map: maps.pad, vertexColors: true })), new THREE.Mesh(keep(metal.build()), material({ vertexColors: true })));
  mount.add(spin);
  root.add(mount);
  // The column, down to the firewall.
  const column = new Soup();
  addTube(column, V(wheel.center), V([0, -FIREWALL_Z * 0.92, FIREWALL_Z]), 0.035 * S, { radial: 8 });
  root.add(new THREE.Mesh(keep(column.build()), material({ map: maps.paint })));

  // ---- The shifter -------------------------------------------------------------------------
  // The gated plate with the gear lit: the game's frame art itself, swapped per gear, as large as the
  // game's layout would draw it this far off, on a dark body. The frame's left edge is the dash
  // behind the plate, and is left off. It stands by the driver's right hand, turned to the
  // eyes, clear of the gauge bank the layout draws it over. Without the frames, a bare lever.
  const shift = shifterPlace(layout?.shifterRect);
  const shiftFrames = stock?.shifter ?? null, shiftTextures = {};
  for (const key of GEAR_LETTERS) if (shiftFrames?.[key]) shiftTextures[key] = pictureTexture(shiftFrames[key], { backing: null });
  let shifterPlate = null, shifterKey = Object.keys(shiftTextures)[0] ?? null;
  const extras = new Soup({ colors: true }), shiftAt = V(shift.center);
  if (shifterKey) {
    const stand = new THREE.Group();
    stand.position.copy(shiftAt);
    stand.lookAt(0, 0, 0);
    const kept = 1 - SHIFTER_CUT, plate = keep(new THREE.PlaneGeometry(shift.w * S * kept, shift.h * S));
    const uv = plate.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setX(i, SHIFTER_CUT + uv.getX(i) * kept);
    shifterPlate = new THREE.Mesh(plate, material({ map: shiftTextures[shifterKey], alphaTest: 0.5 }));
    shifterPlate.position.x = shift.w * S * SHIFTER_CUT / 2;
    // The body behind the plate proper.
    const [x0, x1] = SHIFTER_PLATE, body = new Soup({ colors: true });
    body.add(new THREE.BoxGeometry(shift.w * S * (x1 - x0), shift.h * S * 0.9, 0.06 * S).translate(shift.w * S * ((x0 + x1) / 2 - 0.5), 0, -0.034 * S), null, { color: DARK, shade: 0.6 });
    stand.add(shifterPlate, new THREE.Mesh(keep(body.build()), material({ vertexColors: true })));
    root.add(stand);
    addTube(extras, shiftAt.clone().add(new THREE.Vector3(0.02 * S, -shift.h * S * 0.3, -0.04 * S)), new THREE.Vector3(shiftAt.x, FLOOR_FT, shiftAt.z - 0.04 * S), 0.03 * S, { radial: 8, color: DARK, around: (cos) => 0.6 + 0.4 * cos });
  } else {
    addTube(extras, new THREE.Vector3(shiftAt.x, FLOOR_FT, shiftAt.z), shiftAt, 0.022 * S, { radial: 8, color: SILVER, around: (cos) => 0.6 + 0.4 * cos });
    extras.add(new THREE.SphereGeometry(0.05 * S, 12, 10), new THREE.Matrix4().setPosition(shiftAt), { color: FOAM, shade: 0.6 });
  }
  root.add(new THREE.Mesh(keep(extras.build()), material({ vertexColors: true })));

  // The gear readout, P R N 1 2 3 with the gear in red, where the game's cockpit prints it
  // under the dash (MONSTER_EXE_ANALYSIS.md section 11).
  const gearCanvas = document.createElement("canvas");
  gearCanvas.width = 192;
  gearCanvas.height = 32;
  const gearTexture = keep(new THREE.CanvasTexture(gearCanvas));
  gearTexture.colorSpace = THREE.SRGBColorSpace;
  const readout = panelRect("front", GEAR_READOUT_RECT_480, DASH_Z - 0.02);
  const gearPlate = new THREE.Mesh(keep(new THREE.PlaneGeometry(readout.w * S, readout.h * S)), material({ map: gearTexture }, { glow: true }));
  gearPlate.position.copy(V(readout.center));
  root.add(gearPlate);
  let shownGear = null;
  function showGear(gear) {
    if (gear === shownGear) return;
    shownGear = gear;
    const g = gearCanvas.getContext("2d");
    g.fillStyle = "#050506";
    g.fillRect(0, 0, 192, 32);
    g.font = "bold 24px ui-monospace, monospace";
    g.textAlign = "center";
    g.textBaseline = "middle";
    GEAR_LETTERS.forEach((letter, i) => {
      g.fillStyle = i + 1 === gear ? "#ff3a2c" : "#c9ccd1";
      g.fillText(letter, 16 + i * 32, 17);
    });
    gearTexture.needsUpdate = true;
  }

  // ---- The mirror --------------------------------------------------------------------------
  // The game's frame at the right pillar's head, dark glass behind it (no live view).
  if (stock?.mirror) {
    const spot = mirrorPlace(layout?.mirrors?.[0]?.bitmapRect), at = V(spot.center);
    const glass = new THREE.Mesh(keep(new THREE.PlaneGeometry(spot.w * S * 0.9, spot.h * S * 0.8)), material({ color: 0x0d0f12 }));
    glass.position.set(at.x, at.y, at.z - 0.006 * S);
    const frame = new THREE.Mesh(keep(new THREE.PlaneGeometry(spot.w * S, spot.h * S)), material({ map: pictureTexture(stock.mirror, { backing: null }), alphaTest: 0.5 }));
    frame.position.copy(at);
    root.add(glass, frame);
  }

  /** Each material's own colour, which `update` dims by the light. */
  const tints = materials.map((m) => m.color.clone());
  let shownLight = 1;

  return {
    object: root,
    /** The dash has its own dials, so the HUD's flat gauges are not needed with it. */
    hasGauges: true,
    /**
     * Each frame: whether the cab shows, and the truck's state to read: `speed` (ft/s), `rpm`,
     * `gear` and `steer` (the front wheels' angle, radians, right positive). `light` is how
     * bright the weather leaves the world, 0 to 1.
     */
    update(shown, state, light = 1) {
      root.visible = shown;
      if (!shown || !state) return;
      const level = Math.min(1, Math.max(0.12, light));
      if (level !== shownLight) {
        shownLight = level;
        materials.forEach((m, i) => m.color.copy(tints[i]).multiplyScalar(level));
      }
      const turn = (gauge, reading, maximum) => -needleDegrees(gauge, reading, maximum) * Math.PI / 180;
      speedo.needle.rotation.z = turn(speedo.gauge, mphFromFeetPerSecond(state.speed ?? 0), SPEEDOMETER_MAX_MPH);
      tacho.needle.rotation.z = turn(tacho.gauge, state.rpm ?? 0, TACHOMETER_MAX_RPM);
      spin.rotation.z = -wheelTurn(state.steer ?? 0, mtm2Sim.CONTROLS.steerLock);
      showGear(state.gear ?? 1);
      if (lamp) lamp.visible = (state.rpm ?? 0) >= SHIFT_LIGHT_RPM;
      const shiftGear = GEAR_LETTERS[(state.gear ?? 1) - 1] ?? "P";
      if (shifterPlate && shiftGear !== shifterKey && shiftTextures[shiftGear]) {
        shifterPlate.material.map = shiftTextures[shiftGear];
        shifterKey = shiftGear;
      }
    },
    dispose() {
      root.removeFromParent();
      for (const d of disposables) d.dispose();
    },
  };
}
