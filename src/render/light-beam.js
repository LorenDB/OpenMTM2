/*
  A beam of light in the air, as JSTrackViewer's truck light rig draws it (src/drive/truck-lights.js there, from
  JSTruckViewer): an open cone of 24 sides with a fuzz texture repeated around and along it, brightest at the source and
  fading to nothing at the rim and toward its edges as seen, added to the view. Truck lamps and track lights share it.
  Being light added to the view, a beam is dimmed by the fog between it and the eye (render/atmosphere.js).
*/
import * as THREE from "three";
import { VEIL_GLSL, veilUniforms } from "./atmosphere.js";

export const BEAM_INTENSITY = 0.14, BEAM_SIDES = 24, BEAM_TEXTURE_FEET = 12, BEAM_TEXTURE_AROUND = 2;
export const BEAM_AXIS = new THREE.Vector3(0, 0, 1);

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying float vFacing, vSeen;
  ${VEIL_GLSL}
  void main() {
    vUv = uv;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vec3 viewNormal = normalize(normalMatrix * normal);
    vFacing = abs(dot(viewNormal, normalize(-viewPosition.xyz)));
    vSeen = 1.0 - mtmFogVeil(viewPosition.xyz).a;
    gl_Position = projectionMatrix * viewPosition;
  }
`;
const FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  uniform vec2 repeat;
  uniform float intensity;
  uniform vec3 tint;
  varying vec2 vUv;
  varying float vFacing, vSeen;
  void main() {
    vec3 fuzz = texture2D(map, vUv * repeat).rgb * tint;
    float along = pow(max(1.0 - vUv.y, 0.0), 2.2);
    // (Kept in range: where the picture has several samples a point, a point just off an edge has these a hair out of it,
    // and a power of a number below nothing is not a number, which draws as a black speck along the cone's outline.)
    float edge = pow(max(vFacing, 0.0), 1.5);
    gl_FragColor = vec4(fuzz * intensity * along * edge * vSeen, 1.0);
    #include <colorspace_fragment>
  }
`;

/** An open cone from the source (`base` radius) to the rim (`rim` radius at `length`), laid along +z from the origin. */
export function beamGeometry(length, base, rim) {
  const geometry = new THREE.CylinderGeometry(Math.max(rim, 0.01), Math.max(base, 0.01), length, BEAM_SIDES, 1, true);
  geometry.translate(0, length / 2, 0);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

const white = (() => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
})();

/** The beam's material: `map` the fuzz (white when null), its `uniforms.intensity` and `uniforms.tint` set per frame. */
export function beamMaterial(map, length, tint = [1, 1, 1]) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...veilUniforms(),
      map: { value: map ?? white },
      repeat: { value: new THREE.Vector2(BEAM_TEXTURE_AROUND, Math.max(1, length / BEAM_TEXTURE_FEET)) },
      intensity: { value: BEAM_INTENSITY },
      tint: { value: new THREE.Color(tint[0], tint[1], tint[2]) },
    },
    vertexShader: VERTEX, fragmentShader: FRAGMENT,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
  });
}

/*
  A beam as light in the air (docs/VISUALS.md, "Lamps"), with "Truck lamps". The cone above is a
  skin with a picture of fuzz on it: seen from the side it has edges, and seen along its length
  it is two overlapping sheets. This is the same frustum drawn as what fills it. For each point
  of the picture the line of sight is followed through the frustum, and what the light does to
  the air along it is summed: brightest on the beam's axis and fading to its sides, strongest by
  the lamp, gone by the beam's end. So a beam has no edge and no surface, it is brighter looked
  along than across, and where the eye is inside it the air glows round the eye.

  It is light added to the picture, so the fog dims it by what lies between it and the eye. How
  much there is in the air to show it at all is the caller's to say (`uniforms.intensity`).
*/
export const SHAFT_INTENSITY = 0.2;
const SHAFT_STEPS = 10;

const SHAFT_VERTEX = /* glsl */ `
  varying vec3 vLocal;
  varying float vSeen;
  ${VEIL_GLSL}
  void main() {
    vLocal = position;
    vec4 viewPosition = modelViewMatrix * vec4( position, 1.0 );
    vSeen = 1.0 - mtmFogVeil( viewPosition.xyz ).a;
    gl_Position = projectionMatrix * viewPosition;
  }
`;
const SHAFT_FRAGMENT = /* glsl */ `
  // the eye in the beam's own frame (the lamp at its origin, the beam along +z)
  uniform vec3 eye;
  // the beam's length, its radius at the lamp and at its end, and 1 when the eye is inside it
  uniform vec4 shape;
  uniform float intensity;
  uniform vec3 tint;
  varying vec3 vLocal;
  varying float vSeen;
  void main() {
    // From outside, the faces toward the eye are where a line of sight enters; from inside, the far ones are where it leaves.
    if ( gl_FrontFacing == ( shape.w > 0.5 ) ) discard;
    vec3 way = normalize( vLocal - eye );
    float len = shape.x, near = shape.y, widen = ( shape.z - shape.y ) / shape.x;
    // The stretch of the line that lies between the lamp's own plane and the beam's end...
    float from = 0.0, to = 1e6;
    if ( abs( way.z ) > 1e-5 ) {
      float a = - eye.z / way.z, b = ( len - eye.z ) / way.z;
      from = max( from, min( a, b ) );
      to = min( to, max( a, b ) );
    }
    // ...and, where the line crosses the cone, inside it. (A line that runs along the beam more closely than the
    // cone's own side is inside it from where it enters to where the beam ends.)
    float wide = near + widen * eye.z;
    float A = dot( way.xy, way.xy ) - widen * widen * way.z * way.z;
    float B = 2.0 * ( dot( eye.xy, way.xy ) - widen * wide * way.z );
    float C = dot( eye.xy, eye.xy ) - wide * wide;
    float inside = B * B - 4.0 * A * C;
    if ( A > 1e-6 ) {
      if ( inside <= 0.0 ) discard;
      float root = sqrt( inside );
      from = max( from, ( - B - root ) / ( 2.0 * A ) );
      to = min( to, ( - B + root ) / ( 2.0 * A ) );
    }
    if ( to <= from ) discard;
    // The places summed are shifted from point to point of the picture, which trades their steps for a fine grain.
    float shift = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
    float lit = 0.0;
    for ( int i = 0; i < ${SHAFT_STEPS}; i ++ ) {
      vec3 p = eye + way * ( from + ( to - from ) * ( float( i ) + shift ) / ${SHAFT_STEPS}.0 );
      float radius = near + widen * p.z;
      float across = max( 1.0 - dot( p.xy, p.xy ) / ( radius * radius ), 0.0 );
      // Thinner as the beam spreads, and gone by its end.
      lit += across * across * pow( near / radius, 1.25 ) * ( 1.0 - smoothstep( 0.25, 0.95, p.z / len ) ) * step( 0.0, p.z );
    }
    lit *= ( to - from ) / ${SHAFT_STEPS}.0;
    gl_FragColor = vec4( tint * ( intensity * vSeen * ( 1.0 - exp( - lit ) ) ), 1.0 );
    #include <colorspace_fragment>
  }
`;

/** The beam's frustum, closed at both ends, from the lamp (`base` radius) along +z to its end (`rim` radius at `length`). */
export function shaftGeometry(length, base, rim) {
  const geometry = new THREE.CylinderGeometry(Math.max(rim, 0.01), Math.max(base, 0.01), length, BEAM_SIDES, 1, false);
  geometry.translate(0, length / 2, 0);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

/** The material of a beam as light in the air; `uniforms.intensity` is set by the caller, `eye` and `shape.w` by `aimShaft`. */
export function shaftMaterial(length, base, rim, tint = [1, 1, 1]) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...veilUniforms(),
      eye: { value: new THREE.Vector3() }, shape: { value: new THREE.Vector4(length, Math.max(base, 0.01), Math.max(rim, 0.01), 0) },
      intensity: { value: SHAFT_INTENSITY }, tint: { value: new THREE.Color(tint[0], tint[1], tint[2]) },
    },
    vertexShader: SHAFT_VERTEX, fragmentShader: SHAFT_FRAGMENT,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
  });
}

const _eye = new THREE.Vector3(), _inverse = new THREE.Matrix4();
/** Once a frame for a beam that is shown: tell its material where the eye is (`eyeWorld`, the scene's axes). */
export function aimShaft(mesh, eyeWorld) {
  mesh.updateWorldMatrix(true, false);
  _eye.copy(eyeWorld).applyMatrix4(_inverse.copy(mesh.matrixWorld).invert());
  const { eye, shape } = mesh.material.uniforms;
  eye.value.copy(_eye);
  const radius = shape.value.y + ((shape.value.z - shape.value.y) / shape.value.x) * _eye.z;
  shape.value.w = _eye.z > 0 && _eye.z < shape.value.x && Math.hypot(_eye.x, _eye.y) < radius ? 1 : 0;
}
