/*
  A truck's body in the snow (docs/VISUALS.md, "Crashes in the snow"). The simulation seats a truck on
  the ground under the snow and knows nothing of the snow, so a truck that rolls over in it, lies on
  its roof or its side, or comes down on its nose has its body through the snow's surface. Where the
  body is, the snow is pushed out of its way: a hollow the shape of what went in, as deep as it went,
  with the snow it pushed heaped round it.

  The body is the simulation's own: its twelve hull points (MONSTER_EXE_ANALYSIS.md 10), the outline
  of a truck seen from the side, cab and all. What of it is under the snow is the part of their hull
  below the snow's surface, found from the points under the surface and from where the lines between
  those and the points over it cross the surface (`bodyInSnow`). That part, seen from above, is drawn
  as a hollow (render/tire-tracks.js): a rectangle round it with rounded corners (`scourShape`), a
  little larger, its edge ragged, its floor lumpy and as deep as the body went. So a truck on its roof
  leaves a hollow the size of its roof, a nose that digs in a small one, and one that sinks further a
  larger.

  While the body goes on through the snow, another is laid each `stepFt` it goes (`scourSteps`), each
  drawn into one surface with those before it as ruts are, so a truck that slides on its roof scours
  one long hollow as wide as its roof, deeper where it bore down harder, scored along the way it went.

  Pure, so it runs under Node.
*/

/**
 * A point of the body is in the snow `underFt` or more under its surface, where the snow lies `thinFt`
 * thick or more (the course's thin snow takes no hollow). The hollow is `marginFt` wider all round than
 * what went in, its corners rounded by at most `roundFt`, and the body packs the snow under it down to
 * `floorFt` over the ground at the most. The snow it pushes out is heaped in a rim `rim` of the hollow's
 * depth high and `rimFt` wide, in clumps, and `pile` times higher again ahead of a body that slides,
 * which pushes the snow before it (each hollow laid cuts the pile before it, so the pile is left where
 * the body stopped). Another hollow is laid each `stepFt` the body goes, `turnRad` it turns or
 * `deeperFt` it bores down, at most `mostSteps` in a frame; further than `jumpFt` in a frame is not a
 * drag (a truck put back on the course) but a new hollow.
 *
 * Every hollow is drawn into the snow (the ploughed snow's map), but over a drag only some are given
 * the lid through which the snow is seen (`scourLid`): one each `lidEvery` of a hollow's half length
 * along the way, and never closer than `lidLeastFt`, each reaching that far further ahead to cover the
 * hollows between it and the next. Lids over every one, laid so close, would each be seen through at
 * every point a dozen times over.
 */
export const SCOUR = Object.freeze({
  underFt: 0.1, thinFt: 0.2, marginFt: 0.5, roundFt: 1.5, floorFt: 0.04, rim: 0.45, rimFt: 1.8, pile: 1.4,
  stepFt: 0.75, turnRad: 0.12, deeperFt: 0.08, mostSteps: 40, jumpFt: 30, lidEvery: 0.8, lidLeastFt: 2,
});
/**
 * The hollows are kept in a ring of this many, as the tracks are (game/tire-effects.js `TRACK_POOL`): one lasts until
 * the ring comes round to it, filling in with snow over the oldest eighth.
 */
export const SCOUR_POOL = 8192;

/**
 * What of a body is in the snow. `points` are its hull points, game feet `[x, y, z]`; `snowAt(x, z, y)`
 * says of the snow at a place, under something at height y, `{ surfaceFt, thickFt }`: its surface's
 * height and how thick it lies there now. Returns `{ outline, depthFt, y }`: the outline in plan of the
 * part of the points' hull under the surface (`[x, z]` each), how far under the surface the deepest
 * point goes (no further than the snow is thick, less what it packs), and the height of the points in
 * it; or null where none of it is in the snow.
 */
export function bodyInSnow(points, snowAt) {
  const all = points.map((p) => {
    const snow = snowAt(p[0], p[2], p[1]);
    return { p, under: snow.surfaceFt - p[1], thick: snow.thickFt };
  });
  const inside = all.filter((u) => u.under >= SCOUR.underFt && u.thick >= SCOUR.thinFt);
  if (!inside.length) return null;
  const outline = inside.map((u) => [u.p[0], u.p[2]]);
  // Where the line from a point in the snow to one over its surface crosses the surface.
  for (const a of inside) {
    for (const b of all) {
      if (b.under > 0) continue;
      const t = a.under / (a.under - b.under);
      outline.push([a.p[0] + (b.p[0] - a.p[0]) * t, a.p[2] + (b.p[2] - a.p[2]) * t]);
    }
  }
  let depthFt = 0, y = 0;
  for (const a of inside) {
    depthFt = Math.max(depthFt, Math.min(a.under, a.thick - SCOUR.floorFt));
    y += a.p[1] / inside.length;
  }
  return depthFt > 0 ? { outline, depthFt, y } : null;
}

/** The convex hull of points `[x, z]` in plan, in order round it (the monotone chain). */
export function convexHull(points) {
  const sorted = points.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-12) lower.pop();
    lower.push(p);
  }
  for (const p of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-12) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * The hollow round an outline in plan (`bodyInSnow`), `depthFt` deep: the rectangle round it of least
 * area, `marginFt` larger all round. Returns `{ x, z, angle, halfLengthFt, halfWidthFt, depthFt }`: its
 * middle, the way of its length (radians from game +z toward +x), its half length and half width.
 */
export function scourShape(outline, depthFt) {
  const hull = convexHull(outline);
  let best = null;
  // The least rectangle round a convex outline lies along one of its sides.
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length], long = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(long > 1e-6)) continue;
    const ux = (b[0] - a[0]) / long, uz = (b[1] - a[1]) / long;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of hull) {
      const u = p[0] * ux + p[1] * uz, v = -p[0] * uz + p[1] * ux;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area - 1e-9) best = { area, ux, uz, u0, u1, v0, v1 };
  }
  if (!best) {
    const [x, z] = hull[0] ?? [0, 0];
    return { x, z, angle: 0, halfLengthFt: SCOUR.marginFt, halfWidthFt: SCOUR.marginFt, depthFt };
  }
  const { ux, uz, u0, u1, v0, v1 } = best, um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
  const shape = {
    x: um * ux - vm * uz, z: um * uz + vm * ux, angle: Math.atan2(ux, uz),
    halfLengthFt: (u1 - u0) / 2 + SCOUR.marginFt, halfWidthFt: (v1 - v0) / 2 + SCOUR.marginFt, depthFt,
  };
  // Its length the longer way.
  return shape.halfWidthFt > shape.halfLengthFt ? turned(shape, 1) : shape;
}

/** A hollow turned by `quarters` quarter turns: the same hollow, its length and width the other way round on an odd number. */
function turned(shape, quarters) {
  const odd = Math.abs(quarters) % 2 === 1;
  return {
    ...shape, angle: shape.angle + (quarters * Math.PI) / 2,
    halfLengthFt: odd ? shape.halfWidthFt : shape.halfLengthFt, halfWidthFt: odd ? shape.halfLengthFt : shape.halfWidthFt,
  };
}

/** `shape` as the same hollow turned the way nearest `last`'s, so that the one goes into the other without spinning. */
export function alignScour(shape, last) {
  return turned(shape, Math.round((last.angle - shape.angle) / (Math.PI / 2)));
}

/**
 * How far apart the lids over a drag are, feet, for hollows `halfLengthFt` long in half (`SCOUR.lidEvery`).
 */
export const scourLidFt = (halfLengthFt) => Math.max(SCOUR.lidLeastFt, SCOUR.lidEvery * halfLengthFt);

/**
 * Whether hollow `shape` (`scourSteps`) is given a lid, where the last lid of its drag was over `lastLid`
 * (`[x, z]`, or null): the first of a hollow always, and then one each `scourLidFt` along the way.
 */
export function scourLid(shape, lastLid) {
  return !shape.drag || !lastLid || Math.hypot(shape.x - lastLid[0], shape.z - lastLid[1]) >= scourLidFt(shape.halfLengthFt);
}

/**
 * The hollows to lay, each with the way the body went (`drag`, a unit `[x, z]`, or null), as the body
 * goes from hollow `last` (the last laid, or null where it has just gone in) to `next`: one at each
 * `stepFt` along the way, the hollow turning and deepening as it goes; none until it has gone a step,
 * turned or bored down.
 */
export function scourSteps(last, next) {
  if (!last) return [{ ...next, drag: null }];
  const to = alignScour(next, last);
  const dx = to.x - last.x, dz = to.z - last.z, moved = Math.hypot(dx, dz), turn = Math.abs(to.angle - last.angle);
  if (moved > SCOUR.jumpFt) return [{ ...next, drag: null }];
  if (moved < SCOUR.stepFt && turn < SCOUR.turnRad && to.depthFt < last.depthFt + SCOUR.deeperFt) return [];
  const steps = Math.min(SCOUR.mostSteps, Math.max(1, Math.ceil(Math.max(moved / SCOUR.stepFt, turn / SCOUR.turnRad))));
  const drag = moved > 0.05 ? [dx / moved, dz / moved] : null;
  const mix = (a, b, t) => a + (b - a) * t;
  return Array.from({ length: steps }, (_, k) => {
    const t = (k + 1) / steps;
    return {
      x: mix(last.x, to.x, t), z: mix(last.z, to.z, t), angle: mix(last.angle, to.angle, t),
      halfLengthFt: mix(last.halfLengthFt, to.halfLengthFt, t), halfWidthFt: mix(last.halfWidthFt, to.halfWidthFt, t),
      depthFt: mix(last.depthFt, to.depthFt, t), drag,
    };
  });
}
