/*
  The race HUD in the headset (docs/VR.md, "The HUD").

  On the flat screen the HUD is 2D canvases laid over the picture: the timing rows, the
  messages, the chase-view gauges. A headset shows only what is in the scene, so canvases of the
  same kind become textures on small boards that hang from the seat, near enough to read and
  nearer than anything they could be mistaken to lie behind. They are drawn over the scene. The
  game's HUD is bare text; against a bright sky in a headset that is hard to read, so the
  headset's rows and messages are drawn on a faint dark plate (render/bitmap-text.js `backing`).

  Places are in seat space, metres: the origin is the driving position, -z ahead, y up. Each
  board is turned to face the driver.
*/
import * as THREE from "three";

/*
  Where each board hangs and how wide it is, metres. The timing rows are up and to the left, in
  the sky over the road (24 degrees left, 9 up, two metres off), clear of the cab's bars and its
  dials; messages are straight ahead above the horizon; the flat gauges, shown where there is no
  dashboard, sit low on either side.
*/
const TIMING = Object.freeze({ place: [-0.8, 0.31, -1.8], width: 0.66 });
const MESSAGE = Object.freeze({ place: [0, 0.6, -2.4], width: 1.9 });
/**
 * The gauges canvas is the 640 x 480 screen in a headset (the race screen sets it to that size
 * while one shows it); these are the parts of it that hold something.
 */
const GAUGE_PARTS = Object.freeze([
  { crop: [21, 308, 189, 476], place: [-0.45, -0.42, -1.2], width: 0.26 },   // speedometer
  { crop: [456, 308, 624, 476], place: [0.45, -0.42, -1.2], width: 0.26 },   // tachometer
  { crop: [282, 454, 356, 480], place: [0, -0.52, -1.2], width: 0.14 },      // P R N 1 2 3
]);

const _m = new THREE.Matrix4(), _eye = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

function boardMaterial(texture) {
  return new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
}

function canvasTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

function board(material, [x, y, z]) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.position.set(x, y, z);
  // Its face (+z) toward the driving position.
  mesh.quaternion.setFromRotationMatrix(_m.lookAt(_eye, mesh.position, _up));
  mesh.renderOrder = 900;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * @param {object} host the XR host (xr-host.js)
 * @param {{ timing: object, message: object, gauges: object }} panels the headset's own text
 *   panels and the gauges: each `{ element, version }`, the version counting its redraws
 *   (render/bitmap-text.js, race-gauges.js). A panel without a canvas (no font) is left out.
 */
export function createVrHud(host, { timing, message, gauges }) {
  const root = new THREE.Group();
  root.name = "vr-hud";
  const gaugeRoot = new THREE.Group();
  root.add(gaugeRoot);
  const disposables = [];
  const updates = [];

  /** A whole canvas on one board, resized as its canvas is. */
  function whole(source, { place, width }) {
    const canvas = source?.element;
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const texture = canvasTexture(canvas);
    const mesh = board(boardMaterial(texture), place);
    disposables.push(texture, mesh.material, mesh.geometry);
    let version = null, w = 0, h = 0;
    updates.push(() => {
      if (source.version === version || !canvas.width || !canvas.height) return;
      version = source.version;
      if (canvas.width !== w || canvas.height !== h) {
        w = canvas.width; h = canvas.height;
        // The texture's storage is fixed in size once made.
        texture.dispose();
        mesh.scale.set(width, width * h / w, 1);
      }
      texture.needsUpdate = true;
    });
    mesh.visible = false;
    root.add(mesh);
    return mesh;
  }

  const timingBoard = whole(timing, TIMING);
  const messageBoard = whole(message, MESSAGE);
  if (messageBoard) messageBoard.renderOrder = 901;

  const gaugeCanvas = gauges?.element;
  if (gaugeCanvas instanceof HTMLCanvasElement) {
    const texture = canvasTexture(gaugeCanvas);
    const material = boardMaterial(texture);
    disposables.push(texture, material);
    const W = 640, H = 480;
    for (const { crop: [x0, y0, x1, y1], place, width } of GAUGE_PARTS) {
      const mesh = board(material, place);
      const uv = mesh.geometry.attributes.uv;
      uv.setXY(0, x0 / W, 1 - y0 / H); uv.setXY(1, x1 / W, 1 - y0 / H);
      uv.setXY(2, x0 / W, 1 - y1 / H); uv.setXY(3, x1 / W, 1 - y1 / H);
      mesh.scale.set(width, width * (y1 - y0) / (x1 - x0), 1);
      disposables.push(mesh.geometry);
      gaugeRoot.add(mesh);
    }
    let version = null;
    updates.push(() => {
      if (gauges.version === version) return;
      version = gauges.version;
      texture.needsUpdate = true;
    });
  }
  root.visible = false;
  host.seat.add(root);

  return {
    object: root,
    /**
     * Once a frame. `shown` is whether the HUD shows at all, `timing` and `message` whether
     * those boards have something to say, `flatGauges` whether the flat gauges show (not where
     * a dashboard shows its own).
     */
    update({ shown, timing: timingOn = true, message: messageOn = false, flatGauges = true }) {
      root.visible = shown;
      if (!shown) return;
      gaugeRoot.visible = flatGauges;
      if (timingBoard) timingBoard.visible = timingOn && !!timing.version;
      if (messageBoard) messageBoard.visible = messageOn && !!message.version;
      for (const update of updates) update();
    },
    dispose() {
      root.removeFromParent();
      for (const d of disposables) d.dispose();
    },
  };
}
