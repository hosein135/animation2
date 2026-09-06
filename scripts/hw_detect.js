/** Lightweight host hardware detection for encode path selection. */

import { mkdtempSync, rmSync, statSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { cpus, totalmem } from "os";

function ffmpegEncoders(ffmpeg) {
  const r = Bun.spawnSync([ffmpeg, "-hide_banner", "-encoders"], { stdout: "pipe", stderr: "pipe" });
  const text = (r.stdout?.toString?.() || "") + (r.stderr?.toString?.() || "");
  return text;
}

/** True only if FFmpeg can open the encoder on this machine (not merely list it). */
function probeEncoder(ffmpeg, codec, extra) {
  const dir = mkdtempSync(join(tmpdir(), "anim_enc_probe_"));
  const out = join(dir, "probe.mp4");
  try {
    const r = Bun.spawnSync(
      [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x64:d=0.04",
        "-frames:v",
        "1",
        "-c:v",
        codec,
        ...extra,
        "-f",
        "mp4",
        "-y",
        out,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (r.exitCode !== 0) return false;
    return existsSync(out) && statSync(out).size > 0;
  } catch {
    return false;
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

export function detect() {
  const cpuList = cpus();
  const cpuName = cpuList[0]?.model?.trim() || "Unknown";
  const cpuCount = cpuList.length || 1;
  const memoryGB = Math.round((totalmem() / 1024 ** 3) * 10) / 10;

  let nvidia = false;
  let intel = false;
  const nvidiaGpus = [];
  const intelGpus = [];

  if (process.platform === "win32") {
    try {
      const r = Bun.spawnSync(
        [
          "powershell",
          "-NoProfile",
          "-Command",
          "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const text = r.stdout?.toString?.() || "";
      for (const line of text
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)) {
        if (/nvidia|geforce|quadro|rtx |gtx /i.test(line)) {
          nvidia = true;
          nvidiaGpus.push(line);
        } else if (/intel/i.test(line)) {
          intel = true;
          intelGpus.push(line);
        }
      }
    } catch {
      // ignore
    }
  }

  if (Bun.which("nvidia-smi")) {
    nvidia = true;
    const r = Bun.spawnSync(["nvidia-smi", "-L"], { stdout: "pipe", stderr: "pipe" });
    const text = r.stdout?.toString?.() || "";
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      if (!nvidiaGpus.includes(line)) nvidiaGpus.push(line);
    }
  }

  const ffmpegPath = Bun.which("ffmpeg") || null;
  let hasNvenc = false;
  let hasQsv = false;
  let nvencSkipReason = null;
  let qsvSkipReason = null;

  if (ffmpegPath) {
    const enc = ffmpegEncoders(ffmpegPath);
    if (enc.includes("h264_nvenc") && nvidia) {
      hasNvenc = probeEncoder(ffmpegPath, "h264_nvenc", ["-preset", "p4", "-cq", "28", "-b:v", "0"]);
      if (!hasNvenc) {
        nvencSkipReason =
          "FFmpeg lists h264_nvenc but encode probe failed (unsupported device / driver / session)";
      }
    } else if (nvidia && !enc.includes("h264_nvenc")) {
      nvencSkipReason = "FFmpeg build has no h264_nvenc encoder";
    } else if (!nvidia) {
      nvencSkipReason = "No NVIDIA GPU detected";
    }

    if (enc.includes("h264_qsv")) {
      hasQsv = probeEncoder(ffmpegPath, "h264_qsv", [
        "-vf",
        "format=nv12",
        "-global_quality",
        "28",
        "-look_ahead",
        "0",
        "-async_depth",
        "1",
      ]);
      if (!hasQsv) {
        qsvSkipReason =
          "FFmpeg lists h264_qsv but encode probe failed (Intel iGPU / Quick Sync unavailable)";
      }
    } else if (intel) {
      qsvSkipReason = "FFmpeg build has no h264_qsv encoder";
    } else {
      qsvSkipReason = "No Intel GPU detected for Quick Sync";
    }
  } else {
    nvencSkipReason = "ffmpeg not found on PATH";
    qsvSkipReason = "ffmpeg not found on PATH";
  }

  return {
    cpuName,
    cpuCount,
    memoryGB,
    nvidia,
    intel,
    nvidiaGpus,
    intelGpus,
    hasNvenc,
    hasQsv,
    nvencSkipReason,
    qsvSkipReason,
    ffmpegPath,
    bunPath: Bun.which("bun") || null,
  };
}

export function formatInvolvementReport(hw, scene, renderer) {
  const planned = hw.hasNvenc ? "h264_nvenc" : hw.hasQsv ? "h264_qsv" : "libx264";
  const lines = [
    "",
    "Pipeline involvement (d3.js / FFmpeg)",
    `  Renderer : ${renderer}`,
    `  CPU      : ${hw.cpuName} (${hw.cpuCount} threads, ~${hw.memoryGB} GB RAM)`,
    `  NVIDIA   : ${hw.nvidiaGpus.join("; ") || "(none)"}`,
    `  Intel GPU: ${hw.intelGpus.join("; ") || "(none)"}`,
    `  Encode   : plan ${planned} (NVENC → QSV → libx264; runtime fallback on failure)`,
  ];
  if (hw.nvencSkipReason && !hw.hasNvenc) {
    lines.push(`  NVENC    : skipped — ${hw.nvencSkipReason}`);
  }
  if (hw.qsvSkipReason && !hw.hasQsv) {
    lines.push(`  QSV      : skipped — ${hw.qsvSkipReason}`);
  }
  lines.push("");
  return lines.join("\n");
}
