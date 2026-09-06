/** Named animation actions applied from scene.json timeline entries. */

import { lookAtEuler } from "./math.js";

function obj(ctx, name) {
  const o = ctx.objects[name];
  if (!o) throw new Error(`Action target not found: ${name}`);
  return o;
}

function frameRange(cfg, ctx) {
  const start = Number(cfg.frame_start ?? 1);
  const end = Number(cfg.frame_end ?? ctx.frame_end);
  return [start, end];
}

function steps(cfg, frameStart, frameEnd) {
  if (cfg.steps != null) return Math.max(2, Number(cfg.steps));
  return Math.max(8, Math.floor((frameEnd - frameStart) / 4));
}

function insertLoc(o, frame, loc) {
  o.keyframes.location.push({ frame, value: [...loc] });
}

function insertRot(o, frame, rot) {
  o.keyframes.rotation.push({ frame, value: [...rot] });
}

export function translate(cfg, ctx) {
  const o = obj(ctx, cfg.target);
  const [start, end] = frameRange(cfg, ctx);
  const frm = cfg.from ? [...cfg.from] : [...o.location];
  const to = [...cfg.to];
  o.location = frm;
  insertLoc(o, start, frm);
  o.location = to;
  insertLoc(o, end, to);
}

export function rotate(cfg, ctx) {
  const o = obj(ctx, cfg.target);
  const [start, end] = frameRange(cfg, ctx);
  const frm = cfg.from ? [...cfg.from] : [...o.rotation];
  const to = [...cfg.to];
  o.rotation = frm;
  insertRot(o, start, frm);
  o.rotation = to;
  insertRot(o, end, to);
}

export function spin(cfg, ctx) {
  const o = obj(ctx, cfg.target);
  const [start, end] = frameRange(cfg, ctx);
  const axis = Number(cfg.axis ?? 1);
  let turns;
  if (cfg.rotations != null) {
    turns = Number(cfg.rotations);
  } else {
    const distance = Number(cfg.distance);
    const radius = Number(cfg.radius);
    turns = radius ? distance / (2 * Math.PI * radius) : 1.0;
  }
  const sign = cfg.invert === false ? 1.0 : -1.0;
  const angles0 = [0, 0, 0];
  o.rotation = [...angles0];
  insertRot(o, start, angles0);
  const angles1 = [0, 0, 0];
  angles1[axis] = sign * turns * Math.PI * 2;
  o.rotation = [...angles1];
  insertRot(o, end, angles1);
}

export function bob(cfg, ctx) {
  const o = obj(ctx, cfg.target);
  const [start, end] = frameRange(cfg, ctx);
  const axis = Number(cfg.axis ?? 2);
  const amplitude = Number(cfg.amplitude ?? 0.045);
  const cycles = Number(cfg.cycles ?? 6.0);
  const phase = Number(cfg.phase ?? 0.0);
  const base = cfg.base ? [...cfg.base] : [...o.location];
  const n = steps(cfg, start, end);
  for (let step = 0; step <= n; step++) {
    const fr = start + Math.floor((step * (end - start)) / n);
    const t = (fr - start) / Math.max(1, end - start);
    const loc = [...base];
    loc[axis] = base[axis] + amplitude * Math.sin(t * Math.PI * cycles + phase);
    o.location = loc;
    insertLoc(o, fr, loc);
  }
}

export function flutter(cfg, ctx) {
  const o = obj(ctx, cfg.target);
  const [start, end] = frameRange(cfg, ctx);
  const axis = Number(cfg.axis ?? 2);
  const amplitude = Number(cfg.amplitude ?? 0.18);
  const cycles = Number(cfg.cycles ?? 8.0);
  const phase = Number(cfg.phase ?? 0.0);
  const base = cfg.base ? [...cfg.base] : [...o.rotation];
  const n = steps(cfg, start, end);
  for (let step = 0; step <= n; step++) {
    const fr = start + Math.floor((step * (end - start)) / n);
    const t = (fr - start) / Math.max(1, end - start);
    const rot = [...base];
    rot[axis] = base[axis] + amplitude * Math.sin(t * Math.PI * cycles + phase);
    o.rotation = rot;
    insertRot(o, fr, rot);
  }
}

export function follow_axis(cfg, ctx) {
  const o = obj(ctx, cfg.target);
  const [start, end] = frameRange(cfg, ctx);
  const axis = Number(cfg.axis ?? 0);
  const factor = Number(cfg.factor ?? 0.35);
  let values = cfg.values;
  if (values == null) {
    const source = cfg.source_values || [0, 0];
    values = [Number(source[0]) * factor, Number(source[1]) * factor];
  }
  const base = cfg.base ? [...cfg.base] : [...o.location];
  const loc0 = [...base];
  loc0[axis] = base[axis] + Number(values[0]);
  o.location = loc0;
  insertLoc(o, start, loc0);
  const loc1 = [...base];
  loc1[axis] = base[axis] + Number(values[1]);
  o.location = loc1;
  insertLoc(o, end, loc1);
}

export function look_at(cfg, ctx) {
  const o = obj(ctx, cfg.target);
  const [start, end] = frameRange(cfg, ctx);
  const points = cfg.points;
  if (!points || points.length < 2) throw new Error("look_at requires at least two points");
  if (cfg.locations) {
    insertLoc(o, start, cfg.locations[0]);
    insertLoc(o, end, cfg.locations[cfg.locations.length - 1]);
  }
  const loc0 = cfg.locations ? [...cfg.locations[0]] : [...o.location];
  const loc1 = cfg.locations ? [...cfg.locations[cfg.locations.length - 1]] : [...o.location];
  o.location = loc0;
  const rot0 = lookAtEuler(loc0, points[0]);
  o.rotation = rot0;
  insertRot(o, start, rot0);
  o.location = loc1;
  const rot1 = lookAtEuler(loc1, points[points.length - 1]);
  o.rotation = rot1;
  insertRot(o, end, rot1);
}

export function parent(cfg, ctx) {
  const child = obj(ctx, cfg.child);
  const parentObj = obj(ctx, cfg.parent);
  child.parent = parentObj;
  parentObj.children.push(child);
}

export function set_interpolation(cfg, _ctx) {
  // Interpolation mode is honored in evaluateChannel (LINEAR vs BEZIER).
  cfg._appliedMode = String(cfg.mode || "LINEAR").toUpperCase();
}

export function bob_matching(cfg, ctx) {
  const prefix = cfg.prefix;
  const matches = Object.keys(ctx.objects).filter((n) => n.startsWith(prefix));
  for (const name of matches) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    bob({ ...cfg, target: name, phase: Number(cfg.phase ?? 0) + (Math.abs(h) % 7) }, ctx);
  }
}

export const ACTION_REGISTRY = {
  translate,
  rotate,
  spin,
  bob,
  flutter,
  follow_axis,
  look_at,
  parent,
  set_interpolation,
  bob_matching,
};

export function knownActions() {
  return new Set(Object.keys(ACTION_REGISTRY));
}

export function applyAction(cfg, ctx) {
  const name = cfg.action;
  if (!name) throw new Error("Action entry missing 'action' key");
  const fn = ACTION_REGISTRY[name];
  if (!fn) throw new Error(`Unknown action: ${name}`);
  fn(cfg, ctx);
}

export function applyActions(actions, ctx) {
  for (const entry of actions || []) applyAction(entry, ctx);
}

function interpMode(keyframes, modeHint) {
  return modeHint || "LINEAR";
}

function sampleChannel(keys, frame, mode = "LINEAR") {
  if (!keys || keys.length === 0) return null;
  const sorted = [...keys].sort((a, b) => a.frame - b.frame);
  if (frame <= sorted[0].frame) return [...sorted[0].value];
  if (frame >= sorted[sorted.length - 1].frame) return [...sorted[sorted.length - 1].value];
  let i = 0;
  while (i < sorted.length - 1 && sorted[i + 1].frame < frame) i++;
  const a = sorted[i];
  const b = sorted[i + 1];
  const t = (frame - a.frame) / Math.max(1e-9, b.frame - a.frame);
  let u = t;
  if (mode === "BEZIER") {
    // Smoothstep approximation of ease
    u = t * t * (3 - 2 * t);
  }
  return [
    a.value[0] + (b.value[0] - a.value[0]) * u,
    a.value[1] + (b.value[1] - a.value[1]) * u,
    a.value[2] + (b.value[2] - a.value[2]) * u,
  ];
}

/** Apply keyframed transforms for a given frame onto all objects. */
export function evaluateAtFrame(ctx, frame, interpolationModes = {}) {
  for (const [name, o] of Object.entries(ctx.objects)) {
    const mode = interpolationModes[name] || "LINEAR";
    const loc = sampleChannel(o.keyframes.location, frame, mode);
    const rot = sampleChannel(o.keyframes.rotation, frame, mode);
    if (loc) o.location = loc;
    if (rot) o.rotation = rot;
  }
  void interpMode;
}

/** Collect LINEAR targets from set_interpolation actions. */
export function collectInterpolationModes(actions) {
  const modes = {};
  for (const a of actions || []) {
    if (a.action !== "set_interpolation") continue;
    const mode = String(a.mode || "LINEAR").toUpperCase();
    const targets = a.targets || (a.target ? [a.target] : []);
    for (const t of targets) modes[t] = mode;
  }
  return modes;
}
