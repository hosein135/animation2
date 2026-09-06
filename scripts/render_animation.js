/** d3.js SVG frame renderer — projects scene drawables to SVG, then PNG via resvg.
 *  Adds volume gradients, contact shadows, speculars, and soft DoF to approach
 *  Blender EEVEE’s look (still a stylized orthographic approximation).
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import * as d3 from "d3";
import { Resvg } from "@resvg/resvg-js";
import { evaluateAtFrame } from "./actions.js";
import { buildCamera, projectPoint, projectRadius } from "./camera.js";
import { cross, dot, normalize, rgbToHex, scale, shadeColor, sub } from "./math.js";
import { expandDrawables, worldPoint } from "./prims.js";

function bgCss(scene) {
  const c = scene.background_color || [0.39, 0.6, 0.74, 1];
  const s = Number(scene.background_strength ?? 1);
  return rgbToHex(tonemap([c[0] * s, c[1] * s, c[2] * s]));
}

/** Soft filmic-ish lift so SVG colors sit closer to Blender AgX midtones. */
function tonemap(rgb) {
  const lift = (v) => {
    const x = Math.max(0, Math.min(1.4, v));
    // Gentle contrast curve + slight desaturation of extremes
    return Math.pow(x / (1 + 0.12 * x), 0.92);
  };
  return [lift(rgb[0]), lift(rgb[1]), lift(rgb[2])];
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

/** Screen-space light hint from strongest light (for radial highlight placement). */
function screenLight(cam, lights) {
  let best = lights[0];
  for (const L of lights) {
    if (L.energy > best.energy) best = L;
  }
  // Light comes from -dir toward the surface; highlight faces the light.
  const toLight = scale(best.dir, -1);
  const sx = dot(toLight, cam.right);
  const sy = -dot(toLight, cam.up); // SVG Y down
  const len = Math.hypot(sx, sy) || 1;
  return { x: sx / len, y: sy / len, color: best.color };
}

function shadeRgb(material, normal, lights) {
  const base = material.emission
    ? material.emission.color || material.color
    : material.color || [0.8, 0.8, 0.8];
  if (material.emission) {
    const s = Number(material.emission.strength ?? 1);
    return tonemap(shadeColor(base, 0.75 + 0.4 * Math.min(2, s)));
  }
  let r = 0;
  let g = 0;
  let b = 0;
  // Soft ambient (sky fill)
  const amb = 0.28;
  r += base[0] * amb * 0.75;
  g += base[1] * amb * 0.82;
  b += base[2] * amb * 0.95;
  for (const L of lights) {
    const ndl = Math.max(0, -(normal[0] * L.dir[0] + normal[1] * L.dir[1] + normal[2] * L.dir[2]));
    const wrap = Math.max(0, 0.15 + 0.85 * ndl); // wrap lighting for clay look
    const inten = wrap * Math.min(1.15, L.energy / 900);
    r += base[0] * inten * L.color[0];
    g += base[1] * inten * L.color[1];
    b += base[2] * inten * L.color[2];
  }
  const metal = Number(material.metallic || 0);
  const rough = Number(material.roughness ?? 0.5);
  if (metal > 0.05) {
    // Cool specular lift on metals
    const spec = (1.05 - rough * 0.5) * metal * 0.22;
    r += spec * 0.85;
    g += spec * 0.9;
    b += spec;
  }
  return tonemap([r, g, b]);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerp3(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
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

function projectTransformedCircle(cam, wm, radiusX = 1, radiusY = 1) {
  const c = [wm[12], wm[13], wm[14]];
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
    angleDeg: (-angle * 180) / Math.PI,
  };
}

function projectOrientedEllipsoid(cam, wm) {
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

function volumeColors(material, lights, litNormal, shadeNormal) {
  const mid = shadeRgb(material, shadeNormal, lights);
  const lit = shadeRgb(material, litNormal, lights);
  const darkN = normalize([-0.35, 0.55, -0.55]);
  const dark = shadeRgb(material, darkN, lights);
  // Push lit brighter / dark softer for clay volume
  const hi = tonemap(lerp3(mid, lit, 0.75).map((v, i) => Math.min(1.25, v * 1.12 + (material.emission ? 0.05 : 0.02) * (1 - i * 0.15))));
  const lo = tonemap(lerp3(mid, dark, 0.85).map((v) => v * 0.72));
  return { hi, mid, lo };
}

function drawableElements(drawables, cam, lights, lightScr) {
  const elems = [];
  const W = cam.width;
  const H = cam.height;
  const litN = normalize([-lightScr.x * 0.2 - 0.15, -0.75, 0.55]);

  for (const d of drawables) {
    if (d.kind === "ellipse") {
      const e = d.matrix ? projectOrientedEllipsoid(cam, d.matrix) : null;
      if (!e) continue;
      if (!finite(e.cx, e.cy, e.depth, e.rx, e.ry)) continue;
      const pad = Math.max(e.rx, e.ry);
      if (!onScreen({ minX: e.cx - pad, minY: e.cy - pad, maxX: e.cx + pad, maxY: e.cy + pad }, W, H)) continue;
      const n = normalize([0.15, -0.75, 0.45]);
      const cols = volumeColors(d.material, lights, litN, n);
      const metal = Number(d.material.metallic || 0);
      const rough = Number(d.material.roughness ?? 0.5);
      elems.push({
        type: "ellipse",
        depth: e.depth,
        cx: e.cx,
        cy: e.cy,
        rx: e.rx,
        ry: e.ry,
        angleDeg: e.angleDeg || 0,
        volume: cols,
        shiny: metal > 0.35 || rough < 0.35 || !!d.material.emission,
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
      const fillRgb = shadeRgb(d.material, n, lights);
      // Slight AO: darken downward-facing / back-facing a touch
      const facing = Math.max(0, -n[1]);
      const ao = 0.88 + 0.12 * facing;
      const fill = rgbToHex(fillRgb.map((v) => v * ao));
      elems.push({
        type: "polygon",
        depth,
        points,
        fill,
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
      const mid = shadeRgb(d.material, n, lights);
      const lo = shadeRgb(d.material, normalize([n[0] * 0.3, 0.6, n[2] * 0.3]), lights);
      const hi = shadeRgb(d.material, litN, lights);
      elems.push({
        type: "line",
        depth: (a.depth + b.depth) / 2,
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        stroke: rgbToHex(mid),
        strokeDark: rgbToHex(lo.map((v) => v * 0.78)),
        strokeLite: rgbToHex(hi.map((v) => Math.min(1.2, v * 1.08))),
        width,
        name: d.name,
      });
    } else if (d.kind === "tube") {
      const pts = d.points.map((p) => projectPoint(cam, p));
      if (pts.length < 2 || !pts.every((p) => finite(p.x, p.y, p.depth))) continue;
      const depth = pts.reduce((s, p) => s + p.depth, 0) / pts.length;
      const line = d3
        .line()
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
      const mid = shadeRgb(d.material, [0.2, -0.7, 0.4], lights);
      const lo = mid.map((v) => v * 0.75);
      const hi = mid.map((v) => Math.min(1.2, v * 1.1));
      elems.push({
        type: "path",
        depth,
        d: pathD,
        stroke: rgbToHex(mid),
        strokeDark: rgbToHex(lo),
        strokeLite: rgbToHex(hi),
        width,
        name: d.name,
      });
    } else if (d.kind === "torus") {
      const ring = d.matrix ? projectTransformedCircle(cam, d.matrix, d.major, d.major) : null;
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
      const mid = shadeRgb(d.material, [0.1, -0.9, 0.2], lights);
      elems.push({
        type: "ellipse",
        depth: ring.depth,
        cx: ring.cx,
        cy: ring.cy,
        rx: ring.rx,
        ry: ring.ry,
        angleDeg: ring.angleDeg || 0,
        fill: "none",
        stroke: rgbToHex(mid),
        strokeDark: rgbToHex(mid.map((v) => v * 0.7)),
        strokeLite: rgbToHex(mid.map((v) => Math.min(1.15, v * 1.15))),
        strokeWidth,
        name: d.name,
      });
    }
  }

  elems.sort((a, b) => b.depth - a.depth);
  return elems;
}

/** Soft contact shadows under the ride (solid fills + blur — no per-shape opacity). */
function contactShadows(ctx, cam, W, H) {
  const shadows = [];
  const ride = ctx.objects.RideRoot;
  if (!ride) return shadows;
  const groundZ = 0.02;
  const anchors = [
    { local: [0, 0, groundZ], rx: 1.15, ry: 0.28 },
    { local: [-1.35, 0, groundZ], rx: 0.55, ry: 0.16 },
    { local: [1.45, 0, groundZ], rx: 0.55, ry: 0.16 },
  ];
  for (const a of anchors) {
    const w = worldPoint(ride, a.local);
    const p = projectPoint(cam, w);
    const rx = projectRadius(cam, a.rx, w);
    const ry = projectRadius(cam, a.ry, w);
    if (!finite(p.x, p.y, rx, ry)) continue;
    if (!onScreen({ minX: p.x - rx * 2, minY: p.y - ry * 2, maxX: p.x + rx * 2, maxY: p.y + ry * 2 }, W, H, 120)) {
      continue;
    }
    shadows.push({ cx: p.x, cy: p.y + ry * 0.15, rx: rx * 1.05, ry: ry * 1.1, depth: p.depth - 0.02 });
  }
  return shadows;
}

function focusDepth(ctx, cam) {
  const ride = ctx.objects.RideRoot;
  if (!ride) return 22;
  return projectPoint(cam, worldPoint(ride, [0, 0, 1.2])).depth;
}

export function renderSvgString(scene, ctx, frame) {
  evaluateAtFrame(ctx, frame, ctx.interpolationModes || {});
  const camNode = ctx.objects[scene.camera?.name] || ctx.camera;
  const cam = buildCamera(camNode, scene.resolution);
  const lights = lightDirs(ctx);
  const lightScr = screenLight(cam, lights);

  const drawables = [];
  for (const root of ctx.roots) {
    expandDrawables(root, ctx.materials, drawables);
  }
  const elems = drawableElements(drawables, cam, lights, lightScr);
  const [W, H] = scene.resolution;
  const bg = bgCss(scene);
  const shadows = contactShadows(ctx, cam, W, H);
  const focus = focusDepth(ctx, cam);

  const parts = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<defs>`,
    // Soft shadow + mild background DoF. No opacity layers (resvg panic risk).
    `<filter id="softShadow" x="-80%" y="-80%" width="260%" height="260%">`,
    `<feGaussianBlur in="SourceGraphic" stdDeviation="18"/>`,
    `</filter>`,
    `<filter id="dofFar" x="-4%" y="-4%" width="108%" height="108%">`,
    `<feGaussianBlur in="SourceGraphic" stdDeviation="1.15"/>`,
    `</filter>`,
    `<filter id="dofMid" x="-3%" y="-3%" width="106%" height="106%">`,
    `<feGaussianBlur in="SourceGraphic" stdDeviation="0.45"/>`,
    `</filter>`,
  ];

  let gradId = 0;
  const gradFor = (e) => {
    if (!e.volume) return null;
    const id = `vg${gradId++}`;
    const hx = 50 - lightScr.x * 28;
    const hy = 50 - lightScr.y * 28;
    parts.push(
      `<radialGradient id="${id}" cx="${hx.toFixed(1)}%" cy="${hy.toFixed(1)}%" r="78%" fx="${(hx - 6).toFixed(1)}%" fy="${(hy - 8).toFixed(1)}%">`,
      `<stop offset="0%" stop-color="${rgbToHex(e.volume.hi)}"/>`,
      `<stop offset="48%" stop-color="${rgbToHex(e.volume.mid)}"/>`,
      `<stop offset="100%" stop-color="${rgbToHex(e.volume.lo)}"/>`,
      `</radialGradient>`,
    );
    return id;
  };

  // Pre-allocate gradients for filled ellipses
  for (const e of elems) {
    if (e.type === "ellipse" && e.volume) e._grad = gradFor(e);
  }
  parts.push(`</defs>`);
  parts.push(`<rect width="100%" height="100%" fill="${bg}"/>`);

  // Contact shadows under the bike (drawn before scene, blurred)
  parts.push(`<g filter="url(#softShadow)">`);
  for (const s of shadows) {
    parts.push(
      `<ellipse cx="${s.cx.toFixed(2)}" cy="${s.cy.toFixed(2)}" rx="${s.rx.toFixed(2)}" ry="${s.ry.toFixed(2)}" fill="#2c1c14"/>`,
    );
  }
  parts.push(`</g>`);

  const far = [];
  const mid = [];
  const near = [];
  for (const e of elems) {
    if (e.depth > focus + 10) far.push(e);
    else if (e.depth > focus + 3.5) mid.push(e);
    else near.push(e);
  }

  const emit = (list) => {
    for (const e of list) {
      if (e.type === "ellipse") {
        const rot =
          e.angleDeg && Math.abs(e.angleDeg) > 0.01
            ? ` transform="rotate(${e.angleDeg.toFixed(2)} ${e.cx.toFixed(2)} ${e.cy.toFixed(2)})"`
            : "";
        if (e.fill === "none") {
          // Tire / rim: dark under-stroke + lit over-stroke for roundness
          if (e.strokeDark) {
            parts.push(
              `<ellipse cx="${e.cx.toFixed(2)}" cy="${e.cy.toFixed(2)}" rx="${e.rx.toFixed(2)}" ry="${e.ry.toFixed(2)}" fill="none" stroke="${e.strokeDark}" stroke-width="${(e.strokeWidth * 1.12).toFixed(2)}" stroke-linecap="round"${rot}/>`,
            );
          }
          parts.push(
            `<ellipse cx="${e.cx.toFixed(2)}" cy="${e.cy.toFixed(2)}" rx="${e.rx.toFixed(2)}" ry="${e.ry.toFixed(2)}" fill="none" stroke="${e.stroke}" stroke-width="${e.strokeWidth.toFixed(2)}" stroke-linecap="round"${rot}/>`,
          );
          if (e.strokeLite) {
            parts.push(
              `<ellipse cx="${(e.cx - e.rx * 0.04).toFixed(2)}" cy="${(e.cy - e.ry * 0.06).toFixed(2)}" rx="${(e.rx * 0.98).toFixed(2)}" ry="${(e.ry * 0.98).toFixed(2)}" fill="none" stroke="${e.strokeLite}" stroke-width="${Math.max(1, e.strokeWidth * 0.35).toFixed(2)}" stroke-linecap="round"${rot}/>`,
            );
          }
        } else {
          const fill = e._grad ? `url(#${e._grad})` : e.fill;
          parts.push(
            `<ellipse cx="${e.cx.toFixed(2)}" cy="${e.cy.toFixed(2)}" rx="${e.rx.toFixed(2)}" ry="${e.ry.toFixed(2)}" fill="${fill}"${rot}/>`,
          );
          // Specular glint on balloons / metals / emissives
          if (e.shiny && Math.min(e.rx, e.ry) > 6) {
            const hx = e.cx + lightScr.x * e.rx * 0.32;
            const hy = e.cy + lightScr.y * e.ry * 0.32;
            parts.push(
              `<ellipse cx="${hx.toFixed(2)}" cy="${hy.toFixed(2)}" rx="${(e.rx * 0.18).toFixed(2)}" ry="${(e.ry * 0.12).toFixed(2)}" fill="#fff8ee"/>`,
            );
          }
        }
      } else if (e.type === "polygon") {
        parts.push(`<polygon points="${e.points}" fill="${e.fill}" stroke="${e.fill}" stroke-width="0.35"/>`);
      } else if (e.type === "line") {
        if (e.strokeDark) {
          parts.push(
            `<line x1="${e.x1.toFixed(2)}" y1="${(e.y1 + e.width * 0.08).toFixed(2)}" x2="${e.x2.toFixed(2)}" y2="${(e.y2 + e.width * 0.08).toFixed(2)}" stroke="${e.strokeDark}" stroke-width="${(e.width * 1.05).toFixed(2)}" stroke-linecap="round"/>`,
          );
        }
        parts.push(
          `<line x1="${e.x1.toFixed(2)}" y1="${e.y1.toFixed(2)}" x2="${e.x2.toFixed(2)}" y2="${e.y2.toFixed(2)}" stroke="${e.stroke}" stroke-width="${e.width.toFixed(2)}" stroke-linecap="round"/>`,
        );
        if (e.strokeLite) {
          parts.push(
            `<line x1="${e.x1.toFixed(2)}" y1="${(e.y1 - e.width * 0.12).toFixed(2)}" x2="${e.x2.toFixed(2)}" y2="${(e.y2 - e.width * 0.12).toFixed(2)}" stroke="${e.strokeLite}" stroke-width="${Math.max(1, e.width * 0.28).toFixed(2)}" stroke-linecap="round"/>`,
          );
        }
      } else if (e.type === "path" && e.d) {
        if (e.strokeDark) {
          parts.push(
            `<path d="${e.d}" fill="none" stroke="${e.strokeDark}" stroke-width="${(e.width * 1.08).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`,
          );
        }
        parts.push(
          `<path d="${e.d}" fill="none" stroke="${e.stroke}" stroke-width="${e.width.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`,
        );
        if (e.strokeLite) {
          parts.push(
            `<path d="${e.d}" fill="none" stroke="${e.strokeLite}" stroke-width="${Math.max(1, e.width * 0.3).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`,
          );
        }
      }
    }
  };

  parts.push(`<g filter="url(#dofFar)">`);
  emit(far);
  parts.push(`</g>`);
  parts.push(`<g filter="url(#dofMid)">`);
  emit(mid);
  parts.push(`</g>`);
  emit(near);

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
