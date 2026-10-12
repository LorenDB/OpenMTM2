/*
  The asset worker's maps of the ground (game/ground-maps.js) as textures for the port's own
  scenery: the water reads its depth from the ground map, the rain and the snow where to stop
  (at the ground, or at what stands over it), and the ground itself where its puddles lie and
  where it is under cover.

  Both cover the whole world once and repeat with it; a point's place in them is its game x and
  z over the world's width, so a shader in scene axes reads at (x, -z) / 8192.
*/
import * as THREE from "three";

/**
 * The drawn ground's height as a texture of half floats, which filter smoothly and need no
 * extension. Heights are kept against `referenceFt` (the water level where there is water), so
 * that they are finest where the shore is: a half float steps by a thousandth of a foot near
 * zero and by a quarter foot only some hundreds of feet from it. With `cover` (the cover map,
 * the same samples) the texture has a second number a sample: the height of the highest thing
 * that stands over the ground there, kept the same way, far below the ground where nothing does.
 *
 * @returns {{ texture: THREE.DataTexture, referenceFt: number, hasCover: boolean }|null}
 */
export function createGroundTexture(groundMap, referenceFt = 0, cover = null) {
  if (!groundMap) return null;
  const { side, heights } = groundMap;
  const tops = cover?.side === side ? cover.top : null, each = tops ? 2 : 1;
  const data = new Uint16Array(side * side * each);
  for (let i = 0; i < side * side; i++) {
    data[i * each] = THREE.DataUtils.toHalfFloat(heights[i] - referenceFt);
    if (tops) data[i * each + 1] = THREE.DataUtils.toHalfFloat(Math.max(-60000, tops[i] - referenceFt));
  }
  const texture = new THREE.DataTexture(data, side, side, tops ? THREE.RGFormat : THREE.RedFormat, THREE.HalfFloatType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, referenceFt, hasCover: !!tops };
}

/** Where the ground lies under cover (game/ground-maps.js `buildShelterMap`): one byte a sample, 255 under cover. */
export function createShelterTexture(cover) {
  if (!cover?.shelter) return null;
  const texture = new THREE.DataTexture(cover.shelter, cover.side, cover.side, THREE.RedFormat, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Where rain stands (game/ground-maps.js `buildPuddleMap`): one byte a sample, the waterline at 128 / 255. */
export function createPuddleTexture(puddles) {
  if (!puddles) return null;
  const texture = new THREE.DataTexture(puddles.depth, puddles.side, puddles.side, THREE.RedFormat, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
