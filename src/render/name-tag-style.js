/*
  Pure colour and cache-key rules for the labels above trucks. Kept apart from the three.js view so
  extension colours can be covered by the Node test suite.
*/

/** The ordinary lines' colours: the driver, then the truck under it. */
export const NAME_COLOURS = Object.freeze(["#ffffff", "#e8231c"]);

/** An extension colour owns every line; otherwise the ordinary per-line colours apply. */
export function nameTagLineColour(line, extensionColour = "") {
  return extensionColour || NAME_COLOURS[Math.min(line, NAME_COLOURS.length - 1)];
}

/** A different colour must repaint a bitmap label even when its words did not change. */
export function nameTagPaintKey(lines, extensionColour = "") {
  return `${extensionColour}\0${lines.join("\n")}`;
}
