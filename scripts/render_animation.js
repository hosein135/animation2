/** d3.js SVG frame renderer — projects scene drawables to SVG, then PNG via resvg. */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import * as d3 from "d3";
import { Resvg } from "@resvg/resvg-js";
import { evaluateAtFrame } from "./actions.js";
import { buildCamera, projectPoint, projectRadius } from "./camera.js";
import { cross, dot, normalize, rgbToHex, shadeColor, sub } from "./math.js";
import { expandDrawables } from "./prims.js";

function bgCss(scene) {
  const c = scene.background_color || [0.39, 0.6, 0.74, 1];
  // Blender world background multiplies RGB by background_strength.
  const s = Number(scene.background_strength ?? 1);
  return rgbToHex([c[0] * s, c[1] * s, c[2] * s]);
}

function lightDirs(ctx) {
  const dirs = [];
  for (const L of ctx.lights || []) {
    const from = L.location;
    const to = L.aim_at || [0, 0, 2.3];
    dirs.push({
      dir: normalize(sub(to, from)),
      energy: Number(L.energy || 500),
      color: L.color || [1, 1, 1],
    });
  }
  if (dirs.length === 0) {
    dirs.push({ dir: normalize([0.4, -0.6, 0.7]), energy: 800, color: [1, 0.9, 0.7] });
  }
  return dirs;
}

function shade(material, normal, lights) {
  const base = material.emission
    ? material.emission.color || material.color
    : material.color || [0.8, 0.8, 0.8];
  if (material.emission) {
    const s = Number(material.emission.strength ?? 1);
    return rgbToHex(shadeColor(base, 0.85 + 0.35 * s));
  }
  let lambert = 0.35;
  for (const L of lights) {
    const ndl = Math.max(0, normal[0] * -L.dir[0] + normal[1] * -L.dir[1] + normal[2] * -L.dir[2]);
    lambert += ndl * Math.min(1.2, L.energy / 900);
  }
  const metal = Number(material.metallic || 0);
  const factor = lerp(0.45, 1.15, Math.min(1.4, lambert) / 1.4) * (1 - metal * 0.15) + metal * 0.25;
  return rgbToHex(shadeColor(base, factor));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function faceNormal(verts) {
  if (verts.length < 3) return [0, -1, 0];
  const e1 = sub(verts[1], verts[0]);
  const e2 = sub(verts[2], verts[0]);
  return normalize(cross(e1, e2));
}

function finite(...vals) {
  return vals.every((v) => Number.isFinite(v));
}

/** Skip geometry that would create empty off-canvas layers (resvg-js panic). */
function onScreen(bounds, W, H, pad = 64) {
  if (!bounds) return false;
  const { minX, minY, maxX, maxY } = bounds;
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return false;
  if (maxX < -pad || maxY < -pad || minX > W + pad || minY > H + pad) return false;
  return true;
}

/**
 * Orthographic silhouette of a unit sphere transformed by mat4 linear part.
 * Returns pixel-space {cx,cy,rx,ry,angleDeg,depth}.
 */
function projectTransformedCircle(cam, wm, radiusX = 1, radiusY = 1) {
  const c = [
    wm[12],
    wm[13],
    wm[14],
  ];
  // Columns 0/1 of linear part scaled by circle radii in local XY.
  const c0 = [wm[0] * radiusX, wm[1] * radiusX, wm[2] * radiusX];
  const c1 = [wm[4] * radiusY, wm[5] * radiusY, wm[6] * radiusY];
  const B00 = dot(cam.right, c0);
  const B01 = dot(cam.right, c1);
  const B10 = dot(cam.up, c0);
  const B11 = dot(cam.up, c1);
  const s00 = B00 * B00 + B01 * B01;
  const s01 = B00 * B10 + B01 * B11;
  const s11 = B10 * B10 + B11 * B11;
  const half = (s00 + s11) / 2;
  const diff = (s00 - s11) / 2;
  const disc = Math.sqrt(Math.max(0, diff * diff + s01 * s01));
  const l1 = Math.max(0, half + disc);
  const l2 = Math.max(0, half - disc);
  const angle = 0.5 * Math.atan2(2 * s01, s00 - s11);
  const px = cam.width / (2 * cam.halfW);
  const p = projectPoint(cam, c);
  return {
    cx: p.x,
    cy: p.y,
    depth: p.depth,
    rx: Math.max(0.5, Math.sqrt(l1) * px),
    ry: Math.max(0.5, Math.sqrt(l2) * px),
    // SVG Y is down → negate camera-plane angle.
    angleDeg: (-angle * 180) / Math.PI,
  };
}

/** Full oriented ellipsoid: unit sphere × mat4 (includes scale + rotation). */
function projectOrientedEllipsoid(cam, wm) {
  // Build 2×3 B = [right,up]^T * M_3x3, then silhouette from B B^T.
  const cols = [
    [wm[0], wm[1], wm[2]],
    [wm[4], wm[5], wm[6]],
    [wm[8], wm[9], wm[10]],
  ];
  const B = [
    [dot(cam.right, cols[0]), dot(cam.right, cols[1]), dot(cam.right, cols[2])],
    [dot(cam.up, cols[0]), dot(cam.up, cols[1]), dot(cam.up, cols[2])],
  ];
  const s00 = B[0][0] ** 2 + B[0][1] ** 2 + B[0][2] ** 2;
  const s01 = B[0][0] * B[1][0] + B[0][1] * B[1][1] + B[0][2] * B[1][2];
  const s11 = B[1][0] ** 2 + B[1][1] ** 2 + B[1][2] ** 2;
  const half = (s00 + s11) / 2;
  const diff = (s00 - s11) / 2;
  const disc = Math.sqrt(Math.max(0, diff * diff + s01 * s01));
  const l1 = Math.max(0, half + disc);
  const l2 = Math.max(0, half - disc);
  const angle = 0.5 * Math.atan2(2 * s01, s00 - s11);
  const px = cam.width / (2 * cam.halfW);
  const center = [wm[12], wm[13], wm[14]];
  const p = projectPoint(cam, center);
  return {
    cx: p.x,
    cy: p.y,
    depth: p.depth,
    rx: Math.max(0.5, Math.sqrt(l1) * px),
    ry: Math.max(0.5, Math.sqrt(l2) * px),
    angleDeg: (-angle * 180) / Math.PI,
  };
}

function drawableElements(drawables, cam, lights) {
  const elems = [];
  const W = cam.width;
  const H = cam.height;

  for (const d of drawables) {
    if (d.kind === "ellipse") {
      const e = d.matrix
        ? projectOrientedEllipsoid(cam, d.matrix)
        : null;
      if (!e) continue;
      if (!finite(e.cx, e.cy, e.depth, e.rx, e.ry)) continue;
      const pad = Math.max(e.rx, e.ry);
      if (!onScreen({ minX: e.cx - pad, minY: e.cy - pad, maxX: e.cx + pad, maxY: e.cy + pad }, W, H)) continue;
      const n = normalize([0.2, -0.8, 0.4]);
      elems.push({
        type: "ellipse",
        depth: e.depth,
        cx: e.cx,
        cy: e.cy,
        rx: e.rx,
        ry: e.ry,
        angleDeg: e.angleDeg || 0,
        fill: shade(d.material, n, lights),
        name: d.name,
      });
    } else if (d.kind === "polygon") {
      const proj = d.verts.map((v) => projectPoint(cam, v));
      if (!proj.every((p) => finite(p.x, p.y, p.depth))) continue;
      const depth = proj.reduce((s, p) => s + p.depth, 0) / proj.length;
      const n = faceNormal(d.verts);
      const xs = proj.map((p) => p.x);
      const ys = proj.map((p) => p.y);
      if (!onScreen({ minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }, W, H)) {
        continue;
      }
      const points = proj.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
      elems.push({
        type: "polygon",
        depth,
        points,
        fill: shade(d.material, n, lights),
        name: d.name,
      });
    } else if (d.kind === "capsule") {
      const a = projectPoint(cam, d.from);
      const b = projectPoint(cam, d.to);
      const r = projectRadius(cam, d.radius, d.from);
      const width = Math.max(1.2, r * 2);
      if (!finite(a.x, a.y, a.depth, b.x, b.y, b.depth, width)) continue;
      const pad = width;
      if (
        !onScreen(
          {
            minX: Math.min(a.x, b.x) - pad,
            minY: Math.min(a.y, b.y) - pad,
            maxX: Math.max(a.x, b.x) + pad,
            maxY: Math.max(a.y, b.y) + pad,
          },
          W,
          H,
        )
      ) {
        continue;
      }
      const n = normalize(sub(d.to, d.from));
      elems.push({
        type: "line",
        depth: (a.depth + b.depth) / 2,
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        stroke: shade(d.material, n, lights),
        width,
        name: d.name,
      });
    } else if (d.kind === "tube") {
      const pts = d.points.map((p) => projectPoint(cam, p));
      if (pts.length < 2 || !pts.every((p) => finite(p.x, p.y, p.depth))) continue;
      const depth = pts.reduce((s, p) => s + p.depth, 0) / pts.length;
      const line = d3.line()
        .x((p) => p.x)
        .y((p) => p.y)
        .curve(d3.curveCatmullRom.alpha(0.5));
      const pathD = line(pts);
      if (!pathD) continue;
      const r = projectRadius(cam, d.radius, d.points[0]);
      const width = Math.max(1, r * 2);
      if (!finite(width)) continue;
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      if (
        !onScreen(
          {
            minX: Math.min(...xs) - width,
            minY: Math.min(...ys) - width,
            maxX: Math.max(...xs) + width,
            maxY: Math.max(...ys) + width,
          },
          W,
          H,
        )
      ) {
        continue;
      }
      elems.push({
        type: "path",
        depth,
        d: pathD,
        stroke: shade(d.material, [0.2, -0.7, 0.4], lights),
        width,
        name: d.name,
      });
    } else if (d.kind === "torus") {
      // Major ring projected as oriented ellipse; stroke width from minor radius.
      const ring = d.matrix
        ? projectTransformedCircle(cam, d.matrix, d.major, d.major)
        : null;
      if (!ring) continue;
      const strokeWidth = Math.max(1.5, projectRadius(cam, d.minor, d.center) * 2);
      if (!finite(ring.cx, ring.cy, ring.depth, ring.rx, ring.ry, strokeWidth)) continue;
      const pad = Math.max(ring.rx, ring.ry) + strokeWidth;
      if (
        !onScreen(
          {
            minX: ring.cx - pad,
            minY: ring.cy - pad,
            maxX: ring.cx + pad,
            maxY: ring.cy + pad,
          },
          W,
          H,
        )
      ) {
        continue;
      }
      elems.push({
        type: "ellipse",
        depth: ring.depth,
        cx: ring.cx,
        cy: ring.cy,
        rx: ring.rx,
        ry: ring.ry,
        angleDeg: ring.angleDeg || 0,
        fill: "none",
        stroke: shade(d.material, [0.1, -0.9, 0.2], lights),
        strokeWidth,
        name: d.name,
      });
    }
  }

  // Far → near (painter's algorithm). Depth is distance along camera forward.
  elems.sort((a, b) => b.depth - a.depth);
  return elems;
}

export function renderSvgString(scene, ctx, frame) {
  evaluateAtFrame(ctx, frame, ctx.interpolationModes || {});
  const camNode = ctx.objects[scene.camera?.name] || ctx.camera;
  const cam = buildCamera(camNode, scene.resolution);
  const lights = lightDirs(ctx);

  const drawables = [];
  for (const root of ctx.roots) {
    expandDrawables(root, ctx.materials, drawables);
  }
  // Also include free-floating registered geometry not under roots (rare)
  const elems = drawableElements(drawables, cam, lights);
  const [W, H] = scene.resolution;
  const bg = bgCss(scene);

  // Build SVG with d3 for path helpers already used; assemble string manually for speed.
  const parts = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="100%" height="100%" fill="${bg}"/>`,
  ];

  // Do not set per-shape opacity: @resvg/resvg-js 2.6.x panics on off-screen
  // isolated layers (geom.rs fit_to_rect unwrap). Solid fills avoid that path.
  for (const e of elems) {
    if (e.type === "ellipse") {
      const rot =
        e.angleDeg && Math.abs(e.angleDeg) > 0.01
          ? ` transform="rotate(${e.angleDeg.toFixed(2)} ${e.cx.toFixed(2)} ${e.cy.toFixed(2)})"`
          : "";
      if (e.fill === "none") {
        parts.push(
          `<ellipse cx="${e.cx.toFixed(2)}" cy="${e.cy.toFixed(2)}" rx="${e.rx.toFixed(2)}" ry="${e.ry.toFixed(2)}" fill="none" stroke="${e.stroke}" stroke-width="${e.strokeWidth.toFixed(2)}" stroke-linecap="round"${rot}/>`,
        );
      } else {
        parts.push(
          `<ellipse cx="${e.cx.toFixed(2)}" cy="${e.cy.toFixed(2)}" rx="${e.rx.toFixed(2)}" ry="${e.ry.toFixed(2)}" fill="${e.fill}"${rot}/>`,
        );
      }
    } else if (e.type === "polygon") {
      parts.push(`<polygon points="${e.points}" fill="${e.fill}" stroke="${e.fill}" stroke-width="0.4"/>`);
    } else if (e.type === "line") {
      parts.push(
        `<line x1="${e.x1.toFixed(2)}" y1="${e.y1.toFixed(2)}" x2="${e.x2.toFixed(2)}" y2="${e.y2.toFixed(2)}" stroke="${e.stroke}" stroke-width="${e.width.toFixed(2)}" stroke-linecap="round"/>`,
      );
    } else if (e.type === "path" && e.d) {
      parts.push(
        `<path d="${e.d}" fill="none" stroke="${e.stroke}" stroke-width="${e.width.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    }
  }

  parts.push(`</svg>`);
  return parts.join("");
}

function frameName(frame, total) {
  const pad = String(total).length;
  return `frame_${String(frame).padStart(Math.max(4, pad), "0")}.png`;
}

export function renderAllFrames(dataDir, outputDir, scene, ctx) {
  const framesDir = join(outputDir, "frames");
  mkdirSync(framesDir, { recursive: true });
  const total = Math.max(1, Math.round(Number(scene.fps) * Number(scene.duration_seconds)));
  const [W, H] = scene.resolution;

  console.log(`==> d3 render: ${total} frames @ ${W}x${H}`);
  const t0 = performance.now();

  for (let frame = 1; frame <= total; frame++) {
    const svg = renderSvgString(scene, ctx, frame);
    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: W },
      background: bgCss(scene),
    });
    const png = resvg.render().asPng();
    const out = join(framesDir, frameName(frame, total));
    writeFileSync(out, png);
    if (frame === 1 || frame === total || frame % Math.max(1, Math.floor(total / 10)) === 0) {
      const pct = ((100 * frame) / total).toFixed(0);
      console.log(`  frame ${frame}/${total} (${pct}%)`);
    }
  }

  const secs = ((performance.now() - t0) / 1000).toFixed(2);
  console.log(`==> Rendered ${total} frames in ${secs}s → ${framesDir}`);
  return { frames: total, framesDir, render_s: Number(secs) };
}
