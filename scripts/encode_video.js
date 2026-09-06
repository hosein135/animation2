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

function ffmpegHasEncoder(ffmpeg, name) {
  const r = Bun.spawnSync([ffmpeg, "-hide_banner", "-encoders"], { stdout: "pipe", stderr: "pipe" });
  const text = (r.stdout?.toString?.() || "") + (r.stderr?.toString?.() || "");
  return text.includes(name);
}

function pickCodec(scene, hw) {
  const outCfg = scene.output || {};
  const forced = outCfg.video_codec;
  if (forced && forced !== "auto" && forced !== "libx264") {
    if (String(forced).endsWith("_nvenc")) return [forced, nvencExtra(outCfg)];
    if (String(forced).endsWith("_qsv")) return [forced, qsvExtra(outCfg)];
    return [forced, []];
  }

  const prefer = outCfg.prefer_encoder || "auto";
  const ffmpeg = hw.ffmpegPath;
  const order =
    prefer === "nvenc"
      ? ["h264_nvenc", "h264_qsv", "libx264"]
      : prefer === "qsv"
        ? ["h264_qsv", "h264_nvenc", "libx264"]
        : prefer === "cpu"
          ? ["libx264"]
          : hw.nvidia
            ? ["h264_nvenc", "h264_qsv", "libx264"]
            : hw.intel
              ? ["h264_qsv", "libx264"]
              : ["libx264"];

  for (const codec of order) {
    if (codec === "libx264" || ffmpegHasEncoder(ffmpeg, codec)) {
      if (codec === "h264_nvenc") return [codec, nvencExtra(outCfg)];
      if (codec === "h264_qsv") return [codec, qsvExtra(outCfg)];
      return ["libx264", x264Extra(outCfg)];
    }
  }
  return ["libx264", x264Extra(outCfg)];
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

export function encodeFrames(framesDir, outputMp4, scene, hw, expectedFrames = null) {
  const ffmpeg = hw.ffmpegPath || Bun.which("ffmpeg");
  if (!ffmpeg) throw new Error("ffmpeg not found on PATH");

  const { pattern, count } = detectFramePattern(framesDir);
  if (expectedFrames != null && count < expectedFrames) {
    throw new Error(`Expected ${expectedFrames} frames, found ${count}`);
  }

  const fps = Number(scene.fps || 14);
  const [codec, extra] = pickCodec(scene, { ...hw, ffmpegPath: ffmpeg });

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
  const r = Bun.spawnSync([ffmpeg, ...args], { stdout: "inherit", stderr: "inherit" });
  if (r.exitCode !== 0) throw new Error(`ffmpeg failed (exit ${r.exitCode})`);
  return codec;
}
