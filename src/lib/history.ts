import type { DownloadRequest, Job, JobStatus } from "../types";
import { loadSection, saveSection } from "./persistence";

export const HISTORY_VERSION = 1;

/** Tope de trabajos y de líneas de registro que se guardan en disco. */
const MAX_JOBS = 60;
const MAX_LOG_LINES = 80;

const STATUSES: JobStatus[] = [
  "queued",
  "starting",
  "downloading",
  "completed",
  "error",
  "cancelled",
];

const INTERRUPTED = "Se interrumpió al cerrar ClipFetch. Puedes reintentarlo.";

interface StoredJob extends Omit<Job, "log"> {
  log: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function clampPercent(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, number));
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function restoreRequest(value: unknown): DownloadRequest | null {
  if (!isRecord(value)) return null;
  const url = typeof value.url === "string" ? value.url.trim() : "";
  const jobId = typeof value.jobId === "string" ? value.jobId : "";
  if (!url || !jobId) return null;

  const totalItems = Number(value.totalItems);
  const clipStart = Number(value.clipStart);
  const clipEnd = Number(value.clipEnd);
  const hasClip =
    Number.isFinite(clipStart) &&
    Number.isFinite(clipEnd) &&
    clipStart >= 0 &&
    clipEnd > clipStart;

  return {
    jobId,
    url,
    title: typeof value.title === "string" ? value.title : "",
    preset: typeof value.preset === "string" ? value.preset : "best",
    outputDir: typeof value.outputDir === "string" ? value.outputDir : "",
    isPlaylist: value.isPlaylist === true,
    cookiesMode: typeof value.cookiesMode === "string" ? value.cookiesMode : "none",
    cookiesPath: optionalString(value.cookiesPath),
    rateLimit: optionalString(value.rateLimit),
    playlistItems: optionalString(value.playlistItems),
    extraArgs: optionalString(value.extraArgs),
    totalItems: Number.isFinite(totalItems) && totalItems > 0 ? Math.round(totalItems) : 1,
    clipStart: hasClip ? Math.round(clipStart) : null,
    clipEnd: hasClip ? Math.round(clipEnd) : null,
  };
}

function restoreJob(value: unknown): Job | null {
  if (!isRecord(value)) return null;

  const request = restoreRequest(value.request);
  if (!request) return null;

  const status = STATUSES.includes(value.status as JobStatus)
    ? (value.status as JobStatus)
    : "error";

  // Un trabajo que estaba en marcha al cerrar la app ya no tiene proceso detrás.
  const interrupted = status === "queued" || status === "starting" || status === "downloading";

  const log = Array.isArray(value.log)
    ? value.log.filter((line): line is string => typeof line === "string").slice(-MAX_LOG_LINES)
    : [];

  return {
    id: request.jobId,
    title: typeof value.title === "string" && value.title ? value.title : "Sin título",
    url: request.url,
    status: interrupted ? "error" : status,
    percent: clampPercent(value.percent),
    downloaded: null,
    total: null,
    speed: null,
    eta: null,
    filepath: optionalString(value.filepath),
    outputDir: request.outputDir,
    error: interrupted
      ? INTERRUPTED
      : typeof value.error === "string"
        ? value.error
        : "",
    log: interrupted ? [...log, INTERRUPTED] : log,
    thumbnail: optionalString(value.thumbnail) ?? undefined,
    uploader: optionalString(value.uploader) ?? undefined,
    duration: typeof value.duration === "number" ? value.duration : null,
    request,
    skipped: value.skipped === true,
  };
}

export function serializeJobs(jobs: Job[]): StoredJob[] {
  return jobs.slice(0, MAX_JOBS).map((job) => ({
    ...job,
    log: job.log.slice(-MAX_LOG_LINES),
    percent: clampPercent(job.percent),
  }));
}

export function restoreJobs(value: unknown): Job[] | null {
  if (!Array.isArray(value)) return null;
  const jobs: Job[] = [];
  for (const item of value) {
    const job = restoreJob(item);
    if (job) jobs.push(job);
    if (jobs.length >= MAX_JOBS) break;
  }
  return jobs;
}

export async function loadHistory(): Promise<Job[] | null> {
  return loadSection<Job[]>("history", restoreJobs);
}

export async function saveHistory(jobs: Job[]): Promise<void> {
  await saveSection("history", HISTORY_VERSION, serializeJobs(jobs));
}
