export interface EngineStatus {
  installed: boolean;
  dir: string;
  ytdlpVersion: string;
  ffmpegVersion: string;
  denoVersion: string;
  missing: string[];
}

export interface EngineProgress {
  stage: string;
  downloaded: number;
  total: number | null;
  percent: number | null;
}

export interface YtDlpFormat {
  format_id?: string;
  ext?: string;
  resolution?: string;
  height?: number | null;
  fps?: number | null;
  vcodec?: string;
  acodec?: string;
  filesize?: number | null;
  filesize_approx?: number | null;
  tbr?: number | null;
  format_note?: string;
}

export interface YtDlpEntry {
  id?: string;
  title?: string;
  url?: string;
  webpage_url?: string;
  duration?: number | null;
  thumbnail?: string;
}

export interface YtDlpInfo {
  _type?: string;
  id?: string;
  title?: string;
  fulltitle?: string;
  uploader?: string;
  channel?: string;
  duration?: number | null;
  thumbnail?: string;
  thumbnails?: { url?: string }[];
  webpage_url?: string;
  description?: string;
  view_count?: number | null;
  entries?: YtDlpEntry[];
  formats?: YtDlpFormat[];
}

export interface CookiesSettings {
  cookiesMode: "none" | "firefox" | "file";
  cookiesPath: string;
}

export interface Settings extends CookiesSettings {
  outputDir: string;
  preset: string;
  concurrency: number;
  rateLimit: string;
  extraArgs: string;
}

export interface DownloadRequest {
  jobId: string;
  url: string;
  title: string;
  preset: string;
  outputDir: string;
  isPlaylist: boolean;
  cookiesMode: string;
  cookiesPath: string | null;
  rateLimit: string | null;
  playlistItems: string | null;
  extraArgs: string | null;
}

export type JobStatus =
  | "queued"
  | "starting"
  | "downloading"
  | "completed"
  | "error"
  | "cancelled";

export interface Job {
  id: string;
  title: string;
  url: string;
  status: JobStatus;
  percent: number;
  downloaded: number | null;
  total: number | null;
  speed: number | null;
  eta: number | null;
  filepath: string | null;
  outputDir: string;
  error: string;
  log: string[];
  request: DownloadRequest;
}
