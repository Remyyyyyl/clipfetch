import type { Settings } from "../types";
import { isEditorProfile, VIDEO_PRESETS } from "./format";
import { loadSection, saveSection } from "./persistence";

export const SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS: Settings = {
  outputDir: "",
  preset: "1080",
  audioPreset: "mp3-320",
  concurrency: 2,
  rateLimit: "",
  extraArgs: "",
  cookiesMode: "none",
  cookiesPath: "",
  editorProfile: "premiere-1080",
  keepMaster: true,
};

const COOKIE_MODES = new Set(["none", "firefox", "file"]);
const VIDEO_PRESET_VALUES = new Set(VIDEO_PRESETS.map((preset) => preset.value));

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function sanitize(value: unknown): Settings | null {
  if (value === null || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const concurrency = Number(raw.concurrency);
  const cookiesMode = asString(raw.cookiesMode, DEFAULT_SETTINGS.cookiesMode);
  const preset = asString(raw.preset, DEFAULT_SETTINGS.preset);
  const editorProfile = asString(raw.editorProfile, "");
  const keepMaster = raw.keepMaster !== false;

  return {
    outputDir: asString(raw.outputDir, DEFAULT_SETTINGS.outputDir),
    // «best» era el valor antiguo: ahora la calidad se elige por resolución.
    preset: VIDEO_PRESET_VALUES.has(preset) ? preset : DEFAULT_SETTINGS.preset,
    audioPreset: asString(raw.audioPreset, DEFAULT_SETTINGS.audioPreset),
    concurrency: Number.isFinite(concurrency)
      ? Math.min(8, Math.max(1, Math.round(concurrency)))
      : DEFAULT_SETTINGS.concurrency,
    rateLimit: asString(raw.rateLimit, DEFAULT_SETTINGS.rateLimit),
    extraArgs: asString(raw.extraArgs, DEFAULT_SETTINGS.extraArgs),
    cookiesMode: (COOKIE_MODES.has(cookiesMode) ? cookiesMode : "none") as Settings["cookiesMode"],
    cookiesPath: asString(raw.cookiesPath, DEFAULT_SETTINGS.cookiesPath),
    // Migración desde el booleano «editorReady» de la 1.3.
    editorProfile: isEditorProfile(editorProfile)
      ? editorProfile
      : raw.editorReady === false
        ? "original"
        : DEFAULT_SETTINGS.editorProfile,
    keepMaster,
  };
}

export async function loadSettings(): Promise<Settings> {
  const stored = await loadSection<Settings>("settings", sanitize);
  return stored ?? { ...DEFAULT_SETTINGS };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await saveSection("settings", SETTINGS_VERSION, settings);
}
