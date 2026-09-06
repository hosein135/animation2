/** Scene-graph primitives (Blender-free stand-ins for blender_prims). */

import {
  add,
  composeLocal,
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
    keyframes: { location: [], rotation: [] },
    ...partial,
  };
  // Ensure arrays after spread
  node.location = v3(node.location);
  node.rotation = v3(node.rotation);
  node.scale = v3(node.scale);
  node.children = [];
  node.keyframes = { location: [], rotation: [] };
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
  return createNode({ type: "torus", name, location, major, minor, material });
}

export function path(name, points, radius, material) {
  return createNode({ type: "path", name, points, radius, material, location: [0, 0, 0] });
}

export function mesh(name, verts, faces, material, bevel = 0) {
  return createNode({ type: "mesh", name, verts, faces, material, bevel, location: [0, 0, 0] });
}

export function solidify(_obj, _thickness) {
  // Visual thickness approximated at render time for meshes; no-op here.
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
  return {
    name: "Sunlit peach timber",
    color: [0.86, 0.58, 0.36],
    metallic: 0,
    roughness: 0.7,
  };
}

export function sunsetSkyMaterial() {
  return {
    name: "Sunset sky gradient",
    color: [0.95, 0.55, 0.35],
    metallic: 0,
    roughness: 1,
    emission: { color: [1, 0.55, 0.25], strength: 0.6 },
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
    const sx = Math.abs(node.scale[0]);
    const sy = Math.abs(node.scale[1]);
    const sz = Math.abs(node.scale[2]);
    out.push({
      kind: "ellipse",
      name: node.name,
      center: c,
      radii: [sx, sy, sz],
      material: mat,
      depth: c[1],
    });
  } else if (node.type === "box") {
    const hx = node.scale[0] / 2;
    const hy = node.scale[1] / 2;
    const hz = node.scale[2] / 2;
    const corners = [
      [-hx, -hy, -hz],
      [hx, -hy, -hz],
      [hx, hy, -hz],
      [-hx, hy, -hz],
      [-hx, -hy, hz],
      [hx, -hy, hz],
      [hx, hy, hz],
      [-hx, hy, hz],
    ].map((p) => mulMat4Vec3(wm, p));
    const faces = [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [2, 3, 7, 6],
      [1, 2, 6, 5],
      [0, 3, 7, 4],
    ];
    for (const f of faces) {
      const verts = f.map((i) => corners[i]);
      const centroid = verts.reduce((a, b) => add(a, b), [0, 0, 0]).map((v) => v / verts.length);
      out.push({ kind: "polygon", name: node.name, verts, material: mat, depth: centroid[1] });
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
    const verts = (node.verts || []).map((p) => mulMat4Vec3(wm, p));
    for (const face of node.faces || []) {
      const fv = face.map((i) => verts[i]);
      const centroid = fv.reduce((a, b) => add(a, b), [0, 0, 0]).map((v) => v / fv.length);
      out.push({ kind: "polygon", name: node.name, verts: fv, material: mat, depth: centroid[1] });
    }
  }

  for (const child of node.children) {
    expandDrawables(child, materials, out);
  }
  return out;
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
