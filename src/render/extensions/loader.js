/* Rendering adapters for registered extensions. Core race and replay screens use only this API. */
import { dressExtension } from "./party-scene.js";
import { createItMarker } from "./it-marker.js";

export function createExtensionScene(scene, world, extension) {
  const dressing = dressExtension(scene, world, extension);
  const marker = extension?.mode === "tag" ? createItMarker() : null;
  if (marker) scene.add(marker.object);
  return {
    updateMarker(pos, camera, time) { marker?.update(pos, camera, time); },
    dispose() { marker?.dispose(); dressing.dispose(); },
  };
}
