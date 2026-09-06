/** Scene-graph primitives (Blender-free stand-ins for blender_prims). */

import {
  add,
  composeLocal,
  cross,
  len,
  lerp3,
  mat4Mul,
  mulMat4Vec3,
  normalize,
  scale,
  sub,
  v3,
} from "./math.js";

let _id = 0;
function uid(prefix) {
  _id += 1;
  return `${prefix}_${_id}`;
}

export function createNode(partial = {}) {
  const node = {
    id: uid(partial.type || "node"),
    name: partial.name || partial.type || "Object",
    type: partial.type || "empty",
    location: v3(partial.location || [0, 0, 0]),
    rotation: v3(partial.rotation || [0, 0, 0]),
    scale: v3(partial.scale || [1, 1, 1]),
    material: partial.material || null,
    parent: null,
    children: [],
    // geometry payloads
    from: partial.from ? v3(partial.from) : null,
    to: partial.to ? v3(partial.to) : null,
    radius: partial.radius ?? null,
    major: partial.major ?? null,
    minor: partial.minor ?? null,
    points: partial.points ? partial.points.map(v3) : null,
    verts: partial.verts ? partial.verts.map(v3) : null,
    faces: partial.faces || null,
    energy: partial.energy ?? null,
    size: partial.size ?? null,
    color: partial.color || null,
    aim_at: partial.aim_at ? v3(partial.aim_at) : null,
    lens: partial.lens ?? null,
    ortho_scale: partial.ortho_scale ?? null,
    camera_type: partial.camera_type || partial.type_cam || null,
    look_at: partial.look_at ? v3(partial.look_at) : null,
    keyframes: { location: [], rotation: [], look_at: [] },
    solidify: partial.solidify ?? null,
    ...partial,
  };
  // Ensure arrays after spread
  node.location = v3(node.location);
  node.rotation = v3(node.rotation);
  node.scale = v3(node.scale);
  node.children = [];
  node.keyframes = { location: [], rotation: [], look_at: [] };
  return node;
}

export function parentTo(child, parent) {
  if (!child || !parent) return child;
  if (child.parent && child.parent.children) {
    child.parent.children = child.parent.children.filter((c) => c !== child);
  }
  child.parent = parent;
  parent.children.push(child);
  return child;
}

export function empty(name, location = [0, 0, 0]) {
  return createNode({ type: "empty", name, location });
}

export function ell(name, location, scaleV, material) {
  return createNode({ type: "sphere", name, location, scale: scaleV, material });
}

export function box(name, location, scaleV, material, bevel = 0) {
  return createNode({ type: "box", name, location, scale: scaleV, material, bevel });
}

export function rod(name, from, to, radius, material) {
  return createNode({ type: "rod", name, from, to, radius, material, location: [0, 0, 0] });
}

export function torus(name, location, major, minor, material) {
  // Match Blender primitive_torus_add default rotation (π/2, 0, 0) → ring in XZ.
  return createNode({
    type: "torus",
    name,
    location,
    major,
    minor,
    material,
    rotation: [Math.PI / 2, 0, 0],
  });
}

export function path(name, points, radius, material) {
  return createNode({ type: "path", name, points, radius, material, location: [0, 0, 0] });
}

export function mesh(name, verts, faces, material, bevel = 0) {
  return createNode({ type: "mesh", name, verts, faces, material, bevel, location: [0, 0, 0] });
}

export function solidify(obj, thickness) {
  if (obj) obj.solidify = Number(thickness);
}

export function makeCamera(name, location, lookAt, opts = {}) {
  return createNode({
    type: "camera",
    name,
    location,
    look_at: lookAt,
    lens: opts.lens ?? 50,
    ortho_scale: opts.ortho_scale ?? 9.4,
    camera_type: opts.camera_type || "ORTHO",
  });
}

export function area(name, location, energy, size, opts = {}) {
  return createNode({
    type: "light",
    name,
    location,
    energy,
    size,
    color: opts.color || [1, 1, 1],
    aim_at: opts.aim_at || [0, 0, 2.3],
  });
}

export function resolveMaterial(materials, name) {
  if (!name) return { name: "default", color: [0.8, 0.8, 0.8], metallic: 0, roughness: 0.4 };
  if (typeof name === "object") return name;
  if (!materials[name]) throw new Error(`Material not found: ${name}`);
  return materials[name];
}

export function loadMaterialDefs(raw) {
  const out = {};
  for (const [name, spec] of Object.entries(raw || {})) {
    out[name] = {
      name,
      color: spec.color || [0.8, 0.8, 0.8],
      metallic: Number(spec.metallic ?? 0),
      roughness: Number(spec.roughness ?? 0.4),
      emission: spec.emission || null,
    };
  }
  return out;
}

export function woodPlankMaterial() {
  // Base matches Blender Principled color before noise/ramp grain.
  return {
    name: "Sunlit peach timber",
    color: [0.68, 0.37, 0.23],
    metallic: 0,
    roughness: 0.7,
    grain: {
      dark: [0.38, 0.17, 0.085],
      light: [0.78, 0.49, 0.28],
    },
  };
}

export function sunsetSkyMaterial() {
  // Matches Blender sunset_sky_material ColorRamp on Generated Z + Emission 0.8.
  return {
    name: "Sunset sky gradient",
    color: [1, 0.52, 0.28],
    metallic: 0,
    roughness: 1,
    emission: { color: [1, 0.52, 0.28], strength: 0.8 },
    gradient: {
      axis: "z",
      strength: 0.8,
      stops: [
        { t: 0, color: [1, 0.52, 0.28] },
        { t: 0.15, color: [1, 0.71, 0.5] },
        { t: 0.42, color: [0.43, 0.72, 0.8] },
        { t: 1, color: [0.12, 0.42, 0.64] },
      ],
    },
  };
}

export function worldMatrix(node) {
  const chain = [];
  let cur = node;
  while (cur) {
    chain.push(cur);
    cur = cur.parent;
  }
  chain.reverse();
  let m = composeLocal([0, 0, 0], [0, 0, 0], [1, 1, 1]);
  for (const n of chain) {
    m = mat4Mul(m, composeLocal(n.location, n.rotation, n.scale));
  }
  return m;
}

export function worldPoint(node, local = [0, 0, 0]) {
  return mulMat4Vec3(worldMatrix(node), local);
}

/** Expand a node into drawable world-space primitives for the renderer. */
export function expandDrawables(node, materials, out = []) {
  const mat = node.material
    ? typeof node.material === "string"
      ? resolveMaterial(materials, node.material)
      : node.material
    : { color: [0.75, 0.75, 0.75], metallic: 0, roughness: 0.5 };

  const wm = worldMatrix(node);

  if (node.type === "sphere") {
    const c = mulMat4Vec3(wm, [0, 0, 0]);
    out.push({
      kind: "ellipse",
      name: node.name,
      center: c,
      matrix: wm,
      material: mat,
      depth: c[1],
    });
  } else if (node.type === "box") {
    // Unit cube ±0.5; worldMatrix already applies node.scale (matches Blender size=1 cube).
    const corners = [
      [-0.5, -0.5, -0.5],
      [0.5, -0.5, -0.5],
      [0.5, 0.5, -0.5],
      [-0.5, 0.5, -0.5],
      [-0.5, -0.5, 0.5],
      [0.5, -0.5, 0.5],
      [0.5, 0.5, 0.5],
      [-0.5, 0.5, 0.5],
    ].map((p) => mulMat4Vec3(wm, p));
    const faces = [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [2, 3, 7, 6],
      [1, 2, 6, 5],
      [0, 3, 7, 4],
    ];
    // Approximate Blender wood grain: alternate plank face tint by world Y.
    let faceMat = mat;
    if (mat.grain) {
      const gy = Math.abs(Math.sin(corners[0][1] * 7)) * 0.55 + Math.abs(Math.sin(corners[0][0] * 0.35)) * 0.45;
      const gcol = [
        mat.grain.dark[0] + (mat.grain.light[0] - mat.grain.dark[0]) * gy,
        mat.grain.dark[1] + (mat.grain.light[1] - mat.grain.dark[1]) * gy,
        mat.grain.dark[2] + (mat.grain.light[2] - mat.grain.dark[2]) * gy,
      ];
      faceMat = { ...mat, color: gcol };
    }
    for (const f of faces) {
      const verts = f.map((i) => corners[i]);
      const centroid = verts.reduce((a, b) => add(a, b), [0, 0, 0]).map((v) => v / verts.length);
      out.push({ kind: "polygon", name: node.name, verts, material: faceMat, depth: centroid[1] });
    }
  } else if (node.type === "rod" || node.type === "cylinder") {
    // from/to live in the node's local space (identity when parented under a group).
    const f = mulMat4Vec3(wm, node.from || [0, 0, 0]);
    const t = mulMat4Vec3(wm, node.to || [0, 0, 1]);
    out.push({
      kind: "capsule",
      name: node.name,
      from: f,
      to: t,
      radius: node.radius || 0.05,
      material: mat,
      depth: (f[1] + t[1]) / 2,
    });
  } else if (node.type === "torus") {
    const c = mulMat4Vec3(wm, [0, 0, 0]);
    out.push({
      kind: "torus",
      name: node.name,
      center: c,
      major: node.major,
      minor: node.minor,
      material: mat,
      depth: c[1],
      matrix: wm,
    });
  } else if (node.type === "path") {
    const pts = (node.points || []).map((p) => mulMat4Vec3(wm, p));
    if (pts.length >= 2) {
      out.push({
        kind: "tube",
        name: node.name,
        points: pts,
        radius: node.radius || 0.05,
        material: mat,
        depth: pts.reduce((s, p) => s + p[1], 0) / pts.length,
      });
    }
  } else if (node.type === "mesh") {
    let localVerts = (node.verts || []).map((p) => [...p]);
    let localFaces = (node.faces || []).map((f) => [...f]);
    if (node.solidify && localVerts.length && localFaces.length) {
      ({ verts: localVerts, faces: localFaces } = extrudeMesh(localVerts, localFaces, node.solidify));
    }
    if (mat.gradient && mat.gradient.stops && localFaces.length === 1 && localFaces[0].length === 4) {
      // Subdivide sky quad into Z-bands matching Blender ColorRamp.
      pushGradientBands(localVerts, localFaces[0], wm, mat, node.name, out);
    } else {
      const verts = localVerts.map((p) => mulMat4Vec3(wm, p));
      for (const face of localFaces) {
        const fv = face.map((i) => verts[i]);
        const centroid = fv.reduce((a, b) => add(a, b), [0, 0, 0]).map((v) => v / fv.length);
        out.push({ kind: "polygon", name: node.name, verts: fv, material: mat, depth: centroid[1] });
      }
    }
  }

  for (const child of node.children) {
    expandDrawables(child, materials, out);
  }
  return out;
}

function faceNormalLocal(verts, face) {
  const a = verts[face[0]];
  const b = verts[face[1]];
  const c = verts[face[2]];
  return normalize(cross(sub(b, a), sub(c, a)));
}

/** Approximate Blender Solidify: extrude mesh along average face normal. */
function extrudeMesh(verts, faces, thickness) {
  let n = [0, 0, 0];
  for (const f of faces) {
    n = add(n, faceNormalLocal(verts, f));
  }
  n = normalize(n);
  const half = thickness / 2;
  const offA = scale(n, -half);
  const offB = scale(n, half);
  const outVerts = [];
  for (const v of verts) outVerts.push(add(v, offA));
  for (const v of verts) outVerts.push(add(v, offB));
  const nV = verts.length;
  const outFaces = [];
  for (const f of faces) {
    outFaces.push(f.map((i) => i));
    outFaces.push([...f].reverse().map((i) => i + nV));
    for (let i = 0; i < f.length; i++) {
      const a = f[i];
      const b = f[(i + 1) % f.length];
      outFaces.push([a, b, b + nV, a + nV]);
    }
  }
  return { verts: outVerts, faces: outFaces };
}

function sampleGradient(stops, t) {
  if (!stops.length) return [1, 1, 1];
  if (t <= stops[0].t) return [...stops[0].color];
  if (t >= stops[stops.length - 1].t) return [...stops[stops.length - 1].color];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t >= a.t && t <= b.t) {
      const u = (t - a.t) / Math.max(1e-9, b.t - a.t);
      return [
        a.color[0] + (b.color[0] - a.color[0]) * u,
        a.color[1] + (b.color[1] - a.color[1]) * u,
        a.color[2] + (b.color[2] - a.color[2]) * u,
      ];
    }
  }
  return [...stops[stops.length - 1].color];
}

/** Split a vertical quad into horizontal strips colored by Generated-Z ramp. */
function pushGradientBands(localVerts, face, wm, mat, name, out) {
  const corners = face.map((i) => localVerts[i]);
  const zs = corners.map((c) => c[2]);
  const z0 = Math.min(...zs);
  const z1 = Math.max(...zs);
  const zSpan = Math.max(1e-6, z1 - z0);
  const bottom = corners.filter((c) => Math.abs(c[2] - z0) < 1e-6);
  const top = corners.filter((c) => Math.abs(c[2] - z1) < 1e-6);
  if (bottom.length < 2 || top.length < 2) {
    const verts = corners.map((p) => mulMat4Vec3(wm, p));
    out.push({ kind: "polygon", name, verts, material: mat, depth: verts[0][1] });
    return;
  }
  // Order left→right along the horizontal edge.
  bottom.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  top.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const bands = 24;
  const stops = mat.gradient.stops;
  const strength = Number(mat.gradient.strength ?? mat.emission?.strength ?? 0.8);
  for (let i = 0; i < bands; i++) {
    const t0 = i / bands;
    const t1 = (i + 1) / bands;
    const za = z0 + zSpan * t0;
    const zb = z0 + zSpan * t1;
    const lerpEdge = (a, b, z) => {
      const u = (z - z0) / zSpan;
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, z];
    };
    const quad = [
      lerpEdge(bottom[0], top[0], za),
      lerpEdge(bottom[1], top[1], za),
      lerpEdge(bottom[1], top[1], zb),
      lerpEdge(bottom[0], top[0], zb),
    ].map((p) => mulMat4Vec3(wm, p));
    const midT = (t0 + t1) / 2;
    // Blender Generated Z on a 0..16 mesh ≈ (z - z0) / zSpan when object origin is at bottom.
    const col = sampleGradient(stops, midT);
    const bandMat = {
      ...mat,
      color: col,
      emission: { color: col, strength },
      gradient: null,
    };
    const centroid = quad.reduce((a, b) => add(a, b), [0, 0, 0]).map((v) => v / quad.length);
    out.push({ kind: "polygon", name, verts: quad, material: bandMat, depth: centroid[1] });
  }
}

export function sampleTube(points, radius, segments = 6) {
  // Approximate tube as overlapping spheres / capsules for SVG.
  const samples = [];
  for (let i = 0; i < points.length - 1; i++) {
    samples.push({ from: points[i], to: points[i + 1], radius });
  }
  return samples;
}

export function asTuple3(v) {
  return v3(v);
}

// silence unused in bundlers
void add;
void len;
void lerp3;
void normalize;
void scale;
void sub;
void sampleTube;
