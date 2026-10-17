/*
  4x4 Evolution 2's visible suspension (docs/EVO2_EXE_ANALYSIS.md 6.4): what 4x42.exe draws between a monster truck's
  axles and its body. Pure, so it runs under Node. Positions are in body axes (x right, y up, z forward), feet.

  - The axle models (0x5d3ad0): the body model's AXLEF and AXLER groups are each recentred on their own box and scaled
    alike on every axis so that they span the axle's track (the right tire's x less the left's), 0.93 of it when the
    truck has an axle-bar texture; each is drawn at its axle's centre, rolled with it (0x5f6ec0, 0x5f7820).
  - Bars and shocks (0x5ff4d0, drawn by 0x600eb0 and 0x5ffc00), only for a truck with an axle-bar texture, which among
    the stock trucks is AMT.TRK alone (0x5ed4b0 gives it shock2.tif, axlebar2.tif, an axlebarOffset of (1.3, 0.1, 0.55)
    and a driveshaftPos of (0, 0.6, 0.55)):
      - `inner` is the right front tire's x less half its width, less half a foot;
      - per axle, two bars from the axle at (+-inner, -0.1) in its rolled frame, 0.31 ft toward the middle of the truck,
        to the body at (+-(axlebar x pulled 0.1 toward the middle), axlebar y + 0.05, axlebar z);
      - per tire, two shocks 0.2 ft either side of the axle, from the axle at (+-(inner + 0.22), 0.2) in its rolled frame
        straight up to the body at x +-(inner - 0.03), y 1.2 (front) or 1.7 (rear), plus 1.16 (front) or 0.66 (rear)
        when the low-detail body stands taller than 7.5 ft;
      - each is a flat strip, not one that turns to the eye: a bar of half-width 0.15 across in the x-y plane, a shock
        of half-width 0.13 in the x-z plane.
  The driveshaft model (0x601510) is not drawn: the stock install ships none for it.
*/

export const EVO_BAR_HALF_FT = 0.15, EVO_SHOCK_HALF_FT = 0.13;
/** The axle model's span against the track, with an axle-bar texture (0x65b1b0). */
export const EVO_BAR_AXLE_SPAN = 0.93;
/** AMT.TRK's own figures (0x5ed4b0). */
export const AMT_SUSPENSION = Object.freeze({
  shockTexture: "SHOCK2.TIF", barTexture: "AXLEBAR2.TIF",
  axlebar: Object.freeze({ x: 1.3, y: 0.1, z: 0.55 }), driveshaft: Object.freeze({ x: 0, y: 0.6, z: 0.55 }),
});

const rolled = (axle, x, y) => {
  const c = Math.cos(axle.articulation), s = Math.sin(axle.articulation);
  return [x * c - y * s, axle.travel + x * s + y * c];
};

/**
 * The parts at one moment. `axles` are `{ z, travel, articulation }` front then rear; `inner` as above; `axlebar` the
 * offset; `tall` whether the body stands over 7.5 ft. Returns `{ bars: [[from, to]], shocks: [[from, to]] }`.
 */
export function evoSuspensionParts({ axles, inner, axlebar, tall }) {
  const barX = axlebar.x > 0 ? axlebar.x - 0.1 : axlebar.x + 0.1;
  const bars = [], shocks = [];
  axles.forEach((axle, k) => {
    const front = k === 0;
    const toward = front ? -0.31 : 0.31;
    const top = (front ? 1.2 : 1.7) + (tall ? (front ? 1.16 : 0.66) : 0);
    for (const side of [1, -1]) {
      const [x, y] = rolled(axle, side * inner, -0.1);
      bars.push([[x, y, axle.z + toward], [side * barX, axlebar.y + 0.05, axlebar.z]]);
      const [fx, fy] = rolled(axle, side * (inner + 0.22), 0.2);
      for (const end of [1, -1]) shocks.push([[fx, fy, axle.z + end * 0.2], [side * (inner - 0.03), top, axle.z + end * 0.2]]);
    }
  });
  return { bars, shocks };
}

/**
 * The corners of a flat strip between `a` and `b` (0x5ffc00): half-width `half` across the strip within the x-y plane
 * (`plane` "xy") or the x-z plane ("xz"), `[a + side, a - side, b - side, b + side]`.
 */
export function stripCorners(a, b, half, plane) {
  const dx = b[0] - a[0], d2 = plane === "xy" ? b[1] - a[1] : b[2] - a[2];
  const length = Math.hypot(dx, d2);
  const k = length > 1e-9 ? half / length : 0;
  const side = plane === "xy" ? [-d2 * k, dx * k, 0] : [d2 * k, 0, -dx * k];
  if (!k) side[plane === "xy" ? 0 : 2] = half;
  const plus = (p) => [p[0] + side[0], p[1] + side[1], p[2] + side[2]];
  const minus = (p) => [p[0] - side[0], p[1] - side[1], p[2] - side[2]];
  return [plus(a), minus(a), minus(b), plus(b)];
}
