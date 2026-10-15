/*
  The archives OpenMTM2 cannot run without: the menus' art and fonts (UI, STARTUP), the music and the sounds, the
  cockpit and MTM2's trucks with the blimp and the helicopter (TRUCK2). An install without any of them is refused, and
  the POD manager does not take them out; every other archive is optional, POD.INI's included.

  They are named by archive for now. What is needed is the files in them, so the list should become one of files
  (UI\..., SOUND\...), found in whichever mounted archive holds them, whatever it is called.
*/
import { installPathKey } from "./pod-ini.js";

export const REQUIRED_PODS = Object.freeze(["STARTUP.POD", "MUSIC.POD", "SOUND.POD", "COCKPIT.POD", "TRUCK2.POD", "UI.POD"]);

/** An archive's file name, upper case, from its path in the folder (`system\startup.pod` is STARTUP.POD). */
export const podFileName = (path) => installPathKey(path).split("/").pop();

/** Whether OpenMTM2 needs the archive at `path`. */
export const isRequiredPod = (path) => REQUIRED_PODS.includes(podFileName(path));

/** The required archives none of `paths` is. */
export function missingRequiredPods(paths) {
  const have = new Set([...paths].map(podFileName));
  return REQUIRED_PODS.filter((name) => !have.has(name));
}

/** What the player is told when an install lacks some of them. */
export function requiredPodsMessage(missing) {
  return `OpenMTM2 needs ${REQUIRED_PODS.join(", ")} to run, and ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not there. `
    + "Pick a Monster Truck Madness 2 folder whose POD.INI lists them all.";
}
