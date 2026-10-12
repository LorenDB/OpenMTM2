/*
  What the headset shows when no screen is drawing (docs/VR.md, "Between races"): a dark floor
  grid and one board. The board is whatever the current screen has set on the host (`setBoard`:
  the loading note, the Winner's Circle, the race setup), or a default that says where the game is.

  The stage is in feet with the rig at life size, like a race, so the host treats every scene
  alike.
*/
import * as THREE from "three";
import { FEET_PER_METRE } from "../../shared/scene-frame.js";
import { rigMatrix } from "../../game/vr/pose.js";
import { createMenu } from "../../game/vr/menu.js";

/** A seated player's eyes above the grid, feet. */
const EYE_FT = 4;
const SEAT_POSITION = [0, 0, 0], SEAT_QUATERNION = [0, 0, 0, 1];

/** @param {object} host the XR host (xr-host.js) */
export function createIdleStage(host) {
  const scene = new THREE.Scene();
  const colour = new THREE.Color(0x0d1013);
  scene.background = colour;
  scene.fog = new THREE.Fog(colour, 15, 90);
  const grid = new THREE.GridHelper(200, 50, 0xf2a516, 0x38424c);
  grid.position.y = -EYE_FT;
  scene.add(grid);
  const proxy = new THREE.PerspectiveCamera();
  const fallback = createMenu({
    title: "OpenMTM2",
    lines: ["The menus are on the flat screen."],
    items: [{ label: "Leave VR", action: () => host.exit() }],
  });
  let active = false, shown = null;
  const rig = new Array(16);

  return {
    /** One frame of the stage. */
    frame(_dt, now) {
      if (!active) {
        active = true;
        scene.add(host.rig);
      }
      const board = host.board ?? fallback;
      if (board !== shown) {
        shown = board;
        host.menu.open(board);
      }
      host.beginFrame();
      host.placeRig(rigMatrix(SEAT_POSITION, SEAT_QUATERNION, host.calibration, FEET_PER_METRE, rig), proxy);
      host.menu.update(now);
      host.renderer.render(scene, host.camera);
    },
    /** A screen takes over: give up the rig and the menu. */
    leave() {
      if (!active) return;
      active = false;
      shown = null;
      host.menu.close();
      if (host.rig.parent === scene) host.rig.removeFromParent();
    },
  };
}
