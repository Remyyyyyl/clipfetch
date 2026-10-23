import { formatClock, formatDuration } from "./format";

export interface RulerTick {
  time: number;
  label: string;
}

export interface SnapCandidate {
  time: number;
  label: "Aguja" | "Corte" | "Marca";
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Pasos «redondos» que se leen bien en una regla de edición. */
const RULER_STEPS = [
  1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600,
  43200,
];

export function formatRulerTime(seconds: number, total: number): string {
  if (seconds <= 0) return total >= 3600 ? "00:00:00" : "0:00";
  return total >= 3600 ? formatClock(seconds) : formatDuration(seconds);
}

/**
 * Marcas mayores de la regla. Apunta a 4–6 etiquetas, incluye siempre el
 * final y evita que la última marca quede pegada a la anterior.
 */
export function buildRulerTicks(total: number): RulerTick[] {
  const safeTotal = Math.max(1, Math.floor(total));
  const target = safeTotal / 5;
  const step =
    RULER_STEPS.find((value) => value >= target) ??
    RULER_STEPS[RULER_STEPS.length - 1] ??
    60;
  const times: number[] = [];

  for (let time = 0; time <= safeTotal; time += step) {
    times.push(Math.round(time));
  }

  if (times.length === 0) times.push(0);
  const last = times[times.length - 1];
  if (last !== safeTotal) {
    if (times.length > 1 && safeTotal - last < step * 0.55) {
      times[times.length - 1] = safeTotal;
    } else {
      times.push(safeTotal);
    }
  }

  const unique = [...new Set(times)].filter((time) => time >= 0 && time <= safeTotal);
  return unique.map((time) => ({
    time,
    label: formatRulerTime(time, safeTotal),
  }));
}

/** Devuelve el candidato de imán más cercano dentro del umbral. */
export function findSnap(
  raw: number,
  candidates: SnapCandidate[],
  threshold: number,
): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const distance = Math.abs(candidate.time - raw);
    if (distance <= threshold && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/** Controles que ya tienen su propia activación con Espacio/flechas. */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest("button, a, summary, [role='slider'], [contenteditable='true']"),
  );
}
