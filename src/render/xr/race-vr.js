/*
  A race in the headset (docs/VR.md): where the tracking space goes each frame, the HUD boards
  and the cab, the controllers as the game's joystick, and the player's VR preferences as they
  change them. The rules are in game/vr/ (pure); this joins them to the host.

  Views (settings.js VR_VIEWS):
    cab          the driving position sits on the truck's seat (seat.js). With the horizon lock
                 the seat keeps level and only follows the truck's heading; without it the seat
                 is bolted to the truck.
    chase        a level seat trails the truck, facing it.
*/
import * as THREE from "three";
import { FEET_PER_METRE, toScene, toSceneMatrix } from "../../shared/scene-frame.js";
import { cabFit } from "../../game/vr/cab.js";
import { createXrInputMemory, xrDriveInput } from "../../game/vr/controls.js";
import {
  TELEPORT_FT, createChaseSeat, createHorizonTracker, quatFromMatrix, quatFromYaw, rigMatrix, transformPoint,
} from "../../game/vr/pose.js";
import { moveSeat, seatEye, seatFromBody } from "../../game/vr/seat.js";
import { nextVrView, seatOffsetFor, viewRange, vrSettings, vrView, withSeatOffset } from "../../game/vr/settings.js";
import { createVrCab } from "./vr-cab.js";
import { createVrHud } from "./vr-hud.js";
import { createVrPanelsCab } from "./vr-panels.js";

/**
 * @param {object} host the XR host (xr-host.js)
 * @param {{ settings: object, save: () => void, truckFile: string, body: object|null, truckObject: object, scene: object,
 *   panels: { timing: object, message: object, gauges: object }, cockpit?: object|null, stock?: object|null, needleArt?: object|null, look?: string }} race
 *   `settings.vr` holds the preferences and `save` stores the settings; `body` is the player's
 *   body model (worker/truck-build.js `parts.body`), `truckObject` its drawn truck's root;
 *   `cockpit` the game's dashboard art (worker/cockpit-art.js `cockpitArt`), `stock` its cockpit
 *   pictures (worker/cockpit-art.js `loadCockpit`) and `needleArt` NEEDLE.BIN, when the install
 *   has them
 */
export function createRaceVr(host, { settings, save, truckFile, body, truckObject, scene, panels, cockpit = null, stock = null, needleArt = null, look = "classic" }) {
  let prefs = vrSettings(settings.vr);
  const store = () => {
    settings.vr = prefs;
    save();
  };
  /** The seat the body gives, body feet, and the eyes with the player's offset, in the truck's scene frame. */
  const baseEye = seatFromBody(body?.meshes);
  const eye = [0, 0, 0];
  const seatChanged = () => toScene(...seatEye(baseEye, seatOffsetFor(prefs, truckFile)), eye);
  seatChanged();

  const horizon = createHorizonTracker(), chase = createChaseSeat();
  const memory = createXrInputMemory();
  const hud = createVrHud(host, panels);
  // The cab is part of the truck: it stays at the seat the body gives when the player moves theirs.
  const cab = createVrCab({ cockpit, stock, fit: cabFit(body?.meshes, body?.bounds, baseEye), look });
  cab.object.position.fromArray(toScene(...baseEye, []));
  truckObject.add(cab.object);
  // The stock panels hang at the seat instead, level with it like the game's screen-fixed cockpit.
  const panelsCab = createVrPanelsCab({ art: stock, needle: needleArt, look });
  const anchor = new THREE.Group();
  anchor.name = "vr-panels-anchor";
  scene.add(anchor);
  if (panelsCab) anchor.add(panelsCab.object);
  const truck = new Array(16), rig = new Array(16);
  let last = null;
  /** Each fog the weather has set, as the weather set it. */
  const fogs = new WeakMap();

  const api = {
    get prefs() { return prefs; },
    get view() { return vrView(prefs.view); },
    /** Change a preference and store it. */
    set(key, value) {
      prefs = vrSettings({ ...prefs, [key]: value });
      store();
    },
    nextView() {
      api.set("view", nextVrView(prefs.view));
      chase.reset();
      return api.view;
    },
    /** The player's offset from the seat the body gives, feet [right, up, forward]. */
    get seatOffset() { return seatOffsetFor(prefs, truckFile); },
    /** Move the seat by `delta` feet [right, up, forward], or put it back with no argument. */
    moveSeat(delta) {
      prefs = withSeatOffset(prefs, truckFile, delta ? moveSeat(api.seatOffset, delta) : [0, 0, 0]);
      seatChanged();
      store();
    },
    /**
     * Each frame the headset is drawn to: place the tracking space from the player's drawn pose
     * (`{ pos, matrix }`, game frame) and ready the cameras; `proxy` is the flat camera, which
     * takes the head's place in the scene.
     */
    place(pose, dt, proxy) {
      host.beginFrame();
      toSceneMatrix(pose.matrix, pose.pos, truck);
      const attitude = quatFromMatrix(truck);
      // A reset or the helicopter sets the truck down somewhere else: start following afresh.
      if (last && Math.hypot(pose.pos[0] - last[0], pose.pos[1] - last[1], pose.pos[2] - last[2]) > TELEPORT_FT) {
        horizon.reset();
        chase.reset();
      }
      last = pose.pos;
      const heading = horizon.update(attitude, dt);
      const view = api.view;
      let position, quaternion;
      if (view.id === "cab") {
        position = transformPoint(truck, eye);
        quaternion = prefs.horizonLock ? quatFromYaw(heading) : attitude;
      } else {
        const seat = chase.update([truck[12], truck[13], truck[14]], heading, view, dt);
        position = seat.position;
        quaternion = quatFromYaw(seat.yaw);
      }
      host.placeRig(rigMatrix(position, quaternion, host.calibration, FEET_PER_METRE, rig), proxy);
      anchor.position.set(position[0], position[1], position[2]);
      anchor.quaternion.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
    },
    /**
     * Each frame, headset or not: the scene's fog as far off as this view sees, and that range in
     * feet. In a headset the player may draw the view in (the option "View distance"); the fog
     * then closes at that range, and the flat screen gets the weather's own back.
     */
    sight(fog) {
      if (!fog?.isFog) return Infinity;
      if (!fogs.has(fog)) fogs.set(fog, { near: fog.near, far: fog.far });
      const whole = fogs.get(fog);
      const seen = host.presenting ? viewRange(prefs.viewDistance, whole.near, whole.far) : whole;
      fog.near = seen.near;
      fog.far = seen.far;
      return seen.far;
    },
    /** The controllers as the game's joystick and its one-press actions (game/vr/controls.js). Call every frame. */
    drive() {
      return xrDriveInput(host.hands, memory, { steering: prefs.steering });
    },
    /**
     * Each frame, after `place`: the boards and the cab. `state` is the player's snapshot
     * (speed, rpm, gear, steer); `timing` and `message` say whether those boards have something
     * to show; `light` is how bright the weather leaves the world, 0 to 1, which the cab dims by.
     */
    update({ state, timing = true, message = false, light = 1 }) {
      // Without the install's art the stock box cannot be made: the cage stands in.
      const panelsOn = host.presenting && api.view.id === "cab" && prefs.cab && prefs.cabStyle === "panels" && !!panelsCab;
      const modelOn = host.presenting && api.view.id === "cab" && prefs.cab && !panelsOn;
      cab.update(modelOn, state, light);
      panelsCab?.update(panelsOn, state);
      hud.update({
        shown: host.presenting && prefs.hud && !host.menu.isOpen, timing, message,
        // A cab showing dials takes the flat gauges' place.
        flatGauges: !((modelOn && cab.hasGauges) || (panelsOn && panelsCab.hasGauges)),
      });
    },
    dispose() {
      hud.dispose();
      cab.dispose();
      panelsCab?.dispose();
      anchor.removeFromParent();
    },
  };
  return api;
}
