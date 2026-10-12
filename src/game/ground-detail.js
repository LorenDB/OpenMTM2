/*
  The ground's fine detail, for "Ground detail" (docs/VISUALS.md, "Ground"). The game's ground
  textures are 64 texels across a 32 ft cell: half a foot a texel, which a camera a few yards
  off shows as a blur. The port lays a grain over them, of its own making, at the scales the
  textures cannot hold. How much grain a piece of ground takes follows what it is made of,
  which the game says: the `.TTY` type of the cell's texture (MTM2_PHYSICS.md 2.3).

  Pure, so it runs under Node.
*/

/** The `.TTY` types (MTM2_PHYSICS.md 2.3): a texture's value is `type * 100 + depth`. */
const CEMENT = 1, DIRT = 2, WATER = 3, MUD = 4, SAND = 5, GRASS = 6, GRAVEL = 7, ICE = 8, SNOW = 9, METAL = 10, WOOD = 11, ROCKS = 12, DEEP_WATER = 13;

/** How much of the grain each ground type takes, 0 to 1. What has no type of its own is Default, which the stock tracks use for bare ground. */
const SHARES = Object.freeze({
  [ROCKS]: 1, [DIRT]: 0.85, [GRAVEL]: 0.85, [GRASS]: 0.7, [MUD]: 0.6, [SAND]: 0.5,
  [SNOW]: 0.3, [ICE]: 0.3, [CEMENT]: 0.3, [METAL]: 0.2, [WOOD]: 0.25, [WATER]: 0, [DEEP_WATER]: 0,
});
export const DEFAULT_GRAIN_SHARE = 0.85;

/** The share of the grain a texture takes, from its `.TTY` value. */
export function grainShare(textureValue) {
  const type = Math.floor((Number(textureValue) || 0) / 100);
  return SHARES[type] ?? DEFAULT_GRAIN_SHARE;
}

/**
 * The grain's two scales: how wide one repeat of the noise lies on the ground, feet, and the
 * distances between which each fades out. The fine one is clods and grit a hand across, gone
 * by the time a pixel is wider than they are; the coarse one is lumps a few feet across.
 */
export const GRAIN = Object.freeze({
  fine: Object.freeze({ repeatFt: 8192 / 1170, fadeFromFt: 40, fadeToFt: 170 }),
  coarse: Object.freeze({ repeatFt: 8192 / 190, fadeFromFt: 300, fadeToFt: 1100 }),
});

/**
 * How steep a face must be to count as a cliff, as the height of its unit normal: all ground
 * above `level`, all cliff below `cliff`. On a cliff the cell's texture is seen edge on and
 * smears down the face, so there it gives its colour only and the grain gives the structure.
 */
export const CLIFF_NORMAL = Object.freeze({ level: 0.82, cliff: 0.5 });

/**
 * Broad patches that break up a texture repeated to the horizon: how wide they lie, feet (they
 * repeat with the world), and how far they move the ground's brightness either way. Between
 * `farFromFt` and `farToFt` a tile gives up `farFlat` of its own picture for its mean colour,
 * since far off that picture is what shows the tile repeating, and the patches grow to twice
 * as strong.
 */
export const PATCHES = Object.freeze({ broadFt: 8192 / 4, mediumFt: 8192 / 13, smallFt: 8192 / 47, amount: 0.15, farFromFt: 500, farToFt: 2600, farFlat: 0.75 });
