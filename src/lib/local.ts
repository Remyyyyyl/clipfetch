import type { LocalMedia } from "../types";

/** Preset interno para los trabajos que solo copian y cortan un archivo local. */
export const LOCAL_PRESET = "copy";

/** Extensiones que el diálogo y el arrastre aceptan. */
export const LOCAL_EXTENSIONS = [
  "mp4",
  "m4v",
  "mkv",
  "webm",
  "mov",
  "avi",
  "flv",
  "wmv",
  "ts",
  "m2ts",
  "mts",
  "mpg",
  "mpeg",
  "3gp",
  "ogv",
  "mp3",
  "m4a",
  "aac",
  "wav",
  "flac",
  "ogg",
  "oga",
  "opus",
  "wma",
  "aiff",
  "aif",
  "alac",
  "ac3",
  "eac3",
  "dts",
];

export function isLocalMediaPath(path: string): boolean {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return LOCAL_EXTENSIONS.includes(extension);
}

export function resolutionLabel(media: LocalMedia): string {
  if (!media.width || !media.height) return "";
  return `${media.width}×${media.height}`;
}

export function localMeta(media: LocalMedia): string[] {
  const parts: string[] = [];
  const resolution = resolutionLabel(media);
  if (resolution) parts.push(resolution);
  if (media.container) parts.push(media.container.toUpperCase());
  if (media.videoCodec) parts.push(`V ${media.videoCodec.toUpperCase()}`);
  if (media.audioCodec) parts.push(`A ${media.audioCodec.toUpperCase()}`);
  return parts;
}
