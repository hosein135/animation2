#!/usr/bin/env bun
/**
 * Concurrent animation pipeline — declarative JSON scene → d3 frames → MP4.
 *
 * Deps provisioned by Windows run.ps1 / run.cmd:
 *   vfox → bun (pinned), winget → FFmpeg
 */

import { mkdirSync, existsSync, rmSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { encodeFrames } from "./encode_video.js";
import { detect, formatInvolvementReport } from "./hw_detect.js";
import { renderAllFrames } from "./render_animation.js";
import { buildScene, loadJson } from "./scene_builder.js";

function parseArgs(argv) {
  const out = {
    dataDir: null,
    outputDir: null,
    renderer: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--data-dir" && argv[i + 1]) out.dataDir = argv[++i];
    else if (a === "--output-dir" && argv[i + 1]) out.outputDir = argv[++i];
    else if (a === "--renderer" && argv[i + 1]) out.renderer = argv[++i];
  }
  return out;
}

function frameCount(scene) {
  return Math.max(1, Math.round(Number(scene.fps) * Number(scene.duration_seconds)));
}

function fmtSecs(seconds) {
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  if (m < 60) return `${m}m ${s.toFixed(2).padStart(5, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ${s.toFixed(2)}s`;
}

function validate(dataDir) {
  const r = Bun.spawnSync(["bun", join(import.meta.dir, "validate_data.js")], {
    env: { ...process.env, DATA_DIR: dataDir },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (r.exitCode !== 0) throw new Error("Validation failed");
}

function clearFrames(framesDir) {
  if (!existsSync(framesDir)) return;
  for (const f of readdirSync(framesDir)) {
    if (/^frame_/i.test(f)) rmSync(join(framesDir, f), { force: true });
  }
}

function printSummary({ outputMp4, hw, scene, frames, codec, timings }) {
  const lines = [
    "",
    "=".repeat(64),
    " Animation complete — timing & hardware summary",
    "=".repeat(64),
    `  Output     : ${outputMp4}`,
    `  Frames     : ${frames}`,
    `  Wall clock : ${fmtSecs(timings.total)}`,
    "",
    "  Stage timings:",
    `    validate : ${fmtSecs(timings.validate)}`,
    `    build    : ${fmtSecs(timings.build)}   (CPU scene construction)`,
    `    render   : ${fmtSecs(timings.render)}   (d3.js SVG → PNG)`,
    `    encode   : ${fmtSecs(timings.encode)}   (${codec})`,
    "",
    "  Who did what:",
    `    CPU      : orchestration, scene graph, d3 projection, FFmpeg mux`,
    `               ${hw.cpuName} (${hw.cpuCount} threads)`,
    `    Render   : d3.js orthographic SVG + resvg raster`,
    `    Encode   : ${codec}`,
    "=".repeat(64),
    "",
  ];
  console.log(lines.join("\n"));
}

function main() {
  const args = parseArgs(Bun.argv.slice(2));
  const root = resolve(process.env.PROJECT_ROOT || join(import.meta.dir, ".."));
  const dataDir = resolve(args.dataDir || process.env.DATA_DIR || join(root, "data"));
  const outputDir = resolve(args.outputDir || process.env.OUTPUT_DIR || join(root, "output"));
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(outputDir, "frames"), { recursive: true });
  mkdirSync(join(outputDir, "logs"), { recursive: true });

  const scene = loadJson(join(dataDir, "scene.json"));
  let renderer = args.renderer || scene.acceleration?.renderer || "d3";
  if (renderer === "auto") renderer = "d3";

  const hw = detect();
  if (!hw.ffmpegPath) {
    console.error("Missing required tool: ffmpeg (winget: Gyan.FFmpeg)");
    process.exit(1);
  }
  console.log(`==> bun:    ${hw.bunPath || "bun"}`);
  console.log(`==> ffmpeg: ${hw.ffmpegPath}`);
  console.log(`==> Renderer mode: ${renderer}`);

  const t0 = performance.now();
  const timings = {};

  console.log("==> Validating data...");
  let t = performance.now();
  validate(dataDir);
  timings.validate = (performance.now() - t) / 1000;

  console.log(formatInvolvementReport(hw, scene, renderer));

  console.log("==> Building scene graph...");
  t = performance.now();
  const ctx = buildScene(dataDir, scene);
  timings.build = (performance.now() - t) / 1000;
  console.log(`==> Objects registered: ${Object.keys(ctx.objects).length}`);

  clearFrames(join(outputDir, "frames"));
  console.log("==> Rendering frames with d3.js...");
  t = performance.now();
  const renderMeta = renderAllFrames(dataDir, outputDir, scene, ctx);
  timings.render = (performance.now() - t) / 1000;

  console.log("==> Encoding (NVENC → QSV → libx264)...");
  t = performance.now();
  const codec = encodeFrames(
    join(outputDir, "frames"),
    join(outputDir, "animation.mp4"),
    scene,
    hw,
    frameCount(scene),
  );
  timings.encode = (performance.now() - t) / 1000;
  console.log(`==> Codec: ${codec}`);

  timings.total = (performance.now() - t0) / 1000;
  printSummary({
    outputMp4: join(outputDir, "animation.mp4"),
    hw,
    scene,
    frames: renderMeta.frames,
    codec,
    timings,
  });
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  console.error(err?.stack || err);
  process.exit(1);
}
