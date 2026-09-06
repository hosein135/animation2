/** Orthographic camera projection (Blender Z-up → SVG). */

import { cross, normalize, sub, v3 } from "./math.js";

export function buildCamera(camNode, resolution, orthoScaleOverride = null) {
  const eye = v3(camNode.location);
  const target = v3(camNode.look_at || [0, 0.6, 2.7]);
  const forward = normalize(sub(target, eye));
  let up = [0, 0, 1];
  if (Math.abs(forward[0] * up[0] + forward[1] * up[1] + forward[2] * up[2]) > 0.95) {
    up = [0, 1, 0];
  }
  const right = normalize(cross(forward, up));
  up = normalize(cross(right, forward));

  const [W, H] = resolution;
  const ortho = Number(orthoScaleOverride ?? camNode.ortho_scale ?? 9.4);
  // Blender ortho_scale is the larger visible dimension (sensor fit).
  const aspect = W / H;
  let halfW;
  let halfH;
  if (aspect >= 1) {
    halfW = ortho / 2;
    halfH = halfW / aspect;
  } else {
    halfH = ortho / 2;
    halfW = halfH * aspect;
  }

  return {
    eye,
    target,
    forward,
    right,
    up,
    halfW,
    halfH,
    width: W,
    height: H,
  };
}

/** Project world point → {x, y, depth} in SVG pixels (y down). */
export function projectPoint(cam, p) {
  const rel = sub(p, cam.eye);
  const x = rel[0] * cam.right[0] + rel[1] * cam.right[1] + rel[2] * cam.right[2];
  const y = rel[0] * cam.up[0] + rel[1] * cam.up[1] + rel[2] * cam.up[2];
  const z = rel[0] * cam.forward[0] + rel[1] * cam.forward[1] + rel[2] * cam.forward[2];
  const sx = ((x / cam.halfW) * 0.5 + 0.5) * cam.width;
  const sy = (0.5 - (y / cam.halfH) * 0.5) * cam.height;
  return { x: sx, y: sy, depth: z };
}

export function projectRadius(cam, worldRadius, atPoint) {
  // Uniform scale: world unit → pixels
  const pxPerUnit = cam.width / (2 * cam.halfW);
  return worldRadius * pxPerUnit;
}
