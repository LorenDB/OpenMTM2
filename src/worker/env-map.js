/*
  The texture MTM2 mirrors on a truck's body with "Truck reflections" (MONSTER_EXE_ANALYSIS.md "Reflections"):
  ART\CLOUDENV.RAW, 256 x 256, in its own palette (CLOUDENV.ACT). In Rain, Dusk and Night the game turns each index i
  into (i >> 4) - 26, one of the sixteen sky colours at palette entries 230 to 245 (0x522ee0): the colours of that
  weather's sky, entries 192 to 207 of its .ACT, as the sky itself takes them (worker/track-build.js `loadSky`).
*/
import { decodeActPalette, decodeRawTexture } from "../vendor/openphotex/index.js";

/** The weathers whose sky the body mirrors, and that sky's art. */
const SKY_OF = Object.freeze({ 4: "CCLOUDS", 6: "DUSKSKY", 7: "NITESKY" });
const SIDE = 256;

/** `{ width, height, rgba }` for `weather`, or null when the install has no CLOUDENV. */
export async function truckEnvMap(vfs, weather = 0) {
  const raw = await vfs.read("ART\\CLOUDENV.RAW");
  if (!raw || raw.length !== SIDE * SIDE) return null;
  const sky = SKY_OF[weather];
  const skyPalette = sky ? decodeActPalette(await vfs.read(`ART\\${sky}.ACT`)) : null;
  if (skyPalette && skyPalette.length >= 208 * 3) {
    const rgba = new Uint8ClampedArray(SIDE * SIDE * 4);
    for (let i = 0; i < raw.length; i++) {
      const at = (192 + (raw[i] >> 4)) * 3;
      rgba[i * 4] = skyPalette[at]; rgba[i * 4 + 1] = skyPalette[at + 1]; rgba[i * 4 + 2] = skyPalette[at + 2]; rgba[i * 4 + 3] = 255;
    }
    return { width: SIDE, height: SIDE, rgba };
  }
  const palette = decodeActPalette(await vfs.read("ART\\CLOUDENV.ACT"));
  if (!palette) return null;
  const image = decodeRawTexture(raw, palette);
  return { width: image.width, height: image.height, rgba: image.rgba };
}
