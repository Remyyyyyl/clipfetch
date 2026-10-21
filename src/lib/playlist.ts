import type { YtDlpEntry } from "../types";

/** Cuántos elementos de una lista larga se pintan como máximo. */
export const MAX_LISTED_ENTRIES = 300;

/**
 * Posición real del elemento dentro de la playlist (la que entiende `yt-dlp -I`).
 */
export function entryPosition(entry: YtDlpEntry, index: number): number {
  const value = Number(entry.playlist_index);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : index + 1;
}

export function entryPositions(entries: YtDlpEntry[]): number[] {
  return entries.map((entry, index) => entryPosition(entry, index));
}

/**
 * Comprime los índices seleccionados al formato de `yt-dlp -I` ("1-3,7,10-12").
 * Devuelve `null` si no hay selección válida y `""` si la selección está vacía.
 */
export function buildPlaylistItems(selected: Iterable<number>): string | null {
  const sorted = [...new Set(selected)]
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => a - b);

  if (sorted.length === 0) return "";

  const parts: string[] = [];
  let start = sorted[0];
  let previous = sorted[0];

  for (const value of sorted.slice(1)) {
    if (value === previous + 1) {
      previous = value;
      continue;
    }
    parts.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = value;
    previous = value;
  }
  parts.push(start === previous ? `${start}` : `${start}-${previous}`);

  return parts.join(",");
}

export function isFullSelection(selected: Set<number>, positions: number[]): boolean {
  if (positions.length === 0) return false;
  if (selected.size !== positions.length) return false;
  return positions.every((position) => selected.has(position));
}
