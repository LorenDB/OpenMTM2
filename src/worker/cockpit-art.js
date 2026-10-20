/*
  The cockpit art from `COCKPIT.POD` (MONSTER_EXE_ANALYSIS.md 11).

  `loadCockpit` is the 640 x 480 set: the layout of `DATA\POWERBIG.480`, the four panels, the
  15 steering wheel frames, the six shifter frames, the shift light, the mirror frame, and the
  finder's ring, arrows and dots. Every image is `{ width, height, rgba }` with pure black cut
  out. The shifter and mirror frames have no palette of their own and use METALCR2's.

  `cockpitArt` is the dashboard panel the headset's cab takes its dial faces from, with the
  needles' angles from the layout (docs/VR.md, "The cab"): the layout `DATA\POWERBIG.<h>` and
  the front panel it names (`ART\PBIG<h>.RAW` with its `.ACT`), for the screen heights 480, 400
  and 200.
*/
import { decodeActPalette } from "../vendor/openphotex/texture/act.js";
import { decodeIndexedImage } from "../vendor/openphotex/texture/raw.js";
import { parseCockpitLayout } from "../vendor/openphotex/mtm/cockpit.js";
import { podPathTitle } from "../vendor/openphotex/pod/paths.js";

const stemOf = (name) => name.replace(/\.raw$/i, "").toUpperCase();
const WHEEL_KEYS = ["C00", ...[5, 10, 15, 20, 25, 30, 35].flatMap((d) => [`L${String(d).padStart(2, "0")}`, `R${String(d).padStart(2, "0")}`])];
const SHIFTER_KEYS = ["P", "R", "N", "1", "2", "3"];

/** `{ layout, panels, wheel, shifter, shiftLight, mirror, finder }`, or null without the install's cockpit. */
export async function loadCockpit(vfs) {
  const layoutBytes = await vfs.read("DATA\\POWERBIG.480");
  const layout = layoutBytes && parseCockpitLayout(layoutBytes);
  if (!layout) return null;
  // The shifter and mirror frame have no .ACT of their own; they are drawn in the game's METALCR2 palette (STARTUP.POD).
  const metalBytes = await vfs.read("ART\\METALCR2.ACT");
  const fallback = metalBytes ? decodeActPalette(metalBytes) : null;
  const sprite = async (stem, width, height) => {
    const raw = await vfs.read(`ART\\${stem}.RAW`);
    const own = await vfs.read(`ART\\${stem}.ACT`);
    const palette = own ? decodeActPalette(own) : fallback;
    if (!raw || !palette || raw.length < width * height) return null;
    return { width, height, rgba: decodeIndexedImage(raw, palette, width, height, { cutout: true }).rgba };
  };
  const [, , wheelW, wheelH] = layout.steeringWheel, [, , shiftW, shiftH] = layout.shifterRect;
  const [, , lightW, lightH] = layout.shiftLightRect, [, , mirW, mirH] = layout.mirrors[0]?.bitmapRect ?? [0, 0, 0, 0];
  const out = { layout: { ...layout, sections: undefined }, panels: {}, wheel: {}, shifter: {}, finder: {}, shiftLight: null, mirror: null };
  const jobs = [];
  const put = (target, key, promise) => jobs.push(promise.then((image) => { target[key] = image; }));
  ["front", "left", "right", "back"].forEach((name, n) => layout.backgrounds[n] && put(out.panels, name, sprite(stemOf(layout.backgrounds[n]), 640, 480)));
  for (const key of WHEEL_KEYS) put(out.wheel, key, sprite(`${layout.steeringWheelBase.toUpperCase()}${key}`, wheelW, wheelH));
  for (const key of SHIFTER_KEYS) put(out.shifter, key, sprite(`${layout.shifter.toUpperCase()}${key}`, shiftW, shiftH));
  put(out, "shiftLight", sprite(stemOf(layout.shiftLight), lightW, lightH));
  if (mirW) put(out, "mirror", sprite(stemOf(layout.mirrors[0].bitmap), mirW, mirH));
  put(out.finder, "ring", sprite("FI480", 60, 60));
  put(out.finder, "arrowGreen", sprite("FI480GA", 12, 6));
  put(out.finder, "arrowRed", sprite("FI480RA", 12, 6));
  put(out.finder, "dotGreen", sprite("FI480GD", 6, 6));
  put(out.finder, "dotRed", sprite("FI480RD", 6, 6));
  await Promise.all(jobs);
  return out;
}

const WIDTHS = Object.freeze({ 480: 640, 400: 640, 200: 320 });

/**
 * `{ height, speedometer, tachometer, panel: { width, height, rgba } }`, or null when the install
 * has no cockpit. A gauge is `{ center, radius, zeroAngle, degreesPerUnit }`: pixels on the panel,
 * degrees clockwise from twelve o'clock, per mph or per rpm.
 */
export async function cockpitArt(vfs, { height = 480 } = {}) {
  for (const h of [height, 480, 400, 200]) {
    const width = WIDTHS[h];
    const text = width ? await vfs.read(`DATA\\POWERBIG.${h}`) : null;
    const layout = text ? parseCockpitLayout(text) : null;
    const background = layout?.backgrounds[0];
    if (!background) continue;
    const stem = podPathTitle(background).replace(/\.raw$/i, "").toUpperCase();
    const raw = await vfs.read(`ART\\${stem}.RAW`);
    const palette = decodeActPalette(await vfs.read(`ART\\${stem}.ACT`));
    if (!raw || !palette || raw.length < width * h) continue;
    const image = decodeIndexedImage(raw, palette, width, h);
    const gauge = (g) => ({ center: g.center, radius: g.radius, zeroAngle: g.zeroAngle, degreesPerUnit: g.degreesPerUnit });
    return {
      height: h, speedometer: gauge(layout.speedometer), tachometer: gauge(layout.tachometer),
      panel: { width: image.width, height: image.height, rgba: image.rgba },
    };
  }
  return null;
}
