/*
  Geometry for the headset's cab (render/xr/vr-cab.js): triangles gathered per material, so the
  whole cage is a handful of draw calls, and the few shapes it is made of. A tube's seam faces
  away from the eyes, so a texture wrapped around it puts its middle row toward the driver.
*/
import * as THREE from "three";

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _normal = new THREE.Matrix3();
/** Where the baked shading's light comes from, the cab's frame: above and ahead, through the windscreen. */
const KEY_LIGHT = new THREE.Vector3(0.25, 0.75, -0.6).normalize();

/** Triangles for one material: positions, texture coordinates and, with `colors`, a colour per vertex. */
export class Soup {
  constructor({ colors = false } = {}) {
    this.positions = [];
    this.uvs = [];
    this.colors = colors ? [] : null;
    this.indices = [];
  }

  get empty() { return this.indices.length === 0; }
  get count() { return this.positions.length / 3; }

  /** One vertex; returns its index. `color` is linear `[r, g, b]`. */
  vertex(x, y, z, u = 0, v = 0, color = null) {
    this.positions.push(x, y, z);
    this.uvs.push(u, v);
    if (this.colors) this.colors.push(color?.[0] ?? 1, color?.[1] ?? 1, color?.[2] ?? 1);
    return this.count - 1;
  }

  /**
   * A three.js geometry, placed by `matrix`. `color` tints it (linear `[r, g, b]`), `shade`
   * (0 to 1) bakes a light from above and ahead into the colour, `uv(x, y, z)` gives each
   * placed vertex its texture coordinates instead of the geometry's own, and `after` moves
   * the piece once those are taken. The geometry is disposed of.
   */
  add(geometry, matrix = null, { color = null, shade = 0, uv = null, after = null } = {}) {
    const position = geometry.getAttribute("position"), normal = geometry.getAttribute("normal"), own = geometry.getAttribute("uv");
    const base = this.count;
    if (matrix) _normal.getNormalMatrix(matrix);
    for (let i = 0; i < position.count; i++) {
      _v.fromBufferAttribute(position, i);
      if (matrix) _v.applyMatrix4(matrix);
      let c = color;
      if (this.colors && shade > 0 && normal) {
        _n.fromBufferAttribute(normal, i);
        if (matrix) _n.applyMatrix3(_normal).normalize();
        const k = 1 - shade + shade * (0.5 + 0.5 * _n.dot(KEY_LIGHT));
        c = [(color?.[0] ?? 1) * k, (color?.[1] ?? 1) * k, (color?.[2] ?? 1) * k];
      }
      const [u, v] = uv ? uv(_v.x, _v.y, _v.z) : own ? [own.getX(i), own.getY(i)] : [0, 0];
      if (after) _v.applyMatrix4(after);
      this.vertex(_v.x, _v.y, _v.z, u, v, c);
    }
    const index = geometry.getIndex();
    if (index) for (let i = 0; i < index.count; i++) this.indices.push(base + index.getX(i));
    else for (let i = 0; i < position.count; i++) this.indices.push(base + i);
    geometry.dispose();
    return this;
  }

  /** The gathered triangles as one geometry. */
  build() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    if (this.colors) geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(this.indices);
    return geometry;
  }
}

const _t = new THREE.Vector3(), _e = new THREE.Vector3(), _f = new THREE.Vector3(), _m = new THREE.Vector3();

/**
 * A tube from `a` to `b` (Vector3s, the cab's frame). Its texture runs `tile` times per foot
 * along it and `turns` times around it (once unless told), the middle row (v = 0.5) on the side toward the eyes at the
 * origin. `rings` shapes it: `[along, scale]` pairs, `along` 0 to 1 and `scale` of the radius
 * (two rings, the plain tube, when absent). `caps` closes the ends. `color` tints every vertex
 * (linear), and `around(cos)` scales the tint by where a vertex sits around the tube: 1 toward
 * the eyes, -1 away.
 */
export function addTube(soup, a, b, radius, { radial = 10, tile = 1, turns = 1, rings = null, caps = false, color = null, around = null } = {}) {
  _t.subVectors(b, a);
  const length = _t.length();
  if (!(length > 1e-6)) return;
  _t.divideScalar(length);
  // Toward the eyes, square to the tube; any square direction when the tube points at them.
  _m.addVectors(a, b).multiplyScalar(-0.5);
  _e.copy(_m).addScaledVector(_t, -_m.dot(_t));
  if (_e.lengthSq() < 1e-8) _e.set(Math.abs(_t.y) < 0.9 ? 0 : 1, Math.abs(_t.y) < 0.9 ? 1 : 0, 0).addScaledVector(_t, -_t.y);
  _e.normalize();
  _f.crossVectors(_t, _e);
  const shape = rings ?? [[0, 1], [1, 1]];
  const base = soup.count;
  for (const [along, scale] of shape) {
    for (let k = 0; k <= radial; k++) {
      const angle = (k / radial - 0.5) * Math.PI * 2, cos = Math.cos(angle), sin = Math.sin(angle), r = radius * scale;
      const shade = around ? around(cos) : 1;
      soup.vertex(
        a.x + _t.x * length * along + (_e.x * cos + _f.x * sin) * r,
        a.y + _t.y * length * along + (_e.y * cos + _f.y * sin) * r,
        a.z + _t.z * length * along + (_e.z * cos + _f.z * sin) * r,
        length * along * tile, k / radial * turns,
        color || around ? [(color?.[0] ?? 1) * shade, (color?.[1] ?? 1) * shade, (color?.[2] ?? 1) * shade] : null);
    }
  }
  const row = radial + 1;
  for (let j = 0; j + 1 < shape.length; j++) {
    for (let k = 0; k < radial; k++) {
      const p = base + j * row + k, q = p + row;
      soup.indices.push(p, q, p + 1, p + 1, q, q + 1);
    }
  }
  if (caps) {
    for (const [j, along] of [[0, shape[0][0]], [shape.length - 1, shape[shape.length - 1][0]]]) {
      const shade = around ? around(0) : 1;
      const centre = soup.vertex(a.x + _t.x * length * along, a.y + _t.y * length * along, a.z + _t.z * length * along, length * along * tile, 0.5,
        color || around ? [(color?.[0] ?? 1) * shade, (color?.[1] ?? 1) * shade, (color?.[2] ?? 1) * shade] : null);
      for (let k = 0; k < radial; k++) soup.indices.push(centre, base + j * row + k, base + j * row + k + 1);
    }
  }
}

/**
 * A four-cornered sheet, corners in order around it, cut into `n` by `n`. `uv(x, y, z)` gives
 * each vertex its texture coordinates; without it the texture repeats every `tile` feet along
 * the sheet's first and last edges.
 */
export function addSheet(soup, corners, { uv = null, tile = 1, n = 1, color = null } = {}) {
  const [a, b, c, d] = corners;
  const across = a.distanceTo(b), down = a.distanceTo(d);
  const base = soup.count;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const s = i / n, t = j / n;
      const x = (a.x * (1 - s) + b.x * s) * (1 - t) + (d.x * (1 - s) + c.x * s) * t;
      const y = (a.y * (1 - s) + b.y * s) * (1 - t) + (d.y * (1 - s) + c.y * s) * t;
      const z = (a.z * (1 - s) + b.z * s) * (1 - t) + (d.z * (1 - s) + c.z * s) * t;
      const [u, v] = uv ? uv(x, y, z) : [s * across / tile, -t * down / tile];
      soup.vertex(x, y, z, u, v, color);
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const p = base + j * (n + 1) + i, q = p + n + 1;
      soup.indices.push(p, q, p + 1, p + 1, q, q + 1);
    }
  }
}

/** A flat triangle. */
export function addTriangle(soup, [a, b, c], color = null) {
  const base = soup.count;
  for (const p of [a, b, c]) soup.vertex(p.x, p.y, p.z, 0, 0, color);
  soup.indices.push(base, base + 1, base + 2);
}

/** A canvas drawn once, as a texture. */
export function canvasTexture(width, height, draw) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d"), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The look of a round tube, baked: a strip one pixel wide whose rows run around the tube, the
 * middle row toward the eyes. `stops` are `[across, level]` pairs, `across` from -1 at one
 * edge of the tube as seen to 1 at the other, `level` 0 to 255; the far side repeats the near.
 */
export function tubeTexture(stops, rows = 128) {
  const texture = canvasTexture(1, rows, (g) => {
    for (let j = 0; j < rows; j++) {
      // Row j is at this angle from the side toward the eyes, and shows this far across the tube.
      const across = Math.sin(((j + 0.5) / rows - 0.5) * Math.PI * 2);
      let level = stops[stops.length - 1][1];
      for (let i = 0; i + 1 < stops.length; i++) {
        const [x0, l0] = stops[i], [x1, l1] = stops[i + 1];
        if (across >= x0 && across <= x1) { level = l0 + (l1 - l0) * (across - x0) / (x1 - x0 || 1); break; }
      }
      const c = Math.round(level);
      g.fillStyle = `rgb(${c},${c},${c})`;
      g.fillRect(0, j, 1, 1);
    }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** A repeatable stream of numbers from 0 up to 1 (mulberry32), so a drawn texture is the same every time. */
function stream(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A square texture that repeats, drawn pixel by pixel: `paint(x, y, random)` returns `[r, g, b]`, 0 to 255. */
function grainTexture(size, seed, paint) {
  const random = stream(seed);
  const texture = canvasTexture(size, size, (g) => {
    const image = g.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const [r, gr, b] = paint(x, y, random), i = (y * size + x) * 4;
        image.data[i] = r;
        image.data[i + 1] = gr;
        image.data[i + 2] = b;
        image.data[i + 3] = 255;
      }
    }
    g.putImageData(image, 0, 0);
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/*
  The cab's plain surfaces, drawn to look like the pictures' (docs/VR.md gives the colours
  sampled off them): the padding's black foam with its grey speckle, the dark tread plate with
  its pale diamond scratches, the same plate where the light catches it, and the headliner's
  grey carpet with its weave running across.
*/
export function foamTexture() {
  return grainTexture(128, 11, (x, y, random) => {
    const level = 15 + random() ** 5 * 78;
    return [level, level, level - 1];
  });
}

/** How near a pixel is to a line of the tread's diamonds: 0 on a line. */
function diamond(x, y, period) {
  const a = ((x + y * 0.55) % period + period) % period, b = ((x - y * 0.55) % period + period) % period;
  return Math.min(a, period - a, b, period - b);
}

export function treadTexture() {
  return grainTexture(128, 23, (x, y, random) => {
    const line = diamond(x + Math.sin(y * 0.2) * 2, y, 32), grain = random();
    const level = 12 + grain * 8 + Math.max(0, 1.6 - line) * (10 + grain * 16);
    return [level, level * 1.06, level * 1.1];
  });
}

export function plateTexture() {
  return grainTexture(128, 37, (x, y, random) => {
    const line = diamond(x, y, 32), grain = random();
    const level = 88 + grain * 58 + Math.max(0, 1.6 - line) * 30;
    return [Math.min(255, level * 1.04), level * 0.97, Math.min(255, level * 1.02)];
  });
}

export function carpetTexture() {
  let run = 0, level = 90;
  return grainTexture(128, 51, (x, y, random) => {
    if (run-- <= 0 || x === 0) {
      run = 2 + Math.floor(random() * 8);
      level = 66 + random() * 50;
    }
    const l = level + random() * 10;
    return [l, l, l * 1.07];
  });
}
