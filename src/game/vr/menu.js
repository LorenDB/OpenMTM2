/*
  A menu shown in the headset (docs/VR.md, "Menus"): a title, lines of text or a table, and items
  worked with a pointer or with up, down, left, right, select and back. Pure: the picture is
  drawn elsewhere (render/xr/vr-panel.js), so the behaviour is tested under Node.

  An item is `{ label, value?, action?, change?, disabled? }`:
    action()            runs when the item is selected
    change(direction)   steps the item's value down (-1) or up (+1); selecting it steps up
    value               the text shown beside the label, or a function returning it
*/

const usable = (item) => !!item && !item.disabled && (typeof item.action === "function" || typeof item.change === "function");

/**
 * @param {{ title?: string, lines?: string[], table?: string[][], items?: object[], back?: () => void }} spec
 *   `back` runs when the player backs out (the B or Y button, Escape).
 */
export function createMenu(spec = {}) {
  const items = spec.items ?? [];
  const first = items.findIndex(usable);
  return {
    title: spec.title ?? "",
    lines: spec.lines ?? [],
    table: spec.table ?? null,
    items,
    /** The highlighted item, or -1 when nothing can be chosen. */
    index: first,
    /** Highlight the next usable item up (-1) or down (+1), wrapping. */
    move(direction) {
      if (this.index < 0) return;
      const n = items.length;
      for (let step = 1; step <= n; step++) {
        const i = (((this.index + direction * step) % n) + n) % n;
        if (usable(items[i])) { this.index = i; return; }
      }
    },
    /** Highlight item `i` (a pointer over it). Returns whether it can be chosen. */
    hover(i) {
      if (!usable(items[i])) return false;
      this.index = i;
      return true;
    },
    /** Step the highlighted item's value; returns whether it has one. */
    change(direction) {
      const item = items[this.index];
      if (!usable(item) || typeof item.change !== "function") return false;
      item.change(direction < 0 ? -1 : 1);
      return true;
    },
    /** Choose the highlighted item; returns whether anything ran. */
    select() {
      const item = items[this.index];
      if (!usable(item)) return false;
      if (typeof item.action === "function") item.action();
      else item.change(1);
      return true;
    },
    back() {
      if (typeof spec.back !== "function") return false;
      spec.back();
      return true;
    },
  };
}

/** An item's value as text. */
export function itemValue(item) {
  const v = typeof item?.value === "function" ? item.value() : item?.value;
  return v === undefined || v === null ? "" : String(v);
}

/** Whether an item can be chosen. */
export const itemUsable = usable;

/** The next entry of `list` after `current` in `direction`, wrapping; the first when `current` is not in it. */
export function cycle(list, current, direction = 1) {
  if (!list.length) return current;
  const i = list.indexOf(current);
  if (i < 0) return list[0];
  return list[(((i + direction) % list.length) + list.length) % list.length];
}
