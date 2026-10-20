/*
  The tops of the level's ground boxes as ground (MTM2_PHYSICS.md 2.5 and 14.18). Some tracks build
  the course over a gully on ground boxes: Sidewinder Canyon's bridges are ground boxes with no
  textures of their own. A truck on one stands on its top, a deck, and what it leaves and throws
  belongs there, not on the terrain under the bridge.

  Whether a thing stands on a deck is the game's own rule (`groundBoxHeight`): the cell under it has a
  ground box whose underside is below the thing. So a wheel on the bridge is on the deck, and one in
  the gully under it is on the terrain.

  Pure, so it runs under Node.
*/
import * as mtm2Sim from "../vendor/openphotex/sim/mtm2/index.js";

/**
 * The decks of a level, or null for one without ground boxes. `ra0` and `ra1` are its lower and upper
 * ground-box heights, `heights` its terrain (the simulation's).
 */
export function createDecks({ heights, ra0, ra1 }) {
  if (!heights || !ra0 || !ra1 || !ra0.some((lower, i) => lower !== ra1[i])) return null;
  const terrain = mtm2Sim.createTerrain(heights);
  return {
    /**
     * The top of the ground box that something at game (x, y, z) stands on, feet, or null where it
     * stands on the terrain: no box in the cell, or the thing below the box's underside.
     */
    topAt(x, z, y) {
      if (!(y > -Infinity)) return null;
      const h = mtm2Sim.groundBoxHeightAt(terrain, ra0, ra1, x, z, y);
      return h === mtm2Sim.groundHeightAt(terrain, x, z) ? null : h;
    },
  };
}
