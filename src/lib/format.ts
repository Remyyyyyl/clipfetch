import type { YtDlpInfo } from "../types";

export const PRESETS = [
  { value: "best", label: "Mejor calidad" },
  { value: "1080", label: "MP4 1080p" },
  { value: "720", label: "MP4 720p" },
  { value: "480", label: "MP4 480p" },
  { value: "mp3", label: "MP3 320 kbps" },
  { value: "audio", label: "Solo audio original" },
];

export function presetLabel(value: string): string {
  return PRESETS.find((preset) => preset.value === value)?.label ?? "Personalizado";
}

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return "—";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatSpeed(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) return "—";
  return `${formatBytes(value)}/s`;
}

export function formatDuration(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) return "—";
  const total = Math.round(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatEta(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) return "—";
  return formatDuration(value);
}

export function formatCount(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("es", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function thumbnailOf(info: YtDlpInfo): string | undefined {
  if (info.thumbnail) return info.thumbnail;
  const thumbs = info.thumbnails || [];
  for (let index = thumbs.length - 1; index >= 0; index -= 1) {
    if (thumbs[index]?.url) return thumbs[index].url;
  }
  return undefined;
}

export function safeMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function stageLabel(stage: string): string {
  if (!stage) return "Motor";
  const labels: Record<string, string> = {
    "yt-dlp": "yt-dlp",
    ffmpeg: "FFmpeg",
    deno: "Deno",
  };
  return labels[stage] ?? stage;
}
