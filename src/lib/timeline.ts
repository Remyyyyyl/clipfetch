import { formatClock, formatDuration } from "./format";

export interface RulerTick {
  time: number;
  label: string | null;
  major: boolean;
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
 * Marcas de la regla para la ventana visible. Las marcas mayores llevan
 * etiqueta y las menores rellenan la escala como en un editor de vídeo.
 */
export function buildRulerTicks(viewStart: number, viewEnd: number): RulerTick[] {
  const start = Math.max(0, viewStart);
  const end = Math.max(start, viewEnd);
  const target = Math.max(0.5, end - start) / 5;
  const step =
    RULER_STEPS.find((value) => value >= target) ??
    RULER_STEPS[RULER_STEPS.length - 1] ??
    60;
  const minorStep = step / 5;
  const first = Math.ceil(start / minorStep - 1e-9) * minorStep;
  const ticks: RulerTick[] = [];
  const seen = new Set<string>();

  for (let time = first; time <= end + 1e-6; time += minorStep) {
    if (time < start - 1e-6 || time > end + 1e-6) continue;
    const rounded = Math.round(time * 1000) / 1000;
    const key = rounded.toFixed(3);
    if (seen.has(key)) continue;
    seen.add(key);
    const major = Math.abs(rounded / step - Math.round(rounded / step)) < 1e-6;
    ticks.push({
      time: rounded,
      label: major ? formatRulerTime(rounded, end) : null,
      major,
    });
  }

  return ticks;
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
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["range", "checkbox", "radio", "button", "submit", "reset"].includes(
      type,
    );
  }
  return tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}
