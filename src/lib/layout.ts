import type { LayoutState } from "../types";
import { loadSection, saveSection } from "./persistence";

export const LAYOUT_VERSION = 1;

export const DEFAULT_LAYOUT: LayoutState = {
  columns: { left: 15, right: 26 },
  rows: { top: 64 },
  workspace: { monitor: 42 },
  mediaVisible: true,
  clipsVisible: true,
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function sanitize(value: unknown): LayoutState | null {
  if (value === null || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const columns = (raw.columns ?? {}) as Record<string, unknown>;
  const rows = (raw.rows ?? {}) as Record<string, unknown>;
  const workspace = (raw.workspace ?? {}) as Record<string, unknown>;

  return {
    columns: {
      left: clamp(columns.left, 12, 40, DEFAULT_LAYOUT.columns.left),
      right: clamp(columns.right, 18, 45, DEFAULT_LAYOUT.columns.right),
    },
    rows: {
      top: clamp(rows.top, 35, 78, DEFAULT_LAYOUT.rows.top),
    },
    workspace: {
      monitor: clamp(workspace.monitor, 28, 62, DEFAULT_LAYOUT.workspace.monitor),
    },
    mediaVisible:
      typeof raw.mediaVisible === "boolean"
        ? raw.mediaVisible
        : DEFAULT_LAYOUT.mediaVisible,
    clipsVisible:
      typeof raw.clipsVisible === "boolean"
        ? raw.clipsVisible
        : DEFAULT_LAYOUT.clipsVisible,
  };
}

export async function loadLayout(): Promise<LayoutState> {
  const stored = await loadSection<LayoutState>("layout", sanitize);
  return stored ?? { ...DEFAULT_LAYOUT };
}

export async function saveLayout(layout: LayoutState): Promise<void> {
  await saveSection("layout", LAYOUT_VERSION, layout);
}
