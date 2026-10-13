/*
  The stock cockpit panels around the driver in the headset (docs/VR.md, "The cab").

  The game's cockpit is four pictures, front, left, right and back, each 640 x 480 with pure
  black see-through (`MONSTER_EXE_ANALYSIS.md` section 11). They hang here as a box around the
  eyes, each where the camera it was drawn through puts it (game/vr/panels.js), so looking
  ahead shows the dash through the 3D window's cutout as the flat cockpit does. The flat pieces come
  along on the front panel where the layout puts them: the two needles drawn with the game's
  needle art, the steering wheel frame for the steering angle, the shifter frame for the gear,
  and the shift light near the top of the rev range. The mirror and the finder stay out: the
  mirror wants a live view, and the finder already hangs from the seat as part of the HUD.
*/
import * as THREE from "three";
import { wheelFrame } from "../cockpit.js";
import { drawNeedle, gaugeAngle, mphFromFeetPerSecond } from "../race-gauges.js";
import { GEAR_LETTERS, SHIFT_LIGHT_RPM, SPEEDOMETER_MAX_MPH, STOCK_GAUGES, TACHOMETER_MAX_RPM } from "../../game/vr/cab.js";
import { PANEL_W, frontRect, needleQuad, panelBox } from "../../game/vr/panels.js";

/** A needle canvas's pixels per panel pixel: the layout's radii are only a few dozen. */
const NEEDLE_SCALE = 4;

/** An image (`{ width, height, rgba }`) as a canvas, one per image. */
const canvases = new WeakMap();
function imageCanvas(image) {
  if (!canvases.has(image)) {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(image.rgba.buffer, image.rgba.byteOffset, image.rgba.length), image.width, image.height), 0, 0);
    canvases.set(image, canvas);
  }
  return canvases.get(image);
}

/**
 * @param {{ art: object, needle?: object|null, look?: string }} options `art` is the asset
 *   worker's cockpit art (worker/cockpit-art.js `loadCockpit`), `needle` NEEDLE.BIN as flat
 *   shapes (or null for plain lines); both when the install has them
 * @returns null when the install's art cannot make the box (no layout or panels)
 */
export function createVrPanelsCab({ art, needle = null, look = "classic" }) {
  const layout = art?.layout, panels = art?.panels;
  if (!layout || !panels) return null;
  const box = panelBox();
  const root = new THREE.Group();
  root.name = "vr-panels";
  root.visible = false;
  const disposables = [];
  const keep = (thing) => { disposables.push(thing); return thing; };
  const textures = new WeakMap();
  /** A static image as a texture, made once. */
  const textureFor = (image) => {
    if (!image) return null;
    if (!textures.has(image)) {
      const texture = keep(new THREE.CanvasTexture(imageCanvas(image)));
      texture.colorSpace = THREE.SRGBColorSpace;
      if (look !== "enhanced") texture.magFilter = THREE.NearestFilter;
      textures.set(image, texture);
    }
    return textures.get(image);
  };

  // The box: one quad per side the install has. Pure black is cut out of the art, so the world
  // shows through the 3D window exactly as on the flat screen.
  for (const side of ["front", "back", "left", "right"]) {
    const texture = textureFor(panels[side]);
    if (!texture) continue;
    const place = box[side];
    // Only the columns this side shows: the pictures overlap their neighbours.
    const geometry = keep(new THREE.PlaneGeometry(place.width, place.height)), uv = geometry.getAttribute("uv");
    const [from, to] = place.columns;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (from + uv.getX(i) * (to - from)) / PANEL_W);
    const mesh = new THREE.Mesh(
      geometry,
      keep(new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5, toneMapped: false, fog: false })));
    mesh.position.fromArray(place.position);
    mesh.rotation.y = place.rotationY;
    root.add(mesh);
  }

  /** A flat piece on the front panel, at the layout's rectangle. Null without its art. */
  function piece(rect, image) {
    const texture = textureFor(image);
    if (!texture) return null;
    const place = frontRect(rect);
    const mesh = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(...place.size)),
      keep(new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false, fog: false })));
    mesh.position.fromArray(place.position);
    root.add(mesh);
    return mesh;
  }

  /** A live needle on the front panel: redrawn about the gauge's centre as readings change. */
  function dial(which) {
    const gauge = layout[which] ?? STOCK_GAUGES[which];
    const place = needleQuad(gauge);
    if (!place) return null;
    const radius = gauge.radius * NEEDLE_SCALE;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.ceil(radius * 2);
    const texture = keep(new THREE.CanvasTexture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(...place.size)),
      keep(new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false, fog: false })));
    mesh.position.fromArray(place.position);
    root.add(mesh);
    const ctx = canvas.getContext("2d");
    let last = null;
    const maximum = which === "speedometer" ? SPEEDOMETER_MAX_MPH : TACHOMETER_MAX_RPM;
    return {
      gauge,
      set(reading) {
        const key = Number(reading).toFixed(1);
        if (key === last) return;
        last = key;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawNeedle(ctx, needle, radius, radius, gaugeAngle(reading, gauge.zeroAngle - 90, gauge.degreesPerUnit, maximum), radius);
        texture.needsUpdate = true;
      },
    };
  }
  const speedo = dial("speedometer"), tacho = dial("tachometer");
  const wheelFrames = art.wheel ?? {}, shifterFrames = art.shifter ?? {};
  const someFrame = (frames) => Object.values(frames).find(Boolean) ?? null;
  const wheel = piece(layout.steeringWheel, wheelFrames.C00 ?? someFrame(wheelFrames));
  let wheelKey = null;
  const shifter = piece(layout.shifterRect, shifterFrames.P ?? someFrame(shifterFrames));
  let shifterKey = null;
  const light = piece(layout.shiftLightRect, art.shiftLight);

  return {
    object: root,
    /** The box shows the speed, revs and gear on the front panel, so the flat gauges stay hidden. */
    hasGauges: true,
    /**
     * Each frame: whether the box shows, and the truck's state to read: `speed` (ft/s), `rpm`,
     * `gear` and `steer` (the front wheels' angle, radians, right positive).
     */
    update(shown, state) {
      root.visible = shown;
      if (!shown || !state) return;
      speedo?.set(mphFromFeetPerSecond(state.speed ?? 0));
      tacho?.set(state.rpm ?? 0);
      const frame = wheelFrame(state.steer ?? 0);
      if (wheel && frame !== wheelKey) {
        const texture = textureFor(wheelFrames[frame]);
        if (texture) { wheel.material.map = texture; wheel.material.needsUpdate = true; wheelKey = frame; }
      }
      const shift = GEAR_LETTERS[(state.gear ?? 1) - 1] ?? "P";
      if (shifter && shift !== shifterKey) {
        const texture = textureFor(shifterFrames[shift]);
        if (texture) { shifter.material.map = texture; shifter.material.needsUpdate = true; shifterKey = shift; }
      }
      if (light) light.visible = (state.rpm ?? 0) >= SHIFT_LIGHT_RPM;
    },
    dispose() {
      root.removeFromParent();
      for (const d of disposables) d.dispose();
    },
  };
}
