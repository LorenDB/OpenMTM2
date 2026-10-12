/*
  The ice of Snow, for "Reflective water" (docs/VISUALS.md, "Water"). The game makes the water
  solid in Snow and draws it under an overlay of grey noise (MONSTER_EXE_ANALYSIS.md section 13);
  how the ice looks is the port's. Here are its measures, and the marks the trucks leave in it:
  stars where a truck came down hard, cracks running out from the blow like the spokes of a
  wheel, and bands scored white where a truck's body was dragged over it.

  Nothing here changes what a truck drives on: the ice is as solid after a blow as before.

  Pure, so it runs under Node.
*/

/**
 * The ice's own cracks, three fields of them one over another, none of them even:
 *  - long cracks, the edges of floes some `floeFt` across, `floesKept` of them showing, so a crack runs on past where
 *    the floes meet, or ends there;
 *  - plates some `plateFt` across, `platesKept[0]` of the cracks between them showing where the ice is whole and
 *    `platesKept[1]` where it is broken up, the two in patches some `patchFt` across;
 *  - hairlines some `hairlineFt` apart, `hairlinesKept` of them, in patches of their own.
 * The cells of each field are pushed about by up to `warp` of their width, so that no two plates are of a size or a
 * shape, and a crack between two that is not shown joins them in one. Each crack is its own: as wide, as deep and as
 * bright as up to `vary` either side of its field's own measure.
 *
 * A crack runs `crackDepthFt` down into the ice (a floe's `floeDepthFt`, a hairline `hairlineDepthFt`), and what lies a
 * foot down is seen `bend` of a foot aside for every foot the eye's line runs along for each it runs down (ice bends it
 * nearer the upright than air does). The eye's line is taken as running down no less than `flattest` of its length, so
 * nothing in the ice is seen further aside than `bend / flattest` of its depth.
 *
 * Every crack, the ice's own and a mark's, is drawn the same way (`crackPlane`): a line where it meets the surface,
 * and under it the crack's own face, a plane running straight down, seen through the ice where the eye's line meets it.
 * Looked at straight down, or along it, a crack is a line; looked at across, its face is a band as wide as the ice
 * bends the eye's line over its depth.
 */
export const ICE = Object.freeze({
  plateFt: 13, hairlineFt: 4.2, floeFt: 70, crackDepthFt: 0.9, hairlineDepthFt: 0.25, floeDepthFt: 1.6, bend: 0.75, flattest: 0.3,
  floesKept: 0.7, platesKept: Object.freeze([0.3, 0.9]), hairlinesKept: 0.55, patchFt: 240, warp: 0.45, vary: 0.5,
});

/**
 * What something over ground at height `floorFt` stands on, feet: in Snow (`weather` 5) the level's water is ice, solid
 * at its level `levelFt` (MTM2_PHYSICS.md 2.1), so over ground under that level it stands on the ice; else on the ground.
 * A tire's rut, the shade under a truck and a replay's wheels go by it.
 */
export const standOnFt = (floorFt, weather, levelFt) => (weather === 5 && levelFt !== null && levelFt !== undefined && floorFt < levelFt ? levelFt : floorFt);

/**
 * Where the eye's line meets a crack's face, feet down into the ice, or null where it does not:
 * the point is `awayFt` from the crack's line on the surface, the eye's line closes on that line
 * by `closingFt` for each foot it runs down (less than nothing: it draws away), and the crack
 * runs `depthFt` down.
 */
export function crackPlane(awayFt, closingFt, depthFt) {
  if (!(closingFt > 1e-3)) return awayFt <= 0 ? 0 : null;
  const down = Math.max(0, awayFt) / closingFt;
  return down <= depthFt ? down : null;
}

/**
 * Stars. A blow slower than `minSpeedFtPerS` leaves none; at that speed its cracks reach `minReachFt`, and `maxReachFt`
 * from `fullSpeedFtPerS`. They run out over a few times `runSeconds` (which is the time they take to cover all but 1/e
 * of the way). A blow within `joinFt` of a star widens that star instead of making another. A star has `spokes` to
 * `spokes + spokesMore - 1` cracks, and its middle is crushed white out to `crushed` of its reach.
 *
 * How it breaks, no two alike: each crack leaves the blow up to `spread` of the gap between two cracks either side of
 * where an even star would have it, and reaches from `shortest` of the star's reach to all of it; and the star is
 * lopsided, its cracks on one side of it reaching up to `lopsided` less far than on the other. Each runs out in three
 * straight pieces of uneven lengths, turning by up to `kink` radians where one meets the next, ragged by up to
 * `raggedFt` either side along its length, and `forks` of them fork once. Two rings of cracks join the spokes, at
 * about `rings` of the reach, each join at its own distance, up to `ringsVary` of that nearer or further; each gap
 * between two spokes is joined across on a ring by a straight crack, from one to the other, `joins` of the time. A
 * fresh crack runs `deepFt` down into the ice. The pieces the cracks cut are tipped, each its own way, by up to
 * `tiltRad`, so each throws the sky back a little differently; and water wells up dark round the crushed middle, out
 * to `wet` times its width.
 */
export const ICE_STARS = Object.freeze({
  minSpeedFtPerS: 7, fullSpeedFtPerS: 45, minReachFt: 3.5, maxReachFt: 20, runSeconds: 0.22, joinFt: 2.5,
  spokes: 7, spokesMore: 5, crushed: 0.14,
  spread: 0.42, shortest: 0.3, lopsided: 0.4,
  kink: 0.24, raggedFt: 0.07, forks: 0.6, rings: Object.freeze([0.3, 0.6]), ringsVary: 0.45, joins: 0.55, deepFt: 1.2, tiltRad: 0.045, wet: 2.4,
});

/** How far the cracks of a blow at `speedFtPerS` (the speed it came down at) reach, feet; 0 for one too light to crack the ice. */
export function starReachFt(speedFtPerS) {
  const { minSpeedFtPerS: slow, fullSpeedFtPerS: fast, minReachFt, maxReachFt } = ICE_STARS;
  if (!(speedFtPerS >= slow)) return 0;
  const t = Math.min(1, (speedFtPerS - slow) / (fast - slow));
  return minReachFt + (maxReachFt - minReachFt) * t * t * (3 - 2 * t);
}

/**
 * A truck's body dragged over the ice scores it: a band as wide as what of the body is down on the ice, across the way
 * it goes (`marginFt` more either side of the outermost point down, and from `leastHalfFt` to `mostHalfFt` either side
 * of its middle), white with fine scratches along the way it went, and swept clear of snow. It is laid a piece at a time
 * as the body goes, one when its middle has gone `stepFt`; while it goes straight (each place it has passed within
 * `trueFt` of the line) the piece is drawn on instead, up to `longestFt`. A jump of more than `breakFt` begins it again.
 *
 * Off the band's edges, one place every `spurEveryFt` along it may have a short crack (`spurs` of them do): it runs
 * out and back from the band, from `spurAngle[0]` to `spurAngle[1]` radians off the way the body came, `spurFt[0]` to
 * `spurFt[1]` long, turning once on the way, and `spurDeepFt` down.
 */
export const ICE_SCRAPES = Object.freeze({
  leastHalfFt: 0.6, mostHalfFt: 5, marginFt: 0.3, stepFt: 1.5, trueFt: 0.4, longestFt: 16, breakFt: 10,
  spurEveryFt: 3.5, spurs: 0.45, spurAngle: Object.freeze([0.7, 1.25]), spurFt: Object.freeze([0.7, 2.6]), spurDeepFt: 0.8,
});

/**
 * A point of a truck's hull is down on the ice when it is within `downFt` of it. One that comes down on it strikes it
 * at the speed it came down at, as a wheel does, and stars it by that (`starReachFt`); one that stays down while the
 * truck moves drags over it (`ICE_SCRAPES`).
 */
export const ICE_HULL = Object.freeze({ downFt: 0.4 });

/**
 * Where the marks are kept. The ice keeps `kept` of them, stars and the pieces of scored bands alike, for good: when it
 * holds all it can, the oldest makes way. For the graphics card the ice is cut in cells `cellFt` across, `cells` by
 * `cells` of them laid over the world again and again (two places `cells * cellFt` apart share a cell), and each cell
 * lists the marks that reach into it, oldest first: at most `perCell`, so a mark that would be one more makes the oldest
 * there make way. A point of the ice looks only at its own cell's list, so the ice costs the same to draw however many
 * marks it holds. The marks go to the graphics card `perRow` to a row.
 */
export const ICE_MARKS = Object.freeze({ kept: 1024, cellFt: 32, cells: 64, perCell: 16, perRow: 64 });

/**
 * How far from its line on the surface a mark's crack `depthFt` deep can be seen, feet: its face is seen as far aside
 * as the ice bends the eye's line over its depth, and a line is no thinner than a pixel.
 */
export const seenAsideFt = (depthFt) => (depthFt * ICE.bend) / ICE.flattest + 0.2;

/** How far a mark reaches from its line, feet, cracks and all: a star from its middle, a scored band from its middle line. */
export const markReachFt = (mark) => (mark.kind === "star"
  ? mark.fullFt + seenAsideFt(ICE_STARS.deepFt)
  : mark.halfFt + ICE_SCRAPES.spurFt[1] + seenAsideFt(ICE_SCRAPES.spurDeepFt));

/**
 * How far the straight line from (ax, az) to (bx, bz) comes to the square from (x0, z0) to (x1, z1), feet: 0 where it
 * runs into it. Out of it, the nearest two are an end of one to the other.
 */
export function lineToCellFt(ax, az, bx, bz, x0, z0, x1, z1) {
  const dx = bx - ax, dz = bz - az;
  // The part of the line inside the square, if there is one (clipped edge by edge).
  let t0 = 0, t1 = 1, inside = true;
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dz, az - z0], [dz, z1 - az]]) {
    if (p === 0) { if (q < 0) inside = false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) inside = false; else t0 = Math.max(t0, r); } else if (r < t0) inside = false; else t1 = Math.min(t1, r);
  }
  if (inside && t0 <= t1) return 0;
  const toSquare = (px, pz) => Math.hypot(Math.max(x0 - px, 0, px - x1), Math.max(z0 - pz, 0, pz - z1));
  const long2 = dx * dx + dz * dz;
  const toLine = (px, pz) => {
    const t = long2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / long2)) : 0;
    return Math.hypot(px - ax - dx * t, pz - az - dz * t);
  };
  return Math.min(toSquare(ax, az), toSquare(bx, bz), toLine(x0, z0), toLine(x1, z0), toLine(x0, z1), toLine(x1, z1));
}

/**
 * One frame of a truck's hull over the ice. `hull` is where each of its points is, game `[x, y, z]` (null for one it
 * lacks); `levelFt` the ice's level; `overIce(x, z, y)` whether the ground under a point lies under the ice; `last` the
 * truck's own map from frame to frame, which is updated; `dt` the frame's length in seconds. Returns `blows`, a point
 * that came down on the ice this frame, `{ x, z, speedFtPerS }` each, and `down`, every point down on it now, `[x, z]`
 * each. A frame of no length changes nothing.
 */
export function iceHullContacts({ hull, levelFt, overIce, last, dt }) {
  const blows = [], down = [];
  if (!(dt > 0)) return { blows, down };
  hull.forEach((at, k) => {
    if (!at) return;
    const over = at[1] - levelFt, before = last.get(k);
    const fall = before ? (before.over - over) / dt : 0;
    if (over > ICE_HULL.downFt || !overIce(at[0], at[2], at[1])) {
      last.set(k, { over, fall: Math.max(0, fall) });
      return;
    }
    last.set(k, { over, fall: 0 });
    // It came down this frame: as fast as it was coming down, or as it came the rest of the way.
    if (before && before.over > ICE_HULL.downFt) blows.push({ x: at[0], z: at[2], speedFtPerS: Math.max(before.fall, fall) });
    down.push([at[0], at[2]]);
  });
  return { blows, down };
}

/**
 * The marks in a sheet of ice, and the two lists the graphics card draws them from (`ICE_MARKS`):
 *  - `marks`, eight numbers for each place: a star's middle (game x, z), how far its cracks have run by now (feet) and
 *    its own number, then 0, how far they will run, 0, 0; a piece of a scored band's two ends (x, z, x, z), then 1,
 *    how wide it is either side of its middle, the band's own number and how far along the band the piece begins (feet).
 *    A place with no mark is all naught.
 *  - `grid`, `perCell` numbers for each cell, the cells a row of `cells` at a time: the places of the marks that reach
 *    into it, oldest first, then -1.
 */
export function createIceMarks() {
  const { kept, cellFt, cells, perCell } = ICE_MARKS;
  const marks = new Float32Array(kept * 8);
  const grid = new Float32Array(cells * cells * perCell).fill(-1);
  /** Each place's mark or null: `{ kind, born, cells, ... }`, a star with `x, z, fromFt, fullFt, age, seed`, a piece with `from, to, halfFt, seed, startFt`. */
  const slots = new Array(kept).fill(null);
  /** Each cell's list of places, oldest first. */
  const lists = Array.from({ length: cells * cells }, () => []);
  let born = 0, marksChanged = true, gridChanged = true;
  const reachOf = (star) => (star.age >= ICE_STARS.runSeconds * 12 ? star.fullFt
    : star.fromFt + (star.fullFt - star.fromFt) * (1 - Math.exp(-star.age / ICE_STARS.runSeconds)));
  const cellIndex = (x, z) => (Math.floor(z / cellFt) & (cells - 1)) * cells + (Math.floor(x / cellFt) & (cells - 1));

  /** The cells a mark reaches into: within its reach of a star's middle, or of a piece's line. */
  function cellsOf(mark) {
    const reach = markReachFt(mark), out = new Set();
    const [ax, az] = mark.kind === "star" ? [mark.x, mark.z] : mark.from, [bx, bz] = mark.kind === "star" ? [mark.x, mark.z] : mark.to;
    for (let cz = Math.floor((Math.min(az, bz) - reach) / cellFt); cz <= Math.floor((Math.max(az, bz) + reach) / cellFt); cz++) {
      for (let cx = Math.floor((Math.min(ax, bx) - reach) / cellFt); cx <= Math.floor((Math.max(ax, bx) + reach) / cellFt); cx++) {
        if (lineToCellFt(ax, az, bx, bz, cx * cellFt, cz * cellFt, (cx + 1) * cellFt, (cz + 1) * cellFt) <= reach) {
          out.add((cz & (cells - 1)) * cells + (cx & (cells - 1)));
        }
      }
    }
    return [...out];
  }
  function writeCell(c) {
    const list = lists[c];
    for (let k = 0; k < perCell; k++) grid[c * perCell + k] = k < list.length ? list[k] : -1;
    gridChanged = true;
  }
  function writeMark(slot) {
    const mark = slots[slot], o = slot * 8;
    if (!mark) marks.fill(0, o, o + 8);
    else if (mark.kind === "star") marks.set([mark.x, mark.z, reachOf(mark), mark.seed, 0, mark.fullFt, 0, 0], o);
    else marks.set([mark.from[0], mark.from[1], mark.to[0], mark.to[1], 1, mark.halfFt, mark.seed, mark.startFt], o);
    marksChanged = true;
  }
  function unlist(slot) {
    for (const c of slots[slot].cells) {
      const list = lists[c];
      list.splice(list.indexOf(slot), 1);
      writeCell(c);
    }
    slots[slot].cells = [];
  }
  function remove(slot) {
    unlist(slot);
    slots[slot] = null;
    writeMark(slot);
  }
  /** List the mark at `slot` in every cell it reaches into, oldest first; where a cell is full, the oldest there (never this one) makes way. */
  function list(slot) {
    const mark = slots[slot];
    mark.cells = cellsOf(mark);
    for (const c of mark.cells) {
      while (lists[c].length >= perCell) remove(lists[c].find((other) => other !== slot));
    }
    for (const c of mark.cells) {
      const list = lists[c];
      let at = list.length;
      while (at > 0 && slots[list[at - 1]].born > mark.born) at--;
      list.splice(at, 0, slot);
      writeCell(c);
    }
    writeMark(slot);
  }
  /** A place for a new mark: a free one, or the oldest's. */
  function place() {
    const free = slots.indexOf(null);
    if (free >= 0) return free;
    let oldest = 0;
    for (let i = 1; i < kept; i++) if (slots[i].born < slots[oldest].born) oldest = i;
    remove(oldest);
    return oldest;
  }
  function add(mark) {
    const slot = place();
    slots[slot] = { ...mark, born: born++, cells: [] };
    list(slot);
    return slot;
  }
  /** Change the mark at `slot`, which may reach into other cells after. */
  function change(slot, changes) {
    unlist(slot);
    Object.assign(slots[slot], changes);
    list(slot);
  }

  return {
    marks, grid,
    /**
     * A blow at game (x, z) coming down at `speedFtPerS`; `seed` (0 to 1) is the star's own number, which decides how
     * its cracks lie. Returns how far its cracks will reach, feet.
     */
    strike(x, z, speedFtPerS, seed = Math.random()) {
      const reach = starReachFt(speedFtPerS);
      if (!reach) return 0;
      // Every star near enough to join reaches into the cell the blow is in.
      const near = lists[cellIndex(x, z)].find((slot) => slots[slot].kind === "star" && Math.hypot(slots[slot].x - x, slots[slot].z - z) < ICE_STARS.joinFt);
      if (near !== undefined) {
        // The star that is there runs further, from where it has got to; a lighter blow leaves it as it is.
        const star = slots[near];
        if (reach > star.fullFt) change(near, { fromFt: reachOf(star), fullFt: reach, age: 0 });
        return star.fullFt;
      }
      add({ kind: "star", x, z, fromFt: 0, fullFt: reach, age: 0, seed });
      return reach;
    },
    /**
     * A body dragged over the ice: `points` are those of it down on the ice this frame, game `[x, z]` each, and `chain`
     * the body's own (an object, `{}` to begin), which keeps where its band has got to. `seed` (0 to 1) is a new band's
     * own number. With no points, the band ends (`lift`).
     */
    drag(chain, points, seed = Math.random()) {
      if (!points.length) { this.lift(chain); return; }
      const { stepFt, breakFt, marginFt, leastHalfFt, mostHalfFt, longestFt, trueFt } = ICE_SCRAPES;
      let mx = 0, mz = 0;
      for (const [x, z] of points) { mx += x / points.length; mz += z / points.length; }
      if (!chain.last) { Object.assign(chain, { last: [mx, mz], open: null, seed, along: 0 }); return; }
      const dx = mx - chain.last[0], dz = mz - chain.last[1], step = Math.hypot(dx, dz);
      if (step > breakFt) { Object.assign(chain, { last: [mx, mz], open: null, seed, along: 0 }); return; }
      if (step < stepFt) return;
      // Across the way it went: the band is as wide as the points down reach, and its middle is between the outermost.
      const ax = -dz / step, az = dx / step;
      let least = Infinity, most = -Infinity;
      for (const [x, z] of points) {
        const across = (x - mx) * ax + (z - mz) * az;
        least = Math.min(least, across);
        most = Math.max(most, across);
      }
      const shift = (least + most) / 2, half = Math.min(mostHalfFt, Math.max(leastHalfFt, (most - least) / 2 + marginFt));
      const to = [mx + ax * shift, mz + az * shift];
      // The piece being laid is drawn on while it goes straight, if it is still there.
      const open = chain.open && slots[chain.open.slot]?.born === chain.open.born ? chain.open : null;
      if (open) {
        const from = slots[open.slot].from, long = Math.hypot(to[0] - from[0], to[1] - from[1]);
        const passed = [...open.passed, slots[open.slot].to];
        const straight = long <= longestFt && passed.every(([px, pz]) => {
          const t = Math.min(1, Math.max(0, ((px - from[0]) * (to[0] - from[0]) + (pz - from[1]) * (to[1] - from[1])) / (long * long)));
          return Math.hypot(px - from[0] - (to[0] - from[0]) * t, pz - from[1] - (to[1] - from[1]) * t) <= trueFt;
        });
        if (straight) {
          open.passed = passed;
          change(open.slot, { to, halfFt: Math.max(slots[open.slot].halfFt, half) });
          chain.last = to;
          return;
        }
      }
      const from = open ? slots[open.slot].to : chain.last;
      if (open) chain.along += Math.hypot(from[0] - slots[open.slot].from[0], from[1] - slots[open.slot].from[1]);
      const slot = add({ kind: "scrape", from: [from[0], from[1]], to, halfFt: half, seed: chain.seed, startFt: chain.along });
      chain.open = { slot, born: slots[slot].born, passed: [] };
      chain.last = to;
    },
    /** The body of `chain` left the ice: its band ends here. */
    lift(chain) { Object.assign(chain, { last: null, open: null }); },
    /**
     * `dt` seconds on: the stars' cracks run out. Returns `{ marks, grid }`: whether each list has changed since the
     * last time.
     */
    update(dt) {
      if (dt > 0) {
        slots.forEach((mark, slot) => {
          if (mark?.kind !== "star" || mark.age >= ICE_STARS.runSeconds * 12) return;
          mark.age += dt;
          writeMark(slot);
        });
      }
      const changed = { marks: marksChanged, grid: gridChanged };
      marksChanged = gridChanged = false;
      return changed;
    },
    /** The ice is new (a thaw, or a race beginning): no marks. */
    clear() {
      slots.fill(null);
      for (const list of lists) list.length = 0;
      marks.fill(0);
      grid.fill(-1);
      marksChanged = gridChanged = true;
    },
    /** The marks, oldest first: `{ slot, kind, ... }`, a star with its `reachFt` now. */
    list() {
      return slots.map((mark, slot) => mark && { ...mark, slot, reachFt: mark.kind === "star" ? reachOf(mark) : undefined, cells: undefined })
        .filter(Boolean).sort((a, b) => a.born - b.born);
    },
    /** The places of the marks the cell at game (x, z) lists, oldest first. */
    listedAt(x, z) {
      const c = cellIndex(x, z);
      const out = [];
      for (let k = 0; k < perCell && grid[c * perCell + k] >= 0; k++) out.push(grid[c * perCell + k]);
      return out;
    },
    get count() { return slots.reduce((n, mark) => n + (mark ? 1 : 0), 0); },
  };
}
