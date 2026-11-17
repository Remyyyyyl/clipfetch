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

export interface EngineUpdate {
  current: string;
  latest: string;
  updateAvailable: boolean;
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
  playlist_index?: number | null;
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
  audioPreset: string;
  concurrency: number;
  rateLimit: string;
  extraArgs: string;
  /** Copia que se crea para editar. El máster se descarga en máxima calidad. */
  editorProfile: EditorProfileId;
  /** Conservar el máster descargado junto a la copia de edición. */
  keepMaster: boolean;
}

export interface MediaEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number;
}

export interface LayoutState {
  columns: { left: number; right: number };
  rows: { top: number };
  workspace: { monitor: number };
  mediaVisible: boolean;
  clipsVisible: boolean;
}

export type ToolKind = "video" | "audio";

/** Perfil de la copia que se entrega al editor. */
export type EditorProfileId =
  | "premiere-1080"
  | "premiere-4k"
  | "prores-4k"
  | "original";

/** De dónde sale el archivo: un enlace (yt-dlp) o el disco. */
export type SourceKind = "url" | "file";

/** Archivo local leído con FFprobe, listo para el editor. */
export interface LocalMedia {
  path: string;
  title: string;
  duration: number | null;
  size: number;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  container: string;
  hasVideo: boolean;
  hasAudio: boolean;
  /** Ruta del JPEG de miniatura en la caché. */
  thumbnail: string | null;
  /** URL ya convertida con convertFileSrc. */
  thumbnailUrl?: string;
}

/** Elemento preparado en la cola, todavía sin descargar. */
export interface StagedItem {
  id: string;
  kind: ToolKind;
  source: SourceKind;
  url: string;
  localPath: string | null;
  title: string;
  thumbnail?: string;
  uploader?: string;
  duration?: number | null;
  sizeBytes?: number;
  resolution?: string;
  preset: string;
  clip: { start: number; end: number } | null;
  /** Recodificar para cortar en el fotograma exacto. */
  precise: boolean;
  isPlaylist: boolean;
  playlistItems: string | null;
  totalItems: number;
}

export interface DownloadRequest {
  jobId: string;
  source: SourceKind;
  /** Solo en origen local: ruta absoluta del archivo. */
  localPath: string | null;
  /** Herramienta con la que se creó el trabajo. */
  kind: ToolKind;
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
  /** Número de vídeos que abarca el trabajo (1 en un vídeo suelto, N en una playlist). */
  totalItems: number;
  /** Recorte en segundos desde el inicio. `null` = vídeo completo. */
  clipStart: number | null;
  clipEnd: number | null;
  /** Recodificar para cortar en el fotograma exacto. */
  precise: boolean;
  /** Perfil de la copia para editores. */
  editorProfile: EditorProfileId;
  /** Conservar el máster descargado. */
  keepMaster: boolean;
}

export interface Clip {
  id: string;
  start: number;
  end: number;
}

export interface PreviewStream {
  url: string;
}

/** Copia local preparada para el editor. */
export interface PreviewFile {
  path: string;
  kind: "video" | "audio";
  cached: boolean;
}

export interface PreviewProgress {
  requestId: string;
  stage: "preparing" | "downloading" | "processing" | "ready";
  percent: number | null;
  downloaded: number | null;
  total: number | null;
  speed: number | null;
  eta: number | null;
}

export interface PreviewState {
  status: "idle" | "loading" | "ready" | "error";
  url?: string;
  message?: string;
  /** Frecuencia de fotogramas del preview, si FFprobe pudo leerla. */
  fps?: number | null;
  /** 0–100 mientras se prepara la copia local. */
  progress?: number | null;
  /** Texto corto para la capa de carga. */
  detail?: string;
  /** true = archivo local; false = stream remoto de respaldo. */
  local?: boolean;
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
  thumbnail?: string;
  uploader?: string;
  duration?: number | null;
  request: DownloadRequest;
  /** Fase del progreso: "unknown", "preparing", "downloading" o "processing". */
  stage?: string;
  /** Archivo actual dentro del vídeo (0-based) y total de archivos que lo componen. */
  filesDone?: number;
  filesTotal?: number;
  /** Posición del vídeo dentro de la playlist (1-based) y total de vídeos. */
  entryIndex?: number;
  /** Porcentaje del archivo en curso, sin agregar. */
  filePercent?: number;
  /** El archivo ya existía en la carpeta y yt-dlp no lo volvió a descargar. */
  skipped?: boolean;
  /** Ruta del máster descargado, si se conserva junto a la copia. */
  masterPath?: string | null;
  /** Se está preparando la copia para edición. */
  converting?: boolean;
  /** 0–100 de la conversión en curso. */
  convertPercent?: number;
}

/** Payload del evento `job://plan`: cuántos archivos forman el vídeo actual. */
export interface JobPlanPayload {
  jobId: string;
  files: number;
  formatId: string;
}
