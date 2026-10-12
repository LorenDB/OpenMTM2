/*
  What a replay does not record, read off the picture (docs/VISUALS.md, "In a replay"). The
  game's replay keeps where each truck was, how it lay and how its wheels were turned
  (game/replay.js); it keeps nothing of which wheels were on the ground or of what the hull
  struck. Dust, tracks and sparks need both, so in a replay they are taken from where the drawn
  truck is against the drawn ground.

  Pure, so it runs under Node.
*/

/** A wheel is on the ground when its tread is within this of it, feet. */
export const ON_GROUND_FT = 0.35;
/** A hull point is down on the ground when it is within this of it, feet; and it struck it when it came down this fast, ft/s. */
export const HULL_DOWN_FT = 0.25, HULL_STRIKE_FT_PER_S = 8;
/** A hull has twelve points (MONSTER_EXE_ANALYSIS.md 10). */
const ZONES = 12;

/**
 * The hull contacts of one truck for a frame of film, as the simulation would report them
 * (`{ zone, steps, force }`, steps of a sixtieth of a second): a zone whose point is down on
 * the ground. One that came down hard this frame has the force of a hard hit, by how fast.
 *
 * @param {{ hull: (zone: number) => number[]|null, ground: (x: number, z: number, y: number) => number,
 *   last: Map<number, number>, dt: number }} truck
 *   `hull(zone)` is where hull point `zone` (1 to 12) is in the world, game feet; `ground` what a
 *   point at game (x, y, z) stands over (on a bridge's deck, the deck); `last` this
 *   truck's own map from frame to frame (how high each point was), which is updated; `dt` the
 *   frame's length in seconds of film.
 */
export function replayContacts({ hull, ground, last, dt }) {
  const out = [];
  for (let zone = 1; zone <= ZONES; zone++) {
    const at = hull(zone);
    if (!at) continue;
    const over = at[1] - ground(at[0], at[2], at[1]);
    const before = last.get(zone);
    last.set(zone, over);
    if (over > HULL_DOWN_FT) continue;
    // How fast it came down on the ground, if it was off it a frame ago.
    const fall = before !== undefined && before > HULL_DOWN_FT && dt > 0 ? (before - over) / dt : 0;
    out.push({ zone, steps: Math.max(1, Math.round(dt * 60)), force: fall >= HULL_STRIKE_FT_PER_S ? fall * 60 : 0 });
  }
  return out;
}
