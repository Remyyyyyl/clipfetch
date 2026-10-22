import type { Job, JobPlanPayload } from "../types";

/** Presets que descargan vídeo y audio por separado y luego los unen. */
const MERGED_PRESETS = new Set(["best", "1080", "720", "480"]);

export function expectedFiles(preset: string): number {
  return MERGED_PRESETS.has(preset) ? 2 : 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface ProgressAggregate {
  percent: number;
  filesDone: number;
  filesTotal: number;
  filePercent: number;
  entryIndex: number;
}

/**
 * Convierte el porcentaje de un único archivo en el progreso total del trabajo.
 *
 * yt-dlp descarga el vídeo y el audio como archivos distintos y reinicia el
 * contador en cada uno; sin agregarlo, la barra llegaba al 100 % y volvía a 0 %.
 * El resultado nunca retrocede y el 100 % solo se alcanza al confirmar el
 * trabajo.
 */
export function aggregateProgress(job: Job, payloadPercent: number): ProgressAggregate {
  const entryTotal = Math.max(1, job.request.totalItems ?? 1);
  const filesTotal = Math.max(1, job.filesTotal ?? expectedFiles(job.request.preset));
  const entryIndex = clamp(job.entryIndex ?? 1, 1, entryTotal);

  let filesDone = clamp(job.filesDone ?? 0, 0, filesTotal - 1);
  const filePercent = clamp(Number.isFinite(payloadPercent) ? payloadPercent : 0, 0, 100);
  const previousPercent = clamp(job.filePercent ?? 0, 0, 100);

  // Un salto hacia atrás grande significa que empieza el siguiente archivo.
  if (filePercent + 5 < previousPercent && filesDone + 1 < filesTotal) {
    filesDone += 1;
  }

  const slice = (filesDone + filePercent / 100) / filesTotal;
  const overall = ((entryIndex - 1 + slice) / entryTotal) * 100;

  return {
    percent: clamp(Math.max(job.percent, overall), 0, 99),
    filesDone,
    filesTotal,
    filePercent,
    entryIndex,
  };
}

/**
 * `job://plan` llega una vez por vídeo con cuántos archivos lo componen.
 * En playlists, cada plan nuevo indica además que empieza otro vídeo.
 */
export function applyPlan(job: Job, payload: JobPlanPayload): Partial<Job> {
  const entryTotal = Math.max(1, job.request.totalItems ?? 1);
  const firstPlan = job.filesTotal === undefined;
  const entryIndex = firstPlan ? 1 : Math.min(entryTotal, (job.entryIndex ?? 1) + 1);

  return {
    filesTotal: Math.max(1, Math.round(payload.files)),
    filesDone: 0,
    filePercent: 0,
    entryIndex,
  };
}

export function filesLabel(job: Job): string {
  const total = job.filesTotal ?? expectedFiles(job.request.preset);
  if (total <= 1) return "";
  return `${Math.min(total, (job.filesDone ?? 0) + 1)}/${total}`;
}

export function entryLabel(job: Job): string {
  const total = Math.max(1, job.request.totalItems ?? 1);
  if (total <= 1) return "";
  return `${Math.min(total, job.entryIndex ?? 1)}/${total}`;
}
