/*
  What this machine is, for the scenery preset (game/graphics.js `detectGraphics`).

  The graphics chip's name is read once, from a throwaway WebGL context, and kept, including
  an empty name, so a context is not made for every frame. The picture's size and the memory
  figure are read on each call: a window moves between screens, and a laptop's memory figure
  is not part of the chip's name. The size matches the race renderer, which draws at most two
  device pixels to a point (`Math.min(2, devicePixelRatio)`).

  No three.js. Where there is no document (Node, the tests) the name is empty and the size is
  unknown, and this does not throw.
*/

/** The chip's name from the last probe, or null until the first one. */
let rendererCache = null;

/** `{ renderer, deviceMemory, pixels }` for `detectGraphics`. */
export function graphicsHardware() {
  return { renderer: rendererName(), deviceMemory: memoryGb(), pixels: picturePoints() };
}

function rendererName() {
  if (rendererCache !== null) return rendererCache;
  rendererCache = "";
  try {
    if (typeof document === "undefined") return rendererCache;
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return rendererCache;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "";
    rendererCache = typeof name === "string" ? name : "";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    rendererCache = "";
  }
  return rendererCache;
}

function memoryGb() {
  try {
    const memory = globalThis.navigator?.deviceMemory;
    return typeof memory === "number" && Number.isFinite(memory) ? memory : null;
  } catch {
    return null;
  }
}

/** Points the race would draw for a full screen at this device pixel ratio, or null when the screen is unknown. */
function picturePoints() {
  try {
    const screen = globalThis.screen;
    if (!screen || !screen.width || !screen.height) return null;
    const ratio = typeof globalThis.devicePixelRatio === "number" && Number.isFinite(globalThis.devicePixelRatio)
      ? globalThis.devicePixelRatio : 1;
    return screen.width * screen.height * Math.min(2, ratio) ** 2;
  } catch {
    return null;
  }
}
