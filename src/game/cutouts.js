/*
  Cut-out pictures (a tree, a fence, a truss): texels of one palette entry are see-through.
  Pure, so it runs under Node.
*/

/**
 * Give the see-through texels of a cut-out picture the colour of the picture beside them
 * (docs/VISUALS.md, "Light"). A cut-out's background is one palette entry, black as often as
 * not, and a filtered texture blends it into the picture's edge: a dark line round every
 * leaf. `passes` carry the picture's own colour that many texels out, which is as far as
 * filtering reaches. Only colours change: what is see-through stays so. The picture repeats,
 * so its edges are neighbours. In place.
 *
 * @param {{ rgba: Uint8Array, width: number, height: number }} image
 */
export function bleedCutout({ rgba, width, height }, passes = 3) {
  let solid = new Uint8Array(width * height);
  for (let i = 0; i < solid.length; i++) solid[i] = rgba[i * 4 + 3] >= 128 ? 1 : 0;
  for (let pass = 0; pass < passes; pass++) {
    const next = solid.slice();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = y * width + x;
        if (solid[at]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const o = ((y + dy + height) % height) * width + ((x + dx + width) % width);
            if (!solid[o]) continue;
            r += rgba[o * 4]; g += rgba[o * 4 + 1]; b += rgba[o * 4 + 2]; n++;
          }
        }
        if (!n) continue;
        rgba[at * 4] = Math.round(r / n); rgba[at * 4 + 1] = Math.round(g / n); rgba[at * 4 + 2] = Math.round(b / n);
        next[at] = 1;
      }
    }
    solid = next;
  }
}
