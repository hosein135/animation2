#!/usr/bin/env bun
/** Validate scene.json + object refs + actions for the animation generator. */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { knownActions } from "./actions.js";
import { knownFactories } from "./factories.js";

function load(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function checkNode(node, dataDir, actionsOk, factoriesOk) {
  const errors = [];
  if (node.ref) {
    const refPath = join(dataDir, "objects", `${node.ref}.json`);
    if (!existsSync(refPath)) {
      errors.push(`missing object ref: ${node.ref} (${refPath})`);
    } else {
      try {
        const loaded = load(refPath);
        const merged = { ...loaded, ...Object.fromEntries(Object.entries(node).filter(([k]) => k !== "ref")) };
        if (!node.children && loaded.children) merged.children = loaded.children;
        errors.push(...checkNode(merged, dataDir, actionsOk, factoriesOk));
      } catch (exc) {
        errors.push(`invalid JSON in objects/${node.ref}.json: ${exc.message}`);
      }
    }
    return errors;
  }

  const ntype = node.type || "group";
  if (ntype === "factory") {
    const fname = node.factory || node.name;
    if (!factoriesOk.has(fname)) errors.push(`unknown factory: ${fname}`);
  } else if (ntype === "instance") {
    errors.push(
      ...checkNode(
        { ref: node.object, ...Object.fromEntries(Object.entries(node).filter(([k]) => k !== "type" && k !== "object")) },
        dataDir,
        actionsOk,
        factoriesOk,
      ),
    );
  }

  for (const child of node.children || []) {
    errors.push(...checkNode(child, dataDir, actionsOk, factoriesOk));
  }
  return errors;
}

function main() {
  const dataDir = process.env.DATA_DIR || join(import.meta.dir, "..", "data");
  const scenePath = join(dataDir, "scene.json");

  if (!existsSync(scenePath)) {
    console.error(`Missing scene config: ${scenePath}`);
    process.exit(1);
  }

  let scene;
  try {
    scene = load(scenePath);
  } catch (exc) {
    console.error(`Invalid scene.json: ${exc.message}`);
    process.exit(1);
  }

  for (const key of ["fps", "duration_seconds", "resolution"]) {
    if (!(key in scene)) {
      console.error(`scene.json missing key: ${key}`);
      process.exit(1);
    }
  }

  const res = scene.resolution;
  if (!Array.isArray(res) || res.length !== 2) {
    console.error("scene.json resolution must be [width, height]");
    process.exit(1);
  }

  const totalFrames = Math.round(Number(scene.fps) * Number(scene.duration_seconds));
  if (totalFrames < 1) {
    console.error("duration_seconds / fps produce zero frames");
    process.exit(1);
  }

  const materialsPath = join(dataDir, "materials.json");
  if (!existsSync(materialsPath)) {
    console.error(`Missing materials file: ${materialsPath}`);
    process.exit(1);
  }

  const actionsOk = knownActions();
  const factoriesOk = knownFactories();
  const errors = [];

  for (const placement of scene.objects || []) {
    errors.push(...checkNode(placement, dataDir, actionsOk, factoriesOk));
  }

  for (const action of scene.actions || []) {
    const name = action.action;
    if (!name) errors.push("action entry missing 'action'");
    else if (!actionsOk.has(name)) errors.push(`unknown action: ${name}`);
  }

  if (errors.length) {
    console.error("Validation failed:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log(`OK: scene valid (${totalFrames} frames, ${Object.keys(load(materialsPath)).length} materials)`);
  return 0;
}

main();
