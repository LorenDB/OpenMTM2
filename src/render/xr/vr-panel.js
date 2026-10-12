/*
  A menu on a board in the headset (docs/VR.md, "Menus"): game/vr/menu.js says what it holds and
  what choosing does; this draws it and works it.

  The board hangs from the seat, in front of the player, and is drawn over everything. It is
  worked three ways at once: a controller's beam on an item with its trigger, either thumbstick
  with the trigger or the face buttons, and the keyboard's arrows with Enter and Escape. Text is
  in the game's own fonts once they are loaded (`setFonts`), a plain face until then.
*/
import * as THREE from "three";
import { drawText, textWidth } from "../bitmap-text.js";
import { createXrInputMemory, xrMenuInput } from "../../game/vr/controls.js";
import { itemUsable, itemValue } from "../../game/vr/menu.js";

const WIDTH_PX = 1024, PAD = 44, TITLE_H = 104, LINE_H = 54, ROW_H = 56, ITEM_H = 78, GAP = 18;
/** A table's text is at most this many times the font's own size, and its columns this far apart (at that size). */
const TABLE_MAX_SCALE = 2.75, TABLE_GAP = 14;
/** The board's width and its place on the seat, metres. */
const WIDTH_M = 1.15, PLACE = Object.freeze([0, -0.08, -1.45]);
const ACCENT = "#f2a516", TEXT = "#f1ede2", MUTED = "#9aa3ab";

/** @param {object} host the XR host (xr-host.js) */
export function createVrMenu(host) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH_PX;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: texture, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false,
  }));
  board.name = "vr-menu";
  board.renderOrder = 1000;
  board.frustumCulled = false;
  board.position.fromArray(PLACE);
  board.visible = false;
  // Where a beam meets the board.
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.008, 16), new THREE.MeshBasicMaterial({
    color: 0xffffff, depthTest: false, depthWrite: false, fog: false, toneMapped: false,
  }));
  dot.renderOrder = 1002;
  dot.visible = false;
  host.seat.add(board, dot);

  let menu = null, drawn = "", fonts = { title: null, text: null };
  /** Per item: its rectangle on the canvas, and where its value's left arrow ends. */
  let rects = [];
  const memory = createXrInputMemory();
  /** What a beam is on this frame (`pick`'s result), or null. */
  let pointed = null;
  /** The menu has not been through a frame yet: the press that opened it is not for it. */
  let fresh = false;

  /** The plain face used until the game's fonts arrive, sized like them. */
  const plain = (scale) => `600 ${Math.round(17 * scale)}px system-ui, sans-serif`;
  function measure(font, text, scale) {
    if (font) return textWidth(font, text, scale);
    ctx.font = plain(scale);
    return ctx.measureText(text).width;
  }
  /** Text with its left edge at x, or centred on it, or ending at it; shrunk to fit `max`. */
  function write(font, text, x, y, { color = TEXT, scale = 2, align = "left", max = Infinity } = {}) {
    let s = scale;
    while (s > 1 && measure(font, text, s) > max) s -= 0.25;
    const w = measure(font, text, s);
    const left = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
    if (font) {
      drawText(ctx, font, text, Math.round(left) + 2, Math.round(y) + 2, { color: "#000", scale: s });
      drawText(ctx, font, text, Math.round(left), Math.round(y), { color, scale: s });
    } else {
      ctx.font = plain(s);
      ctx.textBaseline = "top";
      ctx.fillStyle = color;
      ctx.fillText(text, left, y + 4);
    }
    return w;
  }

  function draw() {
    const lines = menu.lines ?? [], table = menu.table ?? [], items = menu.items ?? [];
    const height = PAD + (menu.title ? TITLE_H : 0) + lines.length * LINE_H + (lines.length ? GAP : 0)
      + table.length * ROW_H + (table.length ? GAP : 0) + items.length * ITEM_H + PAD;
    if (canvas.height !== height) {
      canvas.height = height;
      // The texture's storage is fixed in size once made.
      texture.dispose();
    }
    ctx.clearRect(0, 0, WIDTH_PX, height);
    ctx.fillStyle = "rgba(9, 12, 16, 0.9)";
    roundRect(0, 0, WIDTH_PX, height, 28);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(242, 165, 22, 0.75)";
    roundRect(2, 2, WIDTH_PX - 4, height - 4, 26);
    ctx.stroke();
    let y = PAD;
    if (menu.title) {
      write(fonts.title, menu.title, WIDTH_PX / 2, y, { color: ACCENT, scale: 2.5, align: "center", max: WIDTH_PX - PAD * 2 });
      y += TITLE_H;
    }
    for (const line of lines) {
      write(fonts.text, line, WIDTH_PX / 2, y, { scale: 2.5, align: "center", max: WIDTH_PX - PAD * 2 });
      y += LINE_H;
    }
    if (lines.length) y += GAP;
    if (table.length) {
      // Each column is as wide as its longest cell, and the text as large as lets them all fit the board.
      const columns = Math.max(...table.map((row) => row.length));
      const widest = Array.from({ length: columns }, (_, c) => Math.max(1, ...table.map((row) => measure(fonts.text, String(row[c] ?? ""), 1))));
      const total = widest.reduce((a, b) => a + b, 0) + (columns - 1) * TABLE_GAP;
      const scale = Math.max(1, Math.min(TABLE_MAX_SCALE, (WIDTH_PX - PAD * 2) / total));
      for (const row of table) {
        let x = PAD;
        for (let c = 0; c < columns; c++) {
          write(fonts.text, String(row[c] ?? ""), x, y, { scale, color: row.highlight ? ACCENT : TEXT, max: widest[c] * scale + 1 });
          x += (widest[c] + TABLE_GAP) * scale;
        }
        y += ROW_H;
      }
      y += GAP;
    }
    rects = items.map((item, i) => {
      const top = y + i * ITEM_H, usable = itemUsable(item), selected = i === menu.index;
      if (selected) {
        ctx.fillStyle = "rgba(242, 165, 22, 0.24)";
        roundRect(PAD / 2, top + 4, WIDTH_PX - PAD, ITEM_H - 8, 14);
        ctx.fill();
      }
      const color = !usable ? MUTED : selected ? "#fff" : TEXT;
      const value = itemValue(item), stepped = typeof item.change === "function";
      let arrowEnd = 0;
      if (value || stepped) {
        write(fonts.title, item.label, PAD, top + 8, { color, scale: 2, max: WIDTH_PX * 0.45 });
        const right = WIDTH_PX - PAD, valueMax = WIDTH_PX * 0.4;
        if (stepped && usable) {
          write(fonts.title, ">", right, top + 8, { color: ACCENT, scale: 2, align: "right" });
          const w = write(fonts.title, value, right - 44, top + 8, { color, scale: 2, align: "right", max: valueMax });
          write(fonts.title, "<", right - 60 - w, top + 8, { color: ACCENT, scale: 2, align: "right" });
          arrowEnd = right - 44 - w / 2;
        } else {
          write(fonts.title, value, right, top + 8, { color, scale: 2, align: "right", max: valueMax });
        }
      } else {
        write(fonts.title, item.label, WIDTH_PX / 2, top + 8, { color, scale: 2, align: "center", max: WIDTH_PX - PAD * 2 });
      }
      return { top, bottom: top + ITEM_H, arrowEnd };
    });
    texture.needsUpdate = true;
    board.scale.set(WIDTH_M, WIDTH_M * height / WIDTH_PX, 1);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  const _inverse = new THREE.Matrix4(), _o = new THREE.Vector3(), _d = new THREE.Vector3(), _hit = new THREE.Vector3();
  /** The item a ray (scene frame) lands on: `{ index, side, point }`, index -1 for bare board; null off it. */
  function pick(origin, direction) {
    board.updateMatrixWorld();
    _inverse.copy(board.matrixWorld).invert();
    _o.copy(origin).applyMatrix4(_inverse);
    _d.copy(direction).transformDirection(_inverse);
    if (_d.z >= -1e-6 || _o.z <= 0) return null;
    const t = -_o.z / _d.z;
    const x = _o.x + _d.x * t, y = _o.y + _d.y * t;
    if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) return null;
    const px = (x + 0.5) * WIDTH_PX, py = (0.5 - y) * canvas.height;
    const index = rects.findIndex((r) => py >= r.top && py < r.bottom);
    const side = index >= 0 && rects[index].arrowEnd && px < rects[index].arrowEnd ? -1 : 1;
    return { index, side, point: _hit.set(x, y, 0).applyMatrix4(board.matrixWorld).clone() };
  }

  function choose(side = 1) {
    if (!menu) return;
    const item = menu.items[menu.index];
    if (item && typeof item.change === "function" && typeof item.action !== "function") menu.change(side);
    else menu.select();
  }

  const onKey = (e) => {
    if (!menu || !host.presenting) return;
    const keys = {
      ArrowUp: () => menu.move(-1), ArrowDown: () => menu.move(1), ArrowLeft: () => menu.change(-1), ArrowRight: () => menu.change(1),
      Enter: () => choose(1), NumpadEnter: () => choose(1),
    };
    const act = keys[e.code];
    if (!act) return;
    e.preventDefault();
    act();
  };
  window.addEventListener("keydown", onKey);
  // A pinch or a gaze tap: choose what its ray is on.
  const offSelect = host.on("select", (controller) => {
    if (!menu) return;
    const origin = new THREE.Vector3().setFromMatrixPosition(controller.ray.matrixWorld);
    const direction = new THREE.Vector3(0, 0, -1).transformDirection(controller.ray.matrixWorld);
    const hit = pick(origin, direction);
    if (hit && hit.index >= 0 && menu.hover(hit.index)) choose(hit.side);
  });

  return {
    object: board,
    get menu() { return menu; },
    get isOpen() { return !!menu; },
    /** The game's fonts for the title and items and for the smaller text (render/bitmap-text.js `loadFont`). */
    setFonts(title, text) {
      fonts = { title: title ?? null, text: text ?? title ?? null };
      drawn = "";
    },
    open(next) {
      menu = next;
      drawn = "";
      pointed = null;
      fresh = true;
      board.visible = true;
      host.showBeams(true);
    },
    close() {
      menu = null;
      board.visible = dot.visible = false;
      host.showBeams(false);
    },
    /**
     * Once a frame, after the rig is placed. With no menu open it only keeps track of what is
     * held, so a button held as a menu opens does not choose anything in it.
     */
    update(now) {
      const input = xrMenuInput(host.hands, memory, now / 1000);
      if (!menu) return;
      const key = JSON.stringify([menu.title, menu.lines, menu.table, menu.index, menu.items.map((i) => [i.label, itemValue(i), itemUsable(i)]), !!fonts.title]);
      if (key !== drawn) { drawn = key; draw(); }
      // The first beam on the board points.
      let hit = null;
      for (const hand of [host.hands.right, host.hands.left]) {
        if (!hand?.origin) continue;
        hit = pick(hand.origin, hand.direction);
        if (hit) break;
      }
      dot.visible = !!hit;
      if (hit) {
        dot.position.copy(host.seat.worldToLocal(hit.point));
        dot.quaternion.copy(board.quaternion);
        const moved = hit.index !== pointed?.index;
        pointed = hit;
        if (moved && hit.index >= 0) menu.hover(hit.index);
      } else pointed = null;
      // The button that opened the menu (pause is also "back") was pressed for that, not for an item.
      const first = fresh;
      fresh = false;
      if (first) return;
      if (input.up) menu.move(-1);
      if (input.down) menu.move(1);
      if (input.left) menu.change(-1);
      if (input.right) menu.change(1);
      if (input.back) menu.back();
      else if (input.confirm) choose(1);
      else if (input.select) {
        // A trigger chooses what its beam is on; with no beam on the board, the highlighted item.
        if (pointed && pointed.index >= 0 && menu.hover(pointed.index)) choose(pointed.side);
        else if (!pointed) choose(1);
      }
    },
    dispose() {
      window.removeEventListener("keydown", onKey);
      offSelect();
      board.removeFromParent();
      dot.removeFromParent();
      board.geometry.dispose(); board.material.dispose(); texture.dispose();
      dot.geometry.dispose(); dot.material.dispose();
    },
  };
}
