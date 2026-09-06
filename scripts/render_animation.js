/** d3.js SVG frame renderer — projects scene drawables to SVG, then PNG via resvg. */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import * as d3 from "d3";
import { Resvg } from "@resvg/resvg-js";
import { evaluateAtFrame } from "./actions.js";
import { buildCamera, projectPoint, projectRadius } from "./camera.js";
import { cross, normalize, rgbToHex, shadeColor, sub } from "./math.js";
import { expandDrawables } from "./prims.js";

function bgCss(scene) {
  const c = scene.background_color || [0.39, 0.6, 0.74, 1];
  return rgbToHex(c);
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

function drawableElements(drawables, cam, lights) {
  const elems = [];
  const W = cam.width;
  const H = cam.height;

  for (const d of drawables) {
    if (d.kind === "ellipse") {
      const p = projectPoint(cam, d.center);
      const rx = Math.max(1, projectRadius(cam, d.radii[0], d.center));
      const ry = Math.max(1, projectRadius(cam, Math.max(d.radii[1], d.radii[2]) * 0.85, d.center));
      if (!finite(p.x, p.y, p.depth, rx, ry)) continue;
      if (!onScreen({ minX: p.x - rx, minY: p.y - ry, maxX: p.x + rx, maxY: p.y + ry }, W, H)) continue;
      const n = normalize([0.2, -0.8, 0.4]);
      elems.push({
        type: "ellipse",
        depth: p.depth,
        cx: p.x,
        cy: p.y,
        rx,
        ry,
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
      // Draw as ellipse ring (major radius in XZ, viewed from camera)
      const c = projectPoint(cam, d.center);
      const R = projectRadius(cam, d.major, d.center);
      const r = projectRadius(cam, d.minor, d.center);
      const rx = Math.max(2, R);
      const ry = Math.max(2, R * 0.55);
      const strokeWidth = Math.max(1.5, r * 2);
      if (!finite(c.x, c.y, c.depth, rx, ry, strokeWidth)) continue;
      if (
        !onScreen(
          {
            minX: c.x - rx - strokeWidth,
            minY: c.y - ry - strokeWidth,
            maxX: c.x + rx + strokeWidth,
            maxY: c.y + ry + strokeWidth,
          },
          W,
          H,
        )
      ) {
        continue;
      }
      elems.push({
        type: "ellipse",
        depth: c.depth,
        cx: c.x,
        cy: c.y,
        rx,
        ry,
        fill: "none",
        stroke: shade(d.material, [0.1, -0.9, 0.2], lights),
        strokeWidth,
        name: d.name,
      });
    }
  }

  elems.sort((a, b) => a.depth - b.depth);
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

  // Soft gradient sky overlay
  parts.push(
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0%" stop-color="#f4a36a" stop-opacity="0.55"/>`,
    `<stop offset="45%" stop-color="#6aa8c8" stop-opacity="0.15"/>`,
    `<stop offset="100%" stop-color="#3f6f8a" stop-opacity="0"/>`,
    `</linearGradient></defs>`,
    `<rect width="100%" height="100%" fill="url(#sky)"/>`,
  );

  // Do not set per-shape opacity: @resvg/resvg-js 2.6.x panics on off-screen
  // isolated layers (geom.rs fit_to_rect unwrap). Solid fills avoid that path.
  for (const e of elems) {
    if (e.type === "ellipse") {
      if (e.fill === "none") {
        parts.push(
          `<ellipse cx="${e.cx.toFixed(2)}" cy="${e.cy.toFixed(2)}" rx="${e.rx.toFixed(2)}" ry="${e.ry.toFixed(2)}" fill="none" stroke="${e.stroke}" stroke-width="${e.strokeWidth.toFixed(2)}" stroke-linecap="round"/>`,
        );
      } else {
        parts.push(
          `<ellipse cx="${e.cx.toFixed(2)}" cy="${e.cy.toFixed(2)}" rx="${e.rx.toFixed(2)}" ry="${e.ry.toFixed(2)}" fill="${e.fill}"/>`,
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
