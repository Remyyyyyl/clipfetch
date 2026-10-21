import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";
import type {
  DownloadRequest,
  EngineProgress,
  EngineStatus,
  Job,
  Settings,
  YtDlpInfo,
} from "./types";

const STORAGE_KEY = "clipfetch.settings.v1";

const DEFAULT_SETTINGS: Settings = {
  outputDir: "",
  preset: "best",
  concurrency: 2,
  rateLimit: "",
  extraArgs: "",
  cookiesMode: "none",
  cookiesPath: "",
};

const PRESETS = [
  { value: "best", label: "Mejor calidad" },
  { value: "1080", label: "MP4 1080p" },
  { value: "720", label: "MP4 720p" },
  { value: "480", label: "MP4 480p" },
  { value: "mp3", label: "MP3 320 kbps" },
  { value: "audio", label: "Solo audio original" },
];

const STATUS_LABELS: Record<Job["status"], string> = {
  queued: "En cola",
  starting: "Iniciando",
  downloading: "Descargando",
  completed: "Completado",
  error: "Error",
  cancelled: "Cancelado",
};

const STAGE_LABELS: Record<string, string> = {
  "yt-dlp": "yt-dlp",
  ffmpeg: "FFmpeg",
  deno: "Deno",
};

interface JobProgressPayload {
  jobId: string;
  status: string;
  downloaded: number | null;
  total: number | null;
  speed: number | null;
  eta: number | null;
  percent: number | null;
}

interface JobDonePayload {
  jobId: string;
  filepath: string | null;
  outputDir: string;
  title: string;
}

interface JobErrorPayload {
  jobId: string;
  message: string;
}

interface JobLogPayload {
  jobId: string;
  line: string;
}

function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return "—";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatSpeed(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) return "—";
  return `${formatBytes(value)}/s`;
}

function formatDuration(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) return "—";
  const total = Math.round(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatEta(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) return "—";
  return formatDuration(value);
}

function thumbnailOf(info: YtDlpInfo): string | undefined {
  if (info.thumbnail) return info.thumbnail;
  const thumbs = info.thumbnails || [];
  for (let index = thumbs.length - 1; index >= 0; index -= 1) {
    if (thumbs[index]?.url) return thumbs[index].url;
  }
  return undefined;
}

function safeMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [engineBusy, setEngineBusy] = useState(false);
  const [engineStage, setEngineStage] = useState("");
  const [enginePercent, setEnginePercent] = useState<number | null>(null);
  const [engineError, setEngineError] = useState("");
  const [url, setUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [info, setInfo] = useState<YtDlpInfo | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [preset, setPreset] = useState("best");
  const [isPlaylist, setIsPlaylist] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [globalError, setGlobalError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const startingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const status = await invoke<EngineStatus>("engine_status");
        const downloadDir = await invoke<string>("default_download_dir").catch(() => "");
        let loaded: Settings = { ...DEFAULT_SETTINGS };
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          try {
            loaded = { ...loaded, ...(JSON.parse(raw) as Partial<Settings>) };
          } catch {
            // Ignorar ajustes corruptos.
          }
        }
        if (!loaded.outputDir) loaded.outputDir = downloadDir;
        if (!disposed) {
          setEngine(status);
          setSettings(loaded);
          setPreset(loaded.preset);
        }
      } catch (error) {
        if (!disposed) setGlobalError(safeMessage(error));
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (settings) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
  }, [settings]);

  useEffect(() => {
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];

    const attach = async () => {
      const progress = await listen<JobProgressPayload>("job://progress", (event) => {
        const payload = event.payload;
        setJobs((previous) =>
          previous.map((job) => {
            if (job.id !== payload.jobId || job.status === "cancelled") return job;
            return {
              ...job,
              status: "downloading",
              percent: payload.percent ?? job.percent,
              downloaded: payload.downloaded ?? job.downloaded,
              total: payload.total ?? job.total,
              speed: payload.speed ?? job.speed,
              eta: payload.eta ?? job.eta,
            };
          }),
        );
      });
      if (disposed) {
        progress();
        return;
      }
      unlisteners.push(progress);

      unlisteners.push(
        await listen<JobDonePayload>("job://done", (event) => {
          const payload = event.payload;
          startingRef.current.delete(payload.jobId);
          setJobs((previous) =>
            previous.map((job) =>
              job.id === payload.jobId
                ? {
                    ...job,
                    status: "completed",
                    percent: 100,
                    speed: null,
                    eta: null,
                    filepath: payload.filepath,
                    outputDir: payload.outputDir,
                  }
                : job,
            ),
          );
        }),
      );

      unlisteners.push(
        await listen<JobErrorPayload>("job://error", (event) => {
          const payload = event.payload;
          startingRef.current.delete(payload.jobId);
          setJobs((previous) =>
            previous.map((job) =>
              job.id === payload.jobId
                ? { ...job, status: "error", error: payload.message, speed: null, eta: null }
                : job,
            ),
          );
        }),
      );

      unlisteners.push(
        await listen<{ jobId: string }>("job://cancelled", (event) => {
          startingRef.current.delete(event.payload.jobId);
          setJobs((previous) =>
            previous.map((job) =>
              job.id === event.payload.jobId
                ? { ...job, status: "cancelled", speed: null, eta: null }
                : job,
            ),
          );
        }),
      );

      unlisteners.push(
        await listen<JobLogPayload>("job://log", (event) => {
          const payload = event.payload;
          setJobs((previous) =>
            previous.map((job) =>
              job.id === payload.jobId
                ? { ...job, log: [...job.log.slice(-399), payload.line] }
                : job,
            ),
          );
        }),
      );
    };

    void attach();
    return () => {
      disposed = true;
      for (const unlisten of unlisteners) unlisten();
    };
  }, []);

  useEffect(() => {
    if (!settings) return;
    const limit = Math.max(1, settings.concurrency);
    const active = jobs.filter(
      (job) => job.status === "starting" || job.status === "downloading",
    ).length;
    if (active >= limit) return;

    const next = jobs.find(
      (job) => job.status === "queued" && !startingRef.current.has(job.id),
    );
    if (!next) return;

    startingRef.current.add(next.id);
    setJobs((previous) =>
      previous.map((job) => (job.id === next.id ? { ...job, status: "starting" } : job)),
    );

    void invoke<string>("start_download", { req: next.request })
      .then(() => {
        setJobs((previous) =>
          previous.map((job) =>
            job.id === next.id && job.status === "starting"
              ? { ...job, status: "downloading" }
              : job,
          ),
        );
      })
      .catch((error) => {
        startingRef.current.delete(next.id);
        setJobs((previous) =>
          previous.map((job) =>
            job.id === next.id
              ? { ...job, status: "error", error: safeMessage(error) }
              : job,
          ),
        );
      });
  }, [jobs, settings]);

  const updateSettings = (patch: Partial<Settings>) => {
    setSettings((previous) => (previous ? { ...previous, ...patch } : previous));
  };

  const installEngine = async () => {
    setEngineBusy(true);
    setEngineError("");
    setEnginePercent(0);
    setEngineStage("Iniciando");
    const unlisten = await listen<EngineProgress>("engine://progress", (event) => {
      setEngineStage(event.payload.stage);
      setEnginePercent(event.payload.percent);
    });
    try {
      const status = await invoke<EngineStatus>("install_engine");
      setEngine(status);
      setEnginePercent(100);
    } catch (error) {
      setEngineError(safeMessage(error));
    } finally {
      unlisten();
      setEngineBusy(false);
    }
  };

  const updateEngine = async () => {
    setEngineBusy(true);
    setEngineError("");
    setEnginePercent(0);
    setEngineStage("yt-dlp");
    const unlisten = await listen<EngineProgress>("engine://progress", (event) => {
      setEngineStage(event.payload.stage);
      setEnginePercent(event.payload.percent);
    });
    try {
      const status = await invoke<EngineStatus>("update_ytdlp");
      setEngine(status);
      setEnginePercent(100);
    } catch (error) {
      setEngineError(safeMessage(error));
    } finally {
      unlisten();
      setEngineBusy(false);
    }
  };

  const analyze = async () => {
    if (!settings || !url.trim()) return;
    setAnalyzing(true);
    setAnalysisError("");
    setInfo(null);
    try {
      const result = await invoke<YtDlpInfo>("analyze_url", {
        url: url.trim(),
        cookiesMode: settings.cookiesMode,
        cookiesPath: settings.cookiesPath ? settings.cookiesPath : null,
      });
      setInfo(result);
      setIsPlaylist(result._type === "playlist");
    } catch (error) {
      setAnalysisError(safeMessage(error));
    } finally {
      setAnalyzing(false);
    }
  };

  const queueDownload = () => {
    if (!info || !settings) return;
    if (!settings.outputDir) {
      setGlobalError("Selecciona una carpeta de descarga en los ajustes.");
      setShowSettings(true);
      return;
    }

    const jobId = crypto.randomUUID();
    const targetUrl = info.webpage_url || url.trim();
    const title = info.title || info.id || "Video";

    const request: DownloadRequest = {
      jobId,
      url: targetUrl,
      title,
      preset,
      outputDir: settings.outputDir,
      isPlaylist,
      cookiesMode: settings.cookiesMode,
      cookiesPath: settings.cookiesPath || null,
      rateLimit: settings.rateLimit || null,
      playlistItems: null,
      extraArgs: settings.extraArgs || null,
    };

    const job: Job = {
      id: jobId,
      title,
      url: targetUrl,
      status: "queued",
      percent: 0,
      downloaded: null,
      total: null,
      speed: null,
      eta: null,
      filepath: null,
      outputDir: settings.outputDir,
      error: "",
      log: [],
      request,
    };

    setJobs((previous) => [job, ...previous]);
    setGlobalError("");
  };

  const cancelJob = async (job: Job) => {
    startingRef.current.delete(job.id);
    try {
      await invoke("cancel_download", { jobId: job.id });
    } catch (error) {
      setGlobalError(safeMessage(error));
    }
    setJobs((previous) =>
      previous.map((item) =>
        item.id === job.id
          ? { ...item, status: "cancelled", speed: null, eta: null }
          : item,
      ),
    );
  };

  const retryJob = (job: Job) => {
    startingRef.current.delete(job.id);
    setJobs((previous) =>
      previous.map((item) =>
        item.id === job.id
          ? {
              ...item,
              status: "queued",
              percent: 0,
              downloaded: null,
              total: null,
              speed: null,
              eta: null,
              error: "",
              filepath: null,
              log: [],
            }
          : item,
      ),
    );
  };

  const openFolder = async (path: string) => {
    try {
      await invoke("open_folder", { path });
    } catch (error) {
      setGlobalError(safeMessage(error));
    }
  };

  const revealFile = async (path: string) => {
    try {
      await invoke("reveal_file", { path });
    } catch (error) {
      setGlobalError(safeMessage(error));
    }
  };

  const pickFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Carpeta de descargas",
    });
    if (typeof selected === "string") updateSettings({ outputDir: selected });
  };

  const pickCookiesFile = async () => {
    const selected = await open({
      multiple: false,
      title: "Archivo cookies.txt",
      filters: [{ name: "cookies.txt", extensions: ["txt"] }],
    });
    if (typeof selected === "string") {
      updateSettings({ cookiesPath: selected, cookiesMode: "file" });
    }
  };

  const activeCount = jobs.filter(
    (job) => job.status === "starting" || job.status === "downloading",
  ).length;
  const thumbnail = info ? thumbnailOf(info) : undefined;

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>ClipFetch</h1>
          <p className="muted small">Descargador de video y audio con yt-dlp</p>
        </div>
        <div className="topbar-actions">
          <span className={`engine-pill ${engine?.installed ? "ok" : "warn"}`}>
            {engine
              ? engine.installed
                ? `Motor listo · yt-dlp ${engine.ytdlpVersion}`
                : "Motor no instalado"
              : "Comprobando motor…"}
          </span>
          <button className="ghost" onClick={() => setShowSettings((value) => !value)}>
            {showSettings ? "Ocultar ajustes" : "Ajustes"}
          </button>
          {engine?.installed && (
            <button className="ghost" onClick={updateEngine} disabled={engineBusy}>
              {engineBusy ? "Actualizando…" : "Actualizar yt-dlp"}
            </button>
          )}
        </div>
      </header>

      {globalError && (
        <div className="alert">
          <span>{globalError}</span>
          <button className="link" onClick={() => setGlobalError("")}>
            Cerrar
          </button>
        </div>
      )}

      {engine && !engine.installed && (
        <section className="card setup">
          <div>
            <h2>Configura el motor</h2>
            <p>
              ClipFetch descarga una sola vez yt-dlp, FFmpeg y Deno (~250 MB de
              descarga, ~450 MB en disco). Se guardan en <code>{engine.dir}</code>.
            </p>
            <p className="muted small">
              Faltan: {engine.missing.join(", ") || "ninguno"}.
            </p>
          </div>
          <div className="setup-actions">
            {engineBusy && (
              <div className="engine-progress">
                <div className="progress-row">
                  <span>{STAGE_LABELS[engineStage] || engineStage || "Descargando"}</span>
                  <span>{enginePercent === null ? "" : `${Math.round(enginePercent)}%`}</span>
                </div>
                <progress value={enginePercent ?? undefined} max={100} />
              </div>
            )}
            {engineError && <p className="error small">{engineError}</p>}
            <button className="primary" onClick={installEngine} disabled={engineBusy}>
              {engineBusy ? "Instalando…" : "Instalar motor"}
            </button>
          </div>
        </section>
      )}

      {showSettings && settings && (
        <section className="card settings">
          <h2>Ajustes</h2>
          <div className="settings-grid">
            <label>
              Carpeta de descargas
              <div className="row">
                <input
                  value={settings.outputDir}
                  onChange={(event) => updateSettings({ outputDir: event.target.value })}
                  placeholder="C:\\Users\\TuUsuario\\Downloads"
                />
                <button onClick={pickFolder}>Elegir</button>
              </div>
            </label>

            <label>
              Descargas simultáneas
              <input
                type="number"
                min={1}
                max={5}
                value={settings.concurrency}
                onChange={(event) =>
                  updateSettings({
                    concurrency: Math.max(1, Math.min(5, Number(event.target.value) || 1)),
                  })
                }
              />
            </label>

            <label>
              Límite de velocidad (opcional)
              <input
                value={settings.rateLimit}
                onChange={(event) => updateSettings({ rateLimit: event.target.value })}
                placeholder="p. ej. 5M"
              />
            </label>

            <label>
              Cookies
              <select
                value={settings.cookiesMode}
                onChange={(event) =>
                  updateSettings({
                    cookiesMode: event.target.value as Settings["cookiesMode"],
                  })
                }
              >
                <option value="none">Sin cookies</option>
                <option value="firefox">Usar Firefox</option>
                <option value="file">Archivo cookies.txt</option>
              </select>
            </label>

            {settings.cookiesMode === "file" && (
              <label>
                Archivo de cookies
                <div className="row">
                  <input
                    value={settings.cookiesPath}
                    onChange={(event) => updateSettings({ cookiesPath: event.target.value })}
                    placeholder="C:\\ruta\\cookies.txt"
                  />
                  <button onClick={pickCookiesFile}>Elegir</button>
                </div>
              </label>
            )}

            <label className="full">
              Argumentos extra de yt-dlp (avanzado)
              <textarea
                rows={3}
                value={settings.extraArgs}
                onChange={(event) => updateSettings({ extraArgs: event.target.value })}
                placeholder="--embed-metadata --write-subs --sub-langs es"
              />
            </label>
          </div>
          <p className="muted small">
            Chrome y Edge en Windows no permiten extraer cookies de forma fiable. Usa
            Firefox o exporta un <code>cookies.txt</code> con una extensión. La opción
            <code> --exec</code> está bloqueada por seguridad.
          </p>
        </section>
      )}

      <main>
        <section className="card search">
          <form
            className="url-form"
            onSubmit={(event) => {
              event.preventDefault();
              void analyze();
            }}
          >
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="Pega una URL de YouTube u otro sitio compatible"
              spellCheck={false}
            />
            <button
              className="primary"
              type="submit"
              disabled={analyzing || !engine?.installed || !url.trim()}
            >
              {analyzing ? "Analizando…" : "Analizar"}
            </button>
          </form>
          <p className="muted small">
            También puedes pegar playlists, canales o URLs de otros sitios soportados
            por yt-dlp.
          </p>
          {analysisError && <p className="error">{analysisError}</p>}
        </section>

        {info && (
          <section className="card result">
            <div className="result-head">
              {thumbnail && (
                <img
                  className="thumb"
                  src={thumbnail}
                  alt=""
                  referrerPolicy="no-referrer"
                />
              )}
              <div className="result-info">
                <h2>{info.title || info.id || "Sin título"}</h2>
                <p className="muted">
                  {[info.uploader || info.channel, formatDuration(info.duration)]
                    .filter(Boolean)
                    .join(" · ") || " "}
                </p>
                {info._type === "playlist" && (
                  <p>
                    Playlist con <strong>{info.entries?.length ?? 0}</strong> elementos.
                  </p>
                )}
              </div>
            </div>

            <div className="controls">
              <label>
                Calidad / formato
                <select
                  value={preset}
                  onChange={(event) => {
                    setPreset(event.target.value);
                    updateSettings({ preset: event.target.value });
                  }}
                >
                  {PRESETS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Carpeta
                <div className="row">
                  <input
                    value={settings?.outputDir || ""}
                    onChange={(event) => updateSettings({ outputDir: event.target.value })}
                  />
                  <button onClick={pickFolder}>Elegir</button>
                </div>
              </label>

              {info._type === "playlist" && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={isPlaylist}
                    onChange={(event) => setIsPlaylist(event.target.checked)}
                  />
                  Descargar toda la playlist
                </label>
              )}

              <button className="primary" onClick={queueDownload} disabled={!engine?.installed}>
                Añadir a la cola
              </button>
            </div>

            {info._type === "playlist" && info.entries && info.entries.length > 0 && (
              <details className="entries">
                <summary>Ver primeros elementos</summary>
                <ol>
                  {info.entries.slice(0, 20).map((entry, index) => (
                    <li key={entry.id || index}>{entry.title || entry.url || "Sin título"}</li>
                  ))}
                </ol>
              </details>
            )}
          </section>
        )}

        <section className="card queue">
          <div className="section-head">
            <h2>Cola</h2>
            <span className="muted small">
              {jobs.length} elemento{jobs.length === 1 ? "" : "s"} · {activeCount} activo
              {activeCount === 1 ? "" : "s"}
            </span>
          </div>
          {jobs.length === 0 ? (
            <p className="muted">Aún no hay descargas. Pega una URL para empezar.</p>
          ) : (
            <div className="job-list">
              {jobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  onCancel={cancelJob}
                  onRetry={retryJob}
                  onOpenFolder={openFolder}
                  onRevealFile={revealFile}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="footer muted small">
        ClipFetch es código abierto. Descarga solo contenido propio o con permiso.
      </footer>
    </div>
  );
}

interface JobRowProps {
  job: Job;
  onCancel: (job: Job) => void;
  onRetry: (job: Job) => void;
  onOpenFolder: (path: string) => void;
  onRevealFile: (path: string) => void;
}

function JobRow({ job, onCancel, onRetry, onOpenFolder, onRevealFile }: JobRowProps) {
  const canCancel =
    job.status === "queued" || job.status === "starting" || job.status === "downloading";
  const canRetry = job.status === "error" || job.status === "cancelled";

  return (
    <article className={`job ${job.status}`}>
      <div className="job-head">
        <div className="job-title">
          <strong>{job.title}</strong>
          <span className={`badge ${job.status}`}>{STATUS_LABELS[job.status]}</span>
        </div>
        <div className="job-actions">
          {canCancel && <button onClick={() => onCancel(job)}>Cancelar</button>}
          {canRetry && <button onClick={() => onRetry(job)}>Reintentar</button>}
          {job.status === "completed" && job.filepath && (
            <button onClick={() => onRevealFile(job.filepath as string)}>Mostrar archivo</button>
          )}
          <button onClick={() => onOpenFolder(job.outputDir)}>Abrir carpeta</button>
        </div>
      </div>

      <progress value={job.percent} max={100} />
      <div className="job-meta muted small">
        <span>{Math.round(job.percent)}%</span>
        <span>
          {formatBytes(job.downloaded)} / {formatBytes(job.total)}
        </span>
        <span>{formatSpeed(job.speed)}</span>
        <span>ETA {formatEta(job.eta)}</span>
      </div>

      {job.error && <p className="error small">{job.error}</p>}

      <details className="log">
        <summary>Ver log</summary>
        <pre>{job.log.length ? job.log.join("\n") : "Sin salida todavía."}</pre>
      </details>
    </article>
  );
}

export default App;
