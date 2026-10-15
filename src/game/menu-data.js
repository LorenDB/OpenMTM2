/*
  Pure labels and stock UI artwork names used by the classic menu screens. Add-on tracks may
  omit a preview, in which case the Races screen keeps the artwork's preview opening empty.
*/

export const RACE_TYPE_NAMES = Object.freeze({
  circuit: "Circuit Race",
  rally: "Rally Race",
  summit: "Summit Rumble",
  drag: "Drag Race",
  freeroam: "Free Roam",
  unsupported: "Unsupported",
});

export function raceTypeName(type) {
  return RACE_TYPE_NAMES[type] ?? RACE_TYPE_NAMES.unsupported;
}

/** The Races screen's core modes. Optional modes are supplied by the extension loader. */
export const GAME_MODES = Object.freeze([
  Object.freeze({ id: "default", name: "Default" }),
  Object.freeze({ id: "freeroam", name: "Free Roam" }),
  Object.freeze({ id: "flyby", name: "Fly-by" }),
]);

/** What the core length box counts: a Rumble's minutes or a race's laps. */
export function raceLengthLabel(type) {
  return type === "summit" ? "Minutes" : "Laps";
}

/**
 * A track's preview picture: the `UI\\<name>.BMP` its SIT names after "Track Logo .BMP file" (the catalog's `logoBmp`),
 * or null when it names none. Nothing is guessed from the track's file name: the SIT is what says it. (The SIT's
 * "Track Map .BMP file" is the small icon in MTM2, and in MTM1 the zoom map.)
 */
export function trackPreviewBmp(track) {
  return track?.logoBmp || null;
}

export function garageSummary(setup) {
  const tire = ["s", "m", "d"][setup?.tireCut] ?? "s";
  const suspension = ["s", "m", "h"][setup?.suspension] ?? "s";
  return `${setup?.transferSetting ?? 1500} ${tire}/${suspension}`;
}
