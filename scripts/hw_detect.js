/** Lightweight host hardware detection for encode path selection. */

import { cpus, totalmem } from "os";

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

  return {
    cpuName,
    cpuCount,
    memoryGB,
    nvidia,
    intel,
    nvidiaGpus,
    intelGpus,
    ffmpegPath: Bun.which("ffmpeg") || null,
    bunPath: Bun.which("bun") || null,
  };
}

export function formatInvolvementReport(hw, scene, renderer) {
  const lines = [
    "",
    "Pipeline involvement (d3.js / FFmpeg)",
    `  Renderer : ${renderer}`,
    `  CPU      : ${hw.cpuName} (${hw.cpuCount} threads, ~${hw.memoryGB} GB RAM)`,
    `  NVIDIA   : ${hw.nvidiaGpus.join("; ") || "(none)"}`,
    `  Intel GPU: ${hw.intelGpus.join("; ") || "(none)"}`,
    `  Encode   : prefer ${scene.output?.prefer_encoder || "auto"} (NVENC → QSV → libx264)`,
    "",
  ];
  return lines.join("\n");
}
