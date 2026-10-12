/*
  Pure labels and stock UI artwork names used by the classic menu screens. Add-on tracks may
  omit a preview, in which case the Races screen keeps the artwork's preview opening empty.
*/

export const RACE_TYPE_NAMES = Object.freeze({
  circuit: "Circuit Race",
  rally: "Rally Race",
  summit: "Summit Rumble",
  drag: "Drag Race",
  unsupported: "Unsupported",
});

const STOCK_TRACK_PREVIEWS = Object.freeze({
  "ALASKA.SIT": "HIGHTS",
  "AZTEC.SIT": "EXCAVAT",
  "BAJA.SIT": "TUMBLE",
  "CRAZY98.SIT": "CRAZY98",
  "GRAVEY.SIT": "GRAVE",
  "JUNK.SIT": "SCRAP",
  "MAIN.SIT": "VOODOO",
  "AUSSIE.SIT": "TINHORN",
  "ROCKQRY.SIT": "BREAK",
  "SNAKE.SIT": "SIDEWIND",
  "WAR.SIT": "TORTURE",
  "SUMMIT1.SIT": "SUMMIT1",
  "SUMMIT2.SIT": "SUMMIT2",
  "SUMMIT3.SIT": "SUMMIT3",
  "TPARK.SIT": "FARM",
});

export function raceTypeName(type) {
  return RACE_TYPE_NAMES[type] ?? RACE_TYPE_NAMES.unsupported;
}

/** The Races screen's Mode list (docs/PLAN.md, "Party modes"): the track's own race, or a party game. */
export const GAME_MODES = Object.freeze([
  Object.freeze({ id: "default", name: "Default" }),
  Object.freeze({ id: "hockey", name: "Hockey" }),
  Object.freeze({ id: "tag", name: "Tag" }),
]);

/** What the length box counts: a party game's goals or minutes, else a Rumble's minutes or a race's laps. */
export function raceLengthLabel(type, gameMode = "default") {
  if (gameMode === "hockey") return "Goals";
  if (gameMode === "tag") return "Minutes";
  return type === "summit" ? "Minutes" : "Laps";
}

/**
 * The `UI\\*.BMP` names to try for a track's preview, in order: a stock track's own name, else the add-on
 * convention `<stem>S` (the small picture; `<stem>L` is the thumbnail) and then the bare stem.
 */
export function trackPreviewNames(file) {
  const key = String(file).toUpperCase();
  if (STOCK_TRACK_PREVIEWS[key]) return [STOCK_TRACK_PREVIEWS[key]];
  const stem = key.replace(/\.SI[T2]$/, "");
  return [`${stem}S`, stem];
}

export function trackPreviewName(file) {
  return STOCK_TRACK_PREVIEWS[String(file).toUpperCase()] ?? String(file).replace(/\.SI[T2]$/i, "").toUpperCase();
}

export function garageSummary(setup) {
  const tire = ["s", "m", "d"][setup?.tireCut] ?? "s";
  const suspension = ["s", "m", "h"][setup?.suspension] ?? "s";
  return `${setup?.transferSetting ?? 1500} ${tire}/${suspension}`;
}
