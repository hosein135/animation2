/** Vec3 / transform helpers for the declarative scene graph. */

export function v3(x = 0, y = 0, z = 0) {
  if (Array.isArray(x)) return [Number(x[0]), Number(x[1]), Number(x[2])];
  return [Number(x), Number(y), Number(z)];
}

export function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function len(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a) {
  const L = len(a) || 1;
  return [a[0] / L, a[1] / L, a[2] / L];
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function lerp3(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** Euler XYZ (radians) → rotate point. Matches Blender XYZ euler order. */
export function rotateEuler(p, euler) {
  const [rx, ry, rz] = euler;
  let [x, y, z] = p;
  // X
  {
    const c = Math.cos(rx);
    const s = Math.sin(rx);
    const ny = y * c - z * s;
    const nz = y * s + z * c;
    y = ny;
    z = nz;
  }
  // Y
  {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const nx = x * c + z * s;
    const nz = -x * s + z * c;
    x = nx;
    z = nz;
  }
  // Z
  {
    const c = Math.cos(rz);
    const s = Math.sin(rz);
    const nx = x * c - y * s;
    const ny = x * s + y * c;
    x = nx;
    y = ny;
  }
  return [x, y, z];
}

export function mulMat4Vec3(m, p, w = 1) {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12] * w;
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13] * w;
  const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14] * w;
  return [x, y, z];
}

export function mat4Identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function mat4Translate(t) {
  const m = mat4Identity();
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  return m;
}

export function mat4Scale(s) {
  const m = mat4Identity();
  m[0] = s[0];
  m[5] = s[1];
  m[10] = s[2];
  return m;
}

export function mat4Euler(euler) {
  const [rx, ry, rz] = euler;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  // R = Rz * Ry * Rx (column-major)
  return [
    cy * cz,
    cy * sz,
    -sy,
    0,
    sx * sy * cz - cx * sz,
    sx * sy * sz + cx * cz,
    sx * cy,
    0,
    cx * sy * cz + sx * sz,
    cx * sy * sz - sx * cz,
    cx * cy,
    0,
    0,
    0,
    0,
    1,
  ];
}

export function mat4Mul(a, b) {
  const out = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function composeLocal(location, rotation, scaleV) {
  return mat4Mul(
    mat4Translate(location || [0, 0, 0]),
    mat4Mul(mat4Euler(rotation || [0, 0, 0]), mat4Scale(scaleV || [1, 1, 1])),
  );
}

/** Look-at orientation: Blender camera tracks -Z, up Y. */
export function lookAtEuler(eye, target) {
  const forward = normalize(sub(target, eye)); // desired -Z in camera space → world
  // Camera looks along -Z, so world forward for -Z is `forward`.
  let up = [0, 0, 1];
  if (Math.abs(dot(forward, up)) > 0.95) up = [0, 1, 0];
  const right = normalize(cross(forward, up));
  up = normalize(cross(right, forward));
  // Build rotation matrix columns = right, up, -forward (camera basis in world)
  // Convert to euler XYZ approximately via matrix.
  const m = [
    right[0],
    right[1],
    right[2],
    up[0],
    up[1],
    up[2],
    -forward[0],
    -forward[1],
    -forward[2],
  ];
  const sy = Math.hypot(m[0], m[1]);
  let x, y, z;
  if (sy > 1e-6) {
    x = Math.atan2(m[5], m[8]);
    y = Math.atan2(-m[2], sy);
    z = Math.atan2(m[1], m[0]);
  } else {
    x = Math.atan2(-m[7], m[4]);
    y = Math.atan2(-m[2], sy);
    z = 0;
  }
  return [x, y, z];
}

export function rgbToHex(color) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  const r = clamp(color[0]);
  const g = clamp(color[1]);
  const b = clamp(color[2]);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

export function shadeColor(color, factor) {
  const f = Math.max(0.15, Math.min(1.35, factor));
  return [color[0] * f, color[1] * f, color[2] * f];
}

/** Seeded PRNG (mulberry32). */
export function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
