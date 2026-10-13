/*
  The driver's seat (docs/VR.md, "The seat"). A truck's files do not say where its driver sits:
  the game's cockpit is a picture laid over the view. In VR the eyes need a place inside the body,
  so one is read off the body model, and the player can move it.

  Stock bodies share their proportions: the cab roof is over the stretch from the body's origin to
  about 2.5 ft ahead of it (pickups carry their beds behind, vans their boxes; a light bar or a
  wing further back is higher than the roof and must not count). The eyes go on the centre line,
  as the game's centred steering wheel has them, a foot under that roof.

  Pure, in body feet (x right, y up, z forward), so it runs under Node.
*/
import { fromScene } from "../../shared/scene-frame.js";

/** The stretch of the body, forward of its origin, whose top is the cab roof; and its half width. */
export const CAB_Z = Object.freeze([-0.5, 2.5]);
export const CAB_HALF_WIDTH = 1.25;
/** The eyes under the roof's outside, and ahead of the body's origin, feet. */
export const HEADROOM_FT = 1.0;
export const EYE_FORWARD_FT = 1.0;
/** Used when the model has nothing over the cab stretch. */
const FALLBACK_ROOF_FT = 4.9;
/** How far the player may move the seat from where the body puts it, feet, per axis. */
export const SEAT_LIMIT_FT = Object.freeze([3, 4, 6]);
/** One press of a seat button, feet. */
export const SEAT_STEP_FT = 0.25;

/** The part of a convex polygon (points [x, y, z]) where `axis` times `sign` is at most `limit`. */
function clip(polygon, axis, sign, limit) {
  const out = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const da = a[axis] * sign - limit, db = b[axis] * sign - limit;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}

/**
 * The highest point of a body over the stretch from `z0` to `z1` (forward) within `halfWidth` of
 * the centre line, body feet, or null when the body has nothing there. `meshes` are the body
 * model's meshes as the renderer has them, triangle soups in scene coordinates (x, y, -z). Each
 * face is cut to the stretch, since a roof may be two big triangles whose corners all lie outside it.
 */
export function bodyTop(meshes, z0, z1, halfWidth = CAB_HALF_WIDTH) {
  let top = -Infinity;
  for (const mesh of meshes ?? []) {
    const p = mesh.positions;
    for (let i = 0; i + 8 < p.length; i += 9) {
      // The triangle's corners in the body frame.
      let polygon = [fromScene(p[i], p[i + 1], p[i + 2], []), fromScene(p[i + 3], p[i + 4], p[i + 5], []), fromScene(p[i + 6], p[i + 7], p[i + 8], [])];
      polygon = clip(polygon, 0, 1, halfWidth);
      polygon = clip(polygon, 0, -1, halfWidth);
      polygon = clip(polygon, 2, 1, z1);
      polygon = clip(polygon, 2, -1, -z0);
      for (const corner of polygon) if (corner[1] > top) top = corner[1];
    }
  }
  return Number.isFinite(top) ? top : null;
}

/** The roof height over the cab: the body's top within the cab stretch, or null. */
export function cabRoofHeight(meshes) {
  return bodyTop(meshes, CAB_Z[0], CAB_Z[1]);
}

/** The driver's eye point for a body model, body feet [right, up, forward]. */
export function seatFromBody(meshes) {
  const roof = cabRoofHeight(meshes) ?? FALLBACK_ROOF_FT;
  return [0, roof - HEADROOM_FT, EYE_FORWARD_FT];
}

/** A stored seat offset brought into shape: three finite numbers within the limits. */
export function cleanSeatOffset(offset) {
  return SEAT_LIMIT_FT.map((limit, i) => {
    const v = Number(Array.isArray(offset) ? offset[i] : 0);
    return Number.isFinite(v) ? Math.min(limit, Math.max(-limit, v)) : 0;
  });
}

/** The offset after a move of `delta` feet [right, up, forward], kept within the limits. */
export function moveSeat(offset, delta) {
  const clean = cleanSeatOffset(offset);
  return cleanSeatOffset(clean.map((v, i) => Math.round((v + (delta[i] ?? 0)) * 1000) / 1000));
}

/** The eye point with the player's offset applied, body feet. */
export function seatEye(base, offset) {
  const o = cleanSeatOffset(offset);
  return [base[0] + o[0], base[1] + o[1], base[2] + o[2]];
}
