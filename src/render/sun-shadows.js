/*
  Sun shadows across the view distance, as cascaded shadow maps (the enhanced look).

  Ported from JSTrackViewer's sun-shadows.js with the distances in feet, this scene's unit. The
  text below is that file's own, which still holds.
*/
/*
  Sun shadows across the whole view distance, as cascaded shadow maps.

  A single shadow map has one texel size everywhere it covers. Stretched over the view
  distance that texel grows until trees cast smudges, so the viewer used to shadow only a
  32 cell square around the camera, and shadows stopped a short way in front of it. Cascades
  split the view frustum by distance and give each slice its own map: fine texels close to
  the camera, where detail shows, and coarse ones far away, where it does not.

  three.js's CSM add-on does the splitting and fitting. It lights with one directional light
  per cascade and selects one of them per fragment, which has two consequences handled here:

    - Every lit material has to be set up for it. A material that is not would add all the
      cascade lights together and render several times too bright. setupMaterials walks the
      scene and sets up whatever it has not seen, so materials created later (a texture
      toggle swapping the terrain's, a truck being loaded) are picked up on the next pass.

    - CSM takes a material's onBeforeCompile for itself. The terrain already has one (the
      CPR road mask, see scene.js), so an existing hook is kept and run first, and the
      program cache key is made to tell the combined hook apart from CSM's alone.

  With shadows off the cascades are hidden and the scene's ordinary sun lights instead: a
  set up material with no shadowed lights falls through to CSM's plain lighting loop, so it
  is lit exactly once either way.

  Keeping it cheap. A shadow map redraw draws every caster in the cascade again, and on a
  track with thousands of objects that is most of a frame's work. CSM fits each cascade to
  the view frustum, so every turn of the camera, not only every move, redraws all four. Here
  the fitting is CSM's replaced (see _fit) so that the maps depend as little as possible on
  the camera:

    - Each cascade covers a circle around the camera rather than its slice of the frustum:
      the circle that holds the slice however the camera is turned. Looking around then
      never redraws anything.
    - Each covers a little more than it needs (SLACK) and is redrawn only once the camera
      has moved further than that from where it was last fitted. Moving slowly redraws the
      near cascade now and then and the far one hardly ever.
    - When things in the scene move (a truck being driven, objects knocked about), the near
      cascade redraws every frame and each further one half as often.
    - The fit is snapped to whole texels, so a refit does not make shadow edges crawl.
*/

import * as THREE from "three";
import { CSM } from "three/addons/csm/CSM.js";
import { SHADOW_CASCADE_ENDS_FT, SHADOW_FAR_FT } from "../game/lighting.js";

const CASCADES = 4;
const MAP_SIZE = 2048;
/** Where the first three cascades end, in feet; the last runs on to maxFar. */
const CASCADE_ENDS = [500, 1700, 4200];
const LIGHT_MARGIN = 1300;
const LIGHT_FAR = 34000;
/** How much further than its slice each cascade reaches, as a fraction: the camera's free travel. */
const SLACK = 0.12;
/** Depth room behind a cascade's circle toward the sun, in feet, for tall casters. */
const DEPTH_MARGIN = 2500;
/** Normal offset per cascade, as a fraction of that cascade's texel: enough to stop acne on the terrain. */
const NORMAL_BIAS_PER_TEXEL = 0.5;
const DEPTH_BIAS = -0.00002;
/** Materials whose shader uses the scene lights, and so the cascade lights. */
const isLit = (material) => material && (material.isMeshLambertMaterial || material.isMeshPhongMaterial
  || material.isMeshStandardMaterial || material.isMeshToonMaterial);

export class SunShadows {
  /** `cascadeEnds` is where the first three cascades end, feet from the eye; the last runs on to `maxFar`. */
  constructor({ scene, camera, color, intensity = 1, maxFar = 10240, cascadeEnds = CASCADE_ENDS }) {
    this._scene = scene;
    this._camera = camera;
    this._seen = new WeakSet();
    this._csm = new CSM({
      camera,
      parent: scene,
      cascades: CASCADES,
      maxFar,
      mode: "custom",
      customSplitsCallback: (amount, near, far, target) => {
        for (let i = 1; i < amount; i++) {
          // Fixed distances, squeezed evenly if the view distance is shorter than they are.
          const end = cascadeEnds[i - 1] ?? far;
          target.push(Math.min(end / far, i / amount));
        }
        target.push(1);
      },
      shadowMapSize: MAP_SIZE,
      lightIntensity: intensity,
      lightNear: 1,
      lightFar: LIGHT_FAR,
      lightMargin: LIGHT_MARGIN,
    });
    for (const light of this._csm.lights) {
      // Set outright: the helper reads an intensity of 0 as "none given" and falls back to its own bright default, which
      // lit the ground and cast shadows in Pitch Black, the one weather whose sun is 0.
      light.intensity = intensity;
      light.color.set(color);
      light.shadow.bias = DEPTH_BIAS;
      // Redrawn per cascade, only when _fit or invalidate says so.
      light.shadow.autoUpdate = false;
    }
    this._fits = this._csm.lights.map(() => ({ center: null, radius: 0 }));
    this._frame = 0;
    this._dynamic = false;
    this.setEnabled(false);
  }

  get enabled() { return this._enabled; }

  /** Shows the cascade lights and lets them cast, or hides them all. */
  setEnabled(enabled) {
    this._enabled = enabled;
    for (const light of this._csm.lights) {
      light.visible = enabled;
      light.castShadow = enabled;
    }
    this.invalidate();
  }

  /** Something that affects every shadow changed (the sun, the track, visibility): redraw all. */
  invalidate() {
    for (const fit of this._fits ?? []) fit.center = null;
  }

  /** Something in the scene moved this frame: redraw near cascades now, far ones in turn. */
  invalidateDynamic() {
    this._dynamic = true;
  }

  setIntensity(value) {
    for (const light of this._csm.lights) light.intensity = value;
  }

  setColor(color) {
    for (const light of this._csm.lights) light.color.set(color);
  }

  /** How dark the shadows are, 0 (none) to 1: an overcast sky's are faint. */
  setStrength(value) {
    for (const light of this._csm.lights) light.shadow.intensity = value;
  }

  /** The direction the sunlight travels, as the scene's own sun uses it. */
  setDirection(direction) {
    this._csm.lightDirection.copy(direction).normalize();
    this.invalidate();
  }

  /**
   * Take the scene's sun as it stands now: its strength, its colour and where it is, and
   * `strength`, how dark its shadows are. The weather changes all four (render/light-rig.js).
   */
  follow(sun, strength = 1) {
    this.setIntensity(sun.intensity);
    this.setColor(sun.color);
    this.setStrength(strength);
    _center.copy(sun.position).normalize().negate();
    if (_center.distanceToSquared(this._csm.lightDirection) > 1e-8) this.setDirection(_center);
  }

  /** After the camera's aspect or far plane changes: the cascades are cut from its frustum. */
  setMaxFar(maxFar) {
    this._csm.maxFar = maxFar;
    this.refit();
  }

  refit() {
    // Recomputes the cascade breaks and the shaders' copies of them; the circles follow.
    this._csm.updateFrustums();
    this.invalidate();
  }

  /**
   * Sets up every lit material under `root` that has not been seen yet.
   * Cheap on a scene that has not changed: one traversal and a WeakSet lookup per material.
   */
  setupMaterials(root = this._scene) {
    root.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!isLit(material) || this._seen.has(material)) continue;
        this._seen.add(material);
        this._setup(material);
      }
    });
  }

  _setup(material) {
    const own = Object.prototype.hasOwnProperty.call(material, "onBeforeCompile") ? material.onBeforeCompile : null;
    // What tells this material's own shader from another's: the key it gives itself, or else its hook's text. Two
    // materials may share a hook's text and differ in what the hook was made with (render/ground-surface.js).
    const ownKey = own ? material.customProgramCacheKey() : "";
    this._csm.setupMaterial(material);
    if (!own) return;
    const csmHook = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      own.call(material, shader, renderer);
      csmHook.call(material, shader, renderer);
    };
    const key = `${ownKey}|${csmHook.toString()}`;
    material.customProgramCacheKey = () => key;
    material.needsUpdate = true;
  }

  /** Drops the materials of a track that has been cleared, which the CSM would otherwise keep. */
  forgetMaterials() {
    this._csm.shaders.clear();
    this._seen = new WeakSet();
  }

  /**
   * Once a frame: refits and marks for redrawing the cascades that need it. Returns true when
   * any does, for the renderer's shadow pass to run.
   */
  update() {
    if (!this._enabled) return false;
    this._frame++;
    const camera = this._camera;
    camera.updateMatrixWorld();
    const far = Math.min(camera.far, this._csm.maxFar);
    // The farthest a point at view depth d can be from the camera is d times this.
    const ty = Math.tan((camera.fov * Math.PI / 180) / 2);
    const tx = ty * camera.aspect;
    const spread = Math.sqrt(1 + tx * tx + ty * ty);

    let any = false;
    this._csm.lights.forEach((light, i) => {
      const fit = this._fits[i];
      const reach = this._csm.breaks[i] * far * spread;
      const radius = reach * (1 + SLACK);
      const stale = !fit.center || Math.abs(fit.radius - radius) > radius * 1e-3
        || fit.center.distanceTo(camera.position) > reach * SLACK;
      const due = this._dynamic && this._frame % (1 << i) === 0;
      if (!stale && !due) return;
      if (stale) this._fit(light, fit, radius);
      light.shadow.needsUpdate = true;
      any = true;
    });
    this._dynamic = false;
    return any;
  }

  /*
    Points a cascade's light at a circle of `radius` around the camera, snapped to texels in
    the light's own frame so that successive fits line up with each other.
  */
  _fit(light, fit, radius) {
    const direction = this._csm.lightDirection;
    _orientation.lookAt(_zero, direction, _worldUp);
    _inverse.copy(_orientation).invert();
    const texel = (2 * radius) / MAP_SIZE;
    _center.copy(this._camera.position).applyMatrix4(_inverse);
    _center.x = Math.round(_center.x / texel) * texel;
    _center.y = Math.round(_center.y / texel) * texel;
    _center.applyMatrix4(_orientation);

    const cam = light.shadow.camera;
    cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
    cam.near = 1;
    cam.far = 2 * radius + 2 * DEPTH_MARGIN;
    cam.updateProjectionMatrix();
    light.position.copy(_center).addScaledVector(direction, -(radius + DEPTH_MARGIN));
    light.target.position.copy(_center);
    light.target.updateMatrixWorld();
    light.updateMatrixWorld();
    light.shadow.normalBias = texel * NORMAL_BIAS_PER_TEXEL;

    fit.center = this._camera.position.clone();
    fit.radius = radius;
  }
}

const _orientation = new THREE.Matrix4();
const _inverse = new THREE.Matrix4();
const _center = new THREE.Vector3();
const _zero = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

/**
 * Turn on the sun's shadows for a track being drawn: the cascades replace the plain sun light,
 * the world's models and the trucks cast, and everything lit receives. `trucks` are the trucks'
 * root objects. Only the middle copy of the wrapped world's models casts.
 *
 * With `natural` ("Natural light", docs/VISUALS.md) the ground casts as well, in every copy of
 * the world, so a cliff shades the canyon under it, and the cascades are drawn in closer, so a
 * truck's shadow is sharp.
 */
export function enableSunShadows({ renderer, scene, camera, world, sun, trucks = [], natural = false }) {
  renderer.shadowMap.enabled = true;
  // Soft-edged shadows (PCFSoft), as JSTrackViewer's scene draws them with its cascades.
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = true;
  const tile = world.getObjectByName("tile");
  world.traverse((o) => {
    if (!o.isMesh || o.name === "sky") return;
    o.receiveShadow = true;
    // The ground is one sheet with nothing under it, and is drawn into the shadow map from behind (three.js's way with a
    // one-sided surface): the slopes turned from the sun cast, and a slope in the sun never shades itself.
    if (natural && o.name === "terrain") o.castShadow = true;
  });
  // Solid things cast, ground boxes among them; water does not, nor does CART Precision Racing's road surface (it would
  // shade itself and the ground it lies on; its walls do), nor do blended (see-through) surfaces. A caster
  // is drawn into the shadow map on the same side it is drawn on, which keeps thin walls from leaking light.
  const casts = (o) => {
    const m = o.material;
    if (!m || (m.transparent && !(m.alphaTest > 0))) return false;
    m.shadowSide = m.side;
    return true;
  };
  tile?.traverse((o) => {
    if (o.isMesh && o.name !== "terrain" && o.name !== "water" && o.name !== "road" && casts(o)) o.castShadow = true;
  });
  // A truck's lamps are light, not things: a beam drawn in the air casts no shadow.
  for (const truck of trucks) truck.traverse((o) => { if (o.isMesh && o.parent?.name !== "lamps") { o.castShadow = true; o.receiveShadow = true; if (o.material) o.material.shadowSide = o.material.side; } });
  // The placed models are instanced over every copy; only the original's instances cast (track-scene.js).
  world.getObjectByName("objects")?.traverse((o) => { if (o.isInstancedMesh) o.castShadow = true; });
  // A facing object (type 8 and 9 billboards) turns to the camera, which would swing its shadow around with the
  // view. Its shadow comes from an invisible copy held square to the sun instead (updateTrackWorld keeps it there).
  world.userData.shadowFacing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(sun.position.x, sun.position.z));
  tile?.traverse((group) => {
    if (group.name !== "placedObject" || !group.userData.billboard) return;
    for (const mesh of [...group.children]) {
      if (!mesh.isMesh) continue;
      mesh.castShadow = false;
      const source = mesh.material;
      const proxy = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({
        map: source.map ?? null, alphaTest: source.alphaTest ?? 0, transparent: !!source.transparent,
        side: THREE.DoubleSide, colorWrite: false, depthWrite: false,
      }));
      proxy.castShadow = true;
      proxy.userData.shadowProxy = true;
      group.add(proxy);
    }
  });
  const shadows = new SunShadows({
    scene, camera, color: sun.color, intensity: sun.intensity,
    ...(natural ? { maxFar: SHADOW_FAR_FT, cascadeEnds: SHADOW_CASCADE_ENDS_FT } : { maxFar: 10240 }),
  });
  shadows.setDirection(sun.position.clone().negate());
  shadows.setEnabled(true);
  sun.visible = false;
  return shadows;
}
