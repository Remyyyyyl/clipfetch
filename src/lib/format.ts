import type { YtDlpInfo } from "../types";

export const VIDEO_PRESETS = [
  { value: "best", label: "Mejor calidad" },
  { value: "2160", label: "MP4 2160p" },
  { value: "1440", label: "MP4 1440p" },
  { value: "1080", label: "MP4 1080p" },
  { value: "720", label: "MP4 720p" },
  { value: "480", label: "MP4 480p" },
  { value: "360", label: "MP4 360p" },
];

export const AUDIO_PRESETS = [
  { value: "mp3-320", label: "MP3 320 kbps" },
  { value: "mp3-256", label: "MP3 256 kbps" },
  { value: "mp3-192", label: "MP3 192 kbps" },
  { value: "mp3-128", label: "MP3 128 kbps" },
  { value: "m4a-256", label: "M4A 256 kbps" },
  { value: "m4a-128", label: "M4A 128 kbps" },
  { value: "opus-160", label: "Opus 160 kbps" },
  { value: "flac", label: "FLAC (sin pérdida)" },
  { value: "wav", label: "WAV (sin comprimir)" },
  { value: "audio", label: "Audio original" },
];

const LEGACY_PRESET_LABELS: Record<string, string> = {
  mp3: "MP3 320 kbps",
};

export function presetLabel(value: string): string {
  const found = [...VIDEO_PRESETS, ...AUDIO_PRESETS].find(
    (preset) => preset.value === value,
  );
  return found?.label ?? LEGACY_PRESET_LABELS[value] ?? "Personalizado";
}

export function isAudioPreset(value: string): boolean {
  return value === "mp3" || AUDIO_PRESETS.some((preset) => preset.value === value);
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

/** Reloj de edición: siempre `HH:MM:SS`, sin abreviar. */
export function formatClock(value: number | null | undefined): string {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
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
