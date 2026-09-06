/** Encode PNG frames to MP4 — prefers NVENC, then Intel QSV, then threaded libx264. */

import { readdirSync } from "fs";
import { join } from "path";

function nvencExtra(outCfg) {
  return [
    "-preset",
    outCfg.nvenc_preset || "p4",
    "-tune",
    "hq",
    "-rc",
    "vbr",
    "-cq",
    String(outCfg.video_cq ?? outCfg.video_crf ?? 19),
    "-b:v",
    "0",
    "-spatial-aq",
    "1",
  ];
}

function qsvExtra(outCfg) {
  return [
    "-vf",
    "format=nv12",
    "-global_quality",
    String(outCfg.video_cq ?? outCfg.video_crf ?? 22),
    "-look_ahead",
    "0",
    "-async_depth",
    "1",
  ];
}

function x264Extra(outCfg) {
  return [
    "-crf",
    String(outCfg.video_crf ?? 18),
    "-preset",
    outCfg.video_preset || "fast",
    "-threads",
    "0",
  ];
}

function extrasFor(codec, outCfg) {
  if (codec === "h264_nvenc") return nvencExtra(outCfg);
  if (codec === "h264_qsv") return qsvExtra(outCfg);
  return x264Extra(outCfg);
}

function codecOrder(scene, hw) {
  const outCfg = scene.output || {};
  const forced = outCfg.video_codec;
  if (forced && forced !== "auto" && forced !== "libx264") {
    return [forced];
  }

  const prefer = outCfg.prefer_encoder || "auto";
  if (prefer === "cpu") return ["libx264"];
  if (prefer === "nvenc") return ["h264_nvenc", "h264_qsv", "libx264"];
  if (prefer === "qsv") return ["h264_qsv", "h264_nvenc", "libx264"];

  // Prefer probed capabilities; fall back through the full chain at encode time.
  if (hw.hasNvenc) return ["h264_nvenc", "h264_qsv", "libx264"];
  if (hw.hasQsv) return ["h264_qsv", "libx264"];
  if (hw.nvidia) return ["h264_nvenc", "h264_qsv", "libx264"];
  if (hw.intel) return ["h264_qsv", "libx264"];
  return ["libx264"];
}

function detectFramePattern(framesDir) {
  const files = readdirSync(framesDir)
    .filter((f) => /^frame_\d+\.png$/i.test(f))
    .sort();
  if (!files.length) throw new Error(`No frame_*.png in ${framesDir}`);
  const sample = files[0];
  const digits = (sample.match(/frame_(\d+)\.png/i) || [])[1].length;
  return { pattern: join(framesDir, `frame_%0${digits}d.png`), count: files.length };
}

function runFfmpeg(ffmpeg, args) {
  return Bun.spawnSync([ffmpeg, ...args], { stdout: "inherit", stderr: "inherit" });
}

export function encodeFrames(framesDir, outputMp4, scene, hw, expectedFrames = null) {
  const ffmpeg = hw.ffmpegPath || Bun.which("ffmpeg");
  if (!ffmpeg) throw new Error("ffmpeg not found on PATH");

  const { pattern, count } = detectFramePattern(framesDir);
  if (expectedFrames != null && count < expectedFrames) {
    throw new Error(`Expected ${expectedFrames} frames, found ${count}`);
  }

  const fps = Number(scene.fps || 14);
  const outCfg = scene.output || {};
  const order = codecOrder(scene, hw);
  const errors = [];

  for (const codec of order) {
    const extra = extrasFor(codec, outCfg);
    const args = [
      "-y",
      "-framerate",
      String(fps),
      "-i",
      pattern,
      "-c:v",
      codec,
      ...extra,
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outputMp4,
    ];

    console.log(`==> ffmpeg encode (${codec}): ${outputMp4}`);
    if (hw.nvencSkipReason && codec === "h264_nvenc") {
      console.log(`  note: ${hw.nvencSkipReason}`);
    }
    if (hw.qsvSkipReason && codec === "h264_qsv") {
      console.log(`  note: ${hw.qsvSkipReason}`);
    }

    const r = runFfmpeg(ffmpeg, args);
    if (r.exitCode === 0) return codec;

    const msg = `ffmpeg ${codec} failed (exit ${r.exitCode})`;
    errors.push(msg);
    const remaining = order.slice(order.indexOf(codec) + 1);
    if (remaining.length) {
      console.log(`==> ${msg}; falling back to ${remaining[0]}...`);
    }
  }

  throw new Error(`ffmpeg failed after trying ${order.join(" → ")}: ${errors.join("; ")}`);
}
