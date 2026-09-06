/** Declarative scene builder — loads materials, objects JSON, and actions. */

import { readFileSync } from "fs";
import { join } from "path";
import { applyActions, collectInterpolationModes } from "./actions.js";
import { runFactory } from "./factories.js";
import * as P from "./prims.js";

export function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadMaterials(dataDir) {
  const path = join(dataDir, "materials.json");
  try {
    return P.loadMaterialDefs(loadJson(path));
  } catch {
    return {};
  }
}

function register(ctx, obj) {
  if (!obj) return null;
  ctx.objects[obj.name] = obj;
  return obj;
}

export function spawnNode(node, materials, ctx, dataDir, parent = null) {
  if (node.ref) {
    const refPath = join(dataDir, "objects", `${node.ref}.json`);
    const loaded = loadJson(refPath);
    const merged = { ...loaded, ...Object.fromEntries(Object.entries(node).filter(([k]) => k !== "ref")) };
    if (!node.children && loaded.children) merged.children = loaded.children;
    return spawnNode(merged, materials, ctx, dataDir, parent);
  }

  const ntype = node.type || "group";
  const name = node.name || ntype;
  const loc = node.location ? P.asTuple3(node.location) : [0, 0, 0];

  let obj = null;

  if (ntype === "group" || ntype === "empty") {
    obj = P.empty(name, loc);
  } else if (ntype === "sphere") {
    const mat = P.resolveMaterial(materials, node.material);
    obj = P.ell(name, loc, node.scale || [1, 1, 1], mat);
    if (node.rotation) obj.rotation = P.asTuple3(node.rotation);
  } else if (ntype === "box") {
    const mat = P.resolveMaterial(materials, node.material);
    obj = P.box(name, loc, node.scale || [1, 1, 1], mat, Number(node.bevel ?? 0.04));
    if (node.rotation) obj.rotation = P.asTuple3(node.rotation);
  } else if (ntype === "cylinder" || ntype === "rod") {
    const mat = P.resolveMaterial(materials, node.material);
    obj = P.rod(name, node.from, node.to, Number(node.radius), mat);
  } else if (ntype === "torus") {
    const mat = P.resolveMaterial(materials, node.material);
    obj = P.torus(name, loc, Number(node.major), Number(node.minor), mat);
  } else if (ntype === "path") {
    const mat = P.resolveMaterial(materials, node.material);
    obj = P.path(name, node.points.map(P.asTuple3), Number(node.radius), mat);
  } else if (ntype === "mesh") {
    const mat = P.resolveMaterial(materials, node.material);
    obj = P.mesh(
      name,
      node.verts.map(P.asTuple3),
      node.faces,
      mat,
      Number(node.bevel ?? 0.06),
    );
    if (node.solidify != null) P.solidify(obj, Number(node.solidify));
  } else if (ntype === "camera") {
    obj = P.makeCamera(name, node.location || loc, node.look_at || [0, 0, 0], {
      lens: Number(node.lens ?? 50),
      ortho_scale: node.ortho_scale,
      camera_type: String(node.camera_type || (node.ortho_scale != null ? "ORTHO" : "PERSP")),
    });
  } else if (ntype === "light") {
    obj = P.area(name, loc, Number(node.energy ?? 500), Number(node.size ?? 4), {
      color: node.color,
      aim_at: node.aim_at || [0, 0, 2.3],
    });
  } else if (ntype === "factory") {
    const fname = node.factory || node.name;
    const params = { ...(node.params || {}) };
    params.name = params.name || name;
    obj = runFactory(fname, params, materials, parent, ctx);
    if (obj && name && obj.name !== name) obj.name = name;
    register(ctx, obj);
    for (const child of node.children || []) {
      spawnNode(child, materials, ctx, dataDir, obj ?? parent);
    }
    return obj;
  } else if (ntype === "instance") {
    return spawnNode(
      { ref: node.object, ...Object.fromEntries(Object.entries(node).filter(([k]) => k !== "type" && k !== "object")) },
      materials,
      ctx,
      dataDir,
      parent,
    );
  } else {
    throw new Error(`Unknown object type: ${ntype}`);
  }

  register(ctx, obj);
  if (parent && obj) P.parentTo(obj, parent);

  for (const child of node.children || []) {
    spawnNode(child, materials, ctx, dataDir, obj);
  }
  return obj;
}

export function buildScene(dataDir, scene) {
  const materials = loadMaterials(dataDir);
  const fps = Number(scene.fps);
  const duration = Number(scene.duration_seconds);
  const frameEnd = Math.max(1, Math.round(fps * duration));

  const ctx = {
    objects: {},
    materials,
    frame_end: frameEnd,
    fps,
    camera: null,
    lights: [],
    roots: [],
  };

  // Camera
  if (scene.camera) {
    const cam = P.makeCamera(
      scene.camera.name || "Camera",
      scene.camera.location,
      scene.camera.look_at || [0, 0, 0],
      {
        lens: scene.camera.lens,
        ortho_scale: scene.camera.ortho_scale,
        camera_type: scene.camera.type || "ORTHO",
      },
    );
    register(ctx, cam);
    ctx.camera = cam;
  }

  // Lights
  for (const light of scene.lights || []) {
    const L = spawnNode({ ...light, type: light.type || "light" }, materials, ctx, dataDir, null);
    if (L) ctx.lights.push(L);
  }

  // Objects
  for (const placement of scene.objects || []) {
    const root = spawnNode(placement, materials, ctx, dataDir, null);
    if (root) ctx.roots.push(root);
  }

  applyActions(scene.actions || [], ctx);
  ctx.interpolationModes = collectInterpolationModes(scene.actions || []);

  return ctx;
}
