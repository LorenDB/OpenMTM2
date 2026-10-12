/*
  The stock cockpit panels around the driver in the headset (docs/VR.md, "The stock panels"). The
  game's cockpit is four pictures, front, left, right and back (`MONSTER_EXE_ANALYSIS.md` section
  11): each 640 x 480 with pure black see-through, drawn through one camera a quarter turn apart
  (game/vr/cab.js). In the headset they hang as a box around the eyes, each where that camera
  puts it, so every pixel is seen in the direction it was drawn in; the game's flat pieces are
  laid on the front one where the layout puts them. Pure, in feet around the eyes (x right, y
  up, -z ahead), so it runs under Node; render/xr/vr-panels.js draws it.

  The pictures are 106 degrees wide and overlap their neighbours. The front one hangs whole,
  since the layout's pieces lie on all of it; the side ones begin where it ends and run to their
  own far edges; the back one fills what is left between them.
*/
import { ART_FOCAL_PX, PANEL_SIZE_PX } from "./cab.js";

/** The panels' size, pixels. */
export const [PANEL_W, PANEL_H] = PANEL_SIZE_PX;
/** How far ahead of the eyes the front panel hangs, feet. */
export const PANEL_HALF_FT = 5;
/** How far ahead of the front panel its pieces sit, feet. */
export const PANEL_LIFT_FT = 0.05;

/** The tangent of half a picture's width: its edge columns look this far aside per foot ahead. */
const EDGE = PANEL_W / 2 / ART_FOCAL_PX;

/**
 * The box around the eyes. Each side has its `position` (feet), its turn about the vertical
 * (`rotationY`, radians, for a plane facing +z), its `width` and `height` in feet, and the
 * `columns` of its picture it shows, `[from, to]` pixels. `half` is how far ahead the front
 * panel hangs.
 */
export function panelBox(half = PANEL_HALF_FT) {
  // The front picture's edges are this far aside; the side pictures hang there and run this far back.
  const wide = half * EDGE, deep = wide * EDGE;
  // A side picture's column that looks at the front picture's edge, and the back picture's that looks at a side one's.
  const corner = PANEL_W / 2 - ART_FOCAL_PX * half / wide, rear = ART_FOCAL_PX * wide / deep;
  const middle = (deep - half) / 2;
  return {
    front: { position: [0, 0, -half], rotationY: 0, width: 2 * wide, height: 2 * half, columns: [0, PANEL_W] },
    right: { position: [wide, 0, middle], rotationY: -Math.PI / 2, width: half + deep, height: 2 * wide, columns: [corner, PANEL_W] },
    left: { position: [-wide, 0, middle], rotationY: Math.PI / 2, width: half + deep, height: 2 * wide, columns: [0, PANEL_W - corner] },
    back: { position: [0, 0, deep], rotationY: Math.PI, width: 2 * wide, height: 2 * deep, columns: [PANEL_W / 2 - rear, PANEL_W / 2 + rear] },
  };
}

/**
 * A `[x, y, w, h]` pixel rectangle of the front panel as a quad on it: `position` in feet
 * around the eyes and its `size`, lifted ahead of the panel so it draws over it.
 */
export function frontRect(rect, half = PANEL_HALF_FT) {
  const [x, y, w, h] = rect, foot = half / ART_FOCAL_PX;
  return {
    position: [(x + w / 2 - PANEL_W / 2) * foot, (PANEL_H / 2 - (y + h / 2)) * foot, -half + PANEL_LIFT_FT],
    size: [w * foot, h * foot],
  };
}

/**
 * A gauge's needle as a quad on the front panel: centred on the gauge, twice its radius
 * across, so a needle drawn about the canvas's middle turns about the gauge's centre.
 * `gauge` is `{ center, radius }` in panel pixels (the layout's, or STOCK_GAUGES).
 */
export function needleQuad(gauge, half = PANEL_HALF_FT) {
  if (!gauge) return null;
  return frontRect([gauge.center[0] - gauge.radius, gauge.center[1] - gauge.radius, 2 * gauge.radius, 2 * gauge.radius], half);
}
