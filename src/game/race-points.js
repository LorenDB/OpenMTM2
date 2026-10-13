/*
  The points a race gives (MONSTER_EXE_ANALYSIS.md 6.6, `0x4192c0`): a base for the place, 900, 700, 500, 400,
  300, 200, 150 and 100, and in a race of more than one lap 100 more for the one fastest lap (a tie gives none)
  and a share of 100 for the laps led: `floor(100 / laps)` for every lap the truck finished in first place (the
  game's `bonusLaps`, truck `+0x900`), or the full 100 when it led them all (MTM1_MONSTER_EXE_ANALYSIS.md 6.4 and 8).
  A single lap race has the base only. A row without a `led` count (an old replay's) is read as the winner having
  led one lap.
*/
export const PLACE_POINTS = Object.freeze([900, 700, 500, 400, 300, 200, 150, 100]);

/**
 * The points for each row, `rows[i] = { place, best, led, ... }` (`best` the fastest lap in seconds, 0 for none; `led`
 * the laps finished in first place). Returns a list in row order.
 */
export function racePoints(rows, laps) {
  const times = rows.map((r) => (r.best > 0 ? r.best : Infinity));
  const fastest = Math.min(...times);
  const fastestCount = times.filter((t) => t === fastest).length;
  return rows.map((row, i) => {
    let points = PLACE_POINTS[row.place - 1] ?? 0;
    if (laps > 1) {
      if (Number.isFinite(fastest) && fastestCount === 1 && times[i] === fastest) points += 100;
      const led = row.led ?? (row.place === 1 ? 1 : 0);
      points += led >= laps ? 100 : Math.floor(100 / laps) * Math.max(0, led);
    }
    return points;
  });
}
