/*
  The chase-view speedometer, tachometer and gear strip, laid out as in the game's 640 x 480
  race screen (MONSTER_EXE_ANALYSIS.md 11): numbers in the HUD's light grey with a one-pixel
  black shadow around a dial, the red `NEEDLE.BIN` needle, and the small "PRN123" strip.
  The sweeps are the exe's: the speedometer starts at 304.5 degrees and turns 2.65 degrees per
  mph, the tachometer at 153 degrees and 0.0261 degrees per rpm (the exe's angles are 90 degrees
  ahead of the canvas's, which count clockwise from the x axis).
  The canvas is the view in device pixels. As Community Patch 3 does at higher resolutions, the
  dial centres move with the screen (x by its width over 640, y by its height over 480), the dials'
  radii grow with the height, and the numbers are the font at a whole-number scale.
*/
import { drawText, textWidth } from "./bitmap-text.js";

export const mphFromFeetPerSecond = (speed) => Math.abs(speed) * 3600 / 5280;
export const kphFromFeetPerSecond = (speed) => Math.abs(speed) * 0.3048 * 3.6;
/** P, R, N, then the forward gears 1, 2, 3... (a 4x4 Evolution vehicle may have more than MTM2's three). */
export const gearLabel = (gear) => ["", "P", "R", "N"][gear] ?? (gear >= 4 ? String(gear - 3) : "");
/** The speedometer's full scale and tick spacing in a unit. */
export const SPEED_SCALE = Object.freeze({ mph: { max: 110, step: 10 }, kph: { max: 180, step: 20 } });

const GREY = "#cfcfcf", GEAR_ON = "#f4a5a5";
const DEG = Math.PI / 180;
/** Dial centres, the exe's start angles and sweeps per unit, and the needle's reach, in 640 x 480 pixels. */
export const SPEEDO = { x: 106, y: 391, start: 304.5 - 90, perMph: 2.65 };
export const TACHO = { x: 533, y: 391, start: 153 - 90, perRpm: 0.0261 };
const LABEL_R = 73, TICK_FROM = 51, TICK_TO = 56, NEEDLE_R = 47;
/** The gear strip's middle and baseline in 640 x 480 pixels, and the pitch of its letters in font pixels. */
const GEAR_X = 321, GEAR_Y = 461, GEAR_PITCH = 10;

/**
 * Where everything goes on a `width` x `height` canvas with the font drawn `scale` times its
 * size: the dial centres, the radii of the numbers, ticks and needle, and the gear strip.
 */
export function gaugeLayout(width = 640, height = 480, scale = 1) {
  const sx = width / 640, sy = height / 480;
  return {
    width, height, scale,
    speedo: { x: SPEEDO.x * sx, y: SPEEDO.y * sy },
    tacho: { x: TACHO.x * sx, y: TACHO.y * sy },
    labelR: LABEL_R * sy, tickFrom: TICK_FROM * sy, tickTo: TICK_TO * sy, needleR: NEEDLE_R * sy,
    tickWidth: Math.max(1, sy / 2),
    gear: { x: Math.round(GEAR_X * sx), y: Math.round(GEAR_Y * sy), pitch: GEAR_PITCH * scale },
  };
}

/** A dial's needle angle in canvas radians: `start` degrees, then `perUnit` degrees for each unit of `value`. */
export const gaugeAngle = (value, start, perUnit, maximum = Infinity) => (start + perUnit * Math.max(0, Math.min(maximum, value))) * DEG;

/** The needle's colours: the model's two lit faces are drawn red, its hub stays dark. */
const needleFill = (color, lit) => ((color & 0xffffff) === 0x202020 ? "#202020" : lit ? "#ff2a36" : "#b00016");

/**
 * Draw the needle model (NEEDLE.BIN as flat shapes, or a plain line when null) from (cx, cy)
 * along `angle` (canvas radians), its tip `reach` pixels out.
 */
export function drawNeedle(ctx, needle, cx, cy, angle, reach) {
  if (!needle) {
    ctx.strokeStyle = "#e0101e";
    ctx.lineWidth = Math.max(3, reach / 16);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach); ctx.stroke();
    return;
  }
  const tip = Math.max(...needle.flatMap((shape) => shape.points.map((p) => p[1])));
  const k = reach / tip;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle + Math.PI / 2);
  needle.forEach(({ color, points }, shape) => {
    ctx.fillStyle = needleFill(color, shape === 0);
    for (let n = 0; n + 2 < points.length; n += 3) {
      ctx.beginPath();
      ctx.moveTo(points[n][0] * k, -points[n][1] * k);
      ctx.lineTo(points[n + 1][0] * k, -points[n + 1][1] * k);
      ctx.lineTo(points[n + 2][0] * k, -points[n + 2][1] * k);
      ctx.closePath();
      ctx.fill();
    }
  });
  ctx.restore();
}

/**
 * `needle` is NEEDLE.BIN as flat shapes (the asset worker's `needle`), or null for a plain line;
 * `units` is "mph" or "kph". The canvas starts as the 640 x 480 screen; `setSize` makes it the view's.
 */
export function createRaceGauges(font, { needle = null, units = "mph" } = {}) {
  const canvas = document.createElement("canvas");
  canvas.className = "race-gauges";
  let layout = gaugeLayout();
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");
  let last = "", version = 0;
  let unit = units, shown = true;
  // The dials' ticks and numbers, drawn once for each unit and size: a reading changes nearly every frame, they do not.
  let face = null, faceKey = null;

  /** Text centred on (x, y) with the game's shadow, on `g` (the gauges' canvas, or their face's). */
  const labelOn = (g, text, x, y, color = GREY) => {
    const { scale } = layout;
    if (font) {
      const w = textWidth(font, text, scale), left = Math.round(x - w / 2), top = Math.round(y - 8 * scale);
      drawText(g, font, text, left + scale, top + scale, { color: "#000", scale });
      drawText(g, font, text, left, top, { color, scale });
    } else {
      g.font = `bold ${12 * scale}px monospace`;
      g.textAlign = "center";
      g.fillStyle = "#000"; g.fillText(text, x + scale, y + 5 * scale);
      g.fillStyle = color; g.fillText(text, x, y + 4 * scale);
    }
  };

  /** A dial's ticks and numbers on `g`. */
  const dialFace = (g, { x, y }, angleOf, labels) => {
    const { labelR, tickFrom, tickTo, tickWidth } = layout;
    g.strokeStyle = "rgba(225,225,225,.9)";
    g.lineWidth = tickWidth;
    for (const n of labels) {
      const a = angleOf(n);
      g.beginPath();
      g.moveTo(x + Math.cos(a) * tickFrom, y + Math.sin(a) * tickFrom);
      g.lineTo(x + Math.cos(a) * tickTo, y + Math.sin(a) * tickTo);
      g.stroke();
      labelOn(g, String(n), x + Math.cos(a) * labelR, y + Math.sin(a) * labelR);
    }
  };

  const speedAngle = (v) => {
    const { max } = SPEED_SCALE[unit];
    return gaugeAngle(v, SPEEDO.start, unit === "kph" ? SPEEDO.perMph / 1.609344 : SPEEDO.perMph, max);
  };
  const rpmAngle = (v) => gaugeAngle(v * 1000, TACHO.start, TACHO.perRpm, 9000);

  /** Both dials' faces for the unit and size in use, made when either changes. */
  const faces = () => {
    const key = `${unit}|${layout.width}|${layout.height}|${layout.scale}`;
    if (face && faceKey === key) return face;
    face ??= document.createElement("canvas");
    face.width = layout.width;
    face.height = layout.height;
    const g = face.getContext("2d");
    g.clearRect(0, 0, face.width, face.height);
    const { max, step } = SPEED_SCALE[unit];
    dialFace(g, layout.speedo, speedAngle, Array.from({ length: max / step + 1 }, (_, i) => i * step));
    dialFace(g, layout.tacho, rpmAngle, Array.from({ length: 10 }, (_, i) => i));
    faceKey = key;
    return face;
  };

  return {
    element: canvas,
    /** The Dashboard key: show or hide both gauges and the gear strip. */
    toggle() { shown = !shown; canvas.hidden = !shown; return shown; },
    setVisible(on) { shown = !!on; canvas.hidden = !shown; },
    get visible() { return shown; },
    setUnits(next) { unit = next === "kph" ? "kph" : "mph"; last = ""; },
    /** Lay the gauges out on a `width` x `height` canvas (device pixels), the font `scale` times its size. */
    setSize(width, height, scale = 1) {
      if (width === layout.width && height === layout.height && scale === layout.scale) return;
      layout = gaugeLayout(width, height, scale);
      canvas.width = width;
      canvas.height = height;
      last = "";
    },
    /** Counts the redraws, for the headset's copy of the gauges (render/xr/vr-hud.js). */
    get version() { return version; },
    set({ speed = 0, rpm = 0, gear = 1, gears = 3 }) {
      if (!shown) return;
      const kph = unit === "kph";
      const reading = kph ? kphFromFeetPerSecond(speed) : mphFromFeetPerSecond(speed), thousands = Math.max(0, rpm / 1000);
      const key = `${reading.toFixed(1)}|${thousands.toFixed(1)}|${gear}|${gears}|${unit}`;
      if (key === last) return;
      last = key;
      version++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(faces(), 0, 0);
      drawNeedle(ctx, needle, layout.speedo.x, layout.speedo.y, speedAngle(reading), layout.needleR);
      drawNeedle(ctx, needle, layout.tacho.x, layout.tacho.y, rpmAngle(thousands), layout.needleR);
      // The gear strip at the bottom with the current gear lit (the exe draws it at a fixed spot): every forward gear
      // the gearbox has, MTM2's three or a 4x4 Evolution vehicle's own.
      const forward = Math.max(gears, gear - 3);
      const items = ["P", "R", "N", ...Array.from({ length: forward }, (_, i) => String(i + 1))];
      const { x, y, pitch } = layout.gear;
      items.forEach((item, i) => labelOn(ctx, item, x + (i - (items.length - 1) / 2) * pitch, y, item === gearLabel(gear) ? GEAR_ON : GREY));
    },
  };
}
