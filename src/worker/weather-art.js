/*
  Community Patch 3's HD weather art: the skies of the weathers (Rain's CCLOUDS, DUSKSKY, NITESKY) and the old levels'
  CLOUDY2, as true-colour pictures in place of the game's palette art.

  CP3 reads them from a loose WeatherArt folder in the game's folder before any archive, so a player can put pictures of
  their own there. The install copies that folder (install/inspect-source.js) to `install/WEATHERART`. The port also
  carries the community's own set (`assets/weatherArt`, original art, not the game's), so the switch ("CP3 HD weather",
  Options, Advanced) works without the files: with it on, a sky is looked for in the install's WeatherArt first, then in
  the port's set, then as the game finds it (an archive's ART\<stem>.PNG, then its .RAW). Off, only as the game finds it.

  Like the other HD art a picture must be square and a power of two, here up to 2048 (the HD night sky is 2048 across).
*/
import { readFile } from "../shared/opfs.js";
import { INSTALL_DIR } from "./install-store.js";
import { decodeTrueColorTexture } from "./image-decoder.js";

export const WEATHER_ART_DIR = `${INSTALL_DIR}/WEATHERART`;
const MAX_SIDE = 2048, MIN_SIDE = 32;

/** The port's own copies, by stem. Written out one by one: the offline copy (shared/app-files.js) finds only plain names. */
const BUNDLED = {
  CCLOUDS: new URL("../../assets/weatherArt/CCLOUDS.PNG", import.meta.url),
  CLOUDY2: new URL("../../assets/weatherArt/CLOUDY2.PNG", import.meta.url),
  DUSKSKY: new URL("../../assets/weatherArt/DUSKSKY.PNG", import.meta.url),
  NITESKY: new URL("../../assets/weatherArt/NITESKY.PNG", import.meta.url),
};

/** Whether a picture's size is one the weather art may have. */
export const weatherArtSize = (width, height) => width === height && width >= MIN_SIDE && width <= MAX_SIDE && (width & (width - 1)) === 0;

async function decode(bytes, name, extension) {
  if (!bytes) return null;
  try {
    const image = await decodeTrueColorTexture(bytes, name, extension);
    if (!weatherArtSize(image.width, image.height)) return null;
    return { width: image.width, height: image.height, rgba: new Uint8ClampedArray(image.rgba), source: extension };
  } catch {
    return null;
  }
}

const fromInstall = async (stem) => {
  for (const extension of ["PNG", "TGA"]) {
    const file = await readFile(`${WEATHER_ART_DIR}/${stem}.${extension}`).catch(() => null);
    const bytes = file ? new Uint8Array(await file.arrayBuffer()) : null;
    const image = await decode(bytes, `${stem}.${extension}`, extension);
    if (image) return image;
  }
  return null;
};

const fromBundle = async (stem) => {
  const url = BUNDLED[stem];
  if (!url) return null;
  const bytes = await fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
  return decode(bytes ? new Uint8Array(bytes) : null, `${stem}.PNG`, "PNG");
};

/**
 * The HD weather art for a sky stem, `{ width, height, rgba, source }`, or null to go on as the game finds its sky.
 * `install` and `bundled` stand in for the two sources (tests).
 */
export async function loadWeatherArt(stem, { on = true, install = fromInstall, bundled = fromBundle } = {}) {
  const key = String(stem ?? "").toUpperCase();
  if (!on || !key) return null;
  return (await install(key)) ?? (await bundled(key));
}
