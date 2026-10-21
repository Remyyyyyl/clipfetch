import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./App.css";
import type {
  DownloadRequest,
  EngineProgress,
  EngineStatus,
  Job,
  Settings,
  YtDlpInfo,
} from "./types";
import { safeMessage, thumbnailOf } from "./lib/format";
import { EngineStatus as EngineStatusView } from "./components/EngineStatus";
import { Icon } from "./components/Icon";
import { Notice } from "./components/Notice";
import { QueuePanel } from "./components/QueuePanel";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { SetupScreen } from "./components/SetupScreen";
import { SourcePanel } from "./components/SourcePanel";
import { TransferPanel } from "./components/TransferPanel";

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

function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [engineBusy, setEngineBusy] = useState(false);
  const [engineStage, setEngineStage] = useState("");
  const [enginePercent, setEnginePercent] = useState<number | null>(null);
  const [engineError, setEngineError] = useState("");
  const [bootError, setBootError] = useState("");
  const [url, setUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [info, setInfo] = useState<YtDlpInfo | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [preset, setPreset] = useState("best");
  const [isPlaylist, setIsPlaylist] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [globalError, setGlobalError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const startingRef = useRef<Set<string>>(new Set());

  const loadApp = useCallback(async () => {
    setBootError("");
    try {
      const status = await invoke<EngineStatus>("engine_status");
      const downloadDir = await invoke<string>("default_download_dir").catch(() => "");
      let loaded: Settings = { ...DEFAULT_SETTINGS };
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        try {
          loaded = { ...loaded, ...(JSON.parse(raw) as Partial<Settings>) };
        } catch {
          // Ajustes corruptos: se usan los valores por defecto.
        }
      }
      if (!loaded.outputDir) loaded.outputDir = downloadDir;
      setEngine(status);
      setSettings(loaded);
      setPreset(loaded.preset);
    } catch (error) {
      setBootError(safeMessage(error));
    }
  }, []);

  useEffect(() => {
    void loadApp();
  }, [loadApp]);

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

  const runEngineTask = async (command: "install_engine" | "update_ytdlp") => {
    if (engineBusy) return;
    setEngineBusy(true);
    setEngineError("");
    setEnginePercent(0);
    setEngineStage(command === "update_ytdlp" ? "yt-dlp" : "");

    let unlisten: UnlistenFn | undefined;
    try {
      unlisten = await listen<EngineProgress>("engine://progress", (event) => {
        setEngineStage(event.payload.stage);
        setEnginePercent(event.payload.percent);
      });
      const status = await invoke<EngineStatus>(command);
      setEngine(status);
      setEnginePercent(100);
      setEngineStage("");
    } catch (error) {
      const message = safeMessage(error);
      if (command === "install_engine") {
        setEngineError(message);
      } else {
        setGlobalError(message);
      }
    } finally {
      unlisten?.();
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
    if (!settings.outputDir.trim()) {
      setSettingsOpen(true);
      setGlobalError("Elige una carpeta de descarga antes de continuar.");
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
      thumbnail: thumbnailOf(info),
      uploader: info.uploader || info.channel,
      duration: info.duration,
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

  if (!settings || !engine) {
    return <BootScreen error={bootError} onRetry={loadApp} />;
  }

  return (
    <div className="app-shell">
      <header className="deck-head">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="reel" size={26} />
          </span>
          <span className="brand-name">ClipFetch</span>
        </div>
        <div className="head-tools">
          <EngineStatusView
            engine={engine}
            busy={engineBusy}
            percent={enginePercent}
            stage={engineStage}
            onUpdate={() => void runEngineTask("update_ytdlp")}
          />
          {engine.installed && (
            <button
              type="button"
              className="button ghost"
              onClick={() => setSettingsOpen(true)}
              aria-label="Ajustes"
            >
              <Icon name="settings" size={16} />
              <span className="button-label">Ajustes</span>
            </button>
          )}
        </div>
      </header>

      {engine.installed ? (
        <main className="deck-main">
          {globalError && (
            <Notice onClose={() => setGlobalError("")}>{globalError}</Notice>
          )}
          {engineError && (
            <Notice
              kind="error"
              title="No se pudo actualizar yt-dlp"
              onClose={() => setEngineError("")}
            >
              {engineError}
            </Notice>
          )}

          <section className="intake">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void analyze();
              }}
            >
              <label htmlFor="source-url">Fuente</label>
              <div className="intake-row">
                <div className="intake-field">
                  <Icon name="film" size={18} />
                  <input
                    id="source-url"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://www.youtube.com/watch?v=…"
                    spellCheck={false}
                    autoFocus
                  />
                </div>
                <button
                  type="submit"
                  className="button solid"
                  disabled={analyzing || !url.trim()}
                >
                  {analyzing ? "Leyendo…" : "Cargar"}
                </button>
              </div>
            </form>
            <p className="hint">
              YouTube, playlists, canales y otros sitios compatibles con yt-dlp.
            </p>
          </section>

          {analysisError && (
            <Notice
              title="No se pudo leer la URL"
              onClose={() => setAnalysisError("")}
            >
              {analysisError}
            </Notice>
          )}

          {info ? (
            <div className="source-grid">
              <SourcePanel
                info={info}
                thumbnail={thumbnailOf(info)}
                isPlaylist={isPlaylist}
                onPlaylistChange={setIsPlaylist}
              />
              <TransferPanel
                preset={preset}
                onPresetChange={(value) => {
                  setPreset(value);
                  updateSettings({ preset: value });
                }}
                outputDir={settings.outputDir}
                onOutputDirChange={(value) => updateSettings({ outputDir: value })}
                onPickFolder={pickFolder}
                onDownload={queueDownload}
                isPlaylist={isPlaylist}
              />
            </div>
          ) : (
            <section className="empty-deck">
              <div className="empty-reel" aria-hidden="true">
                <Icon name="reel" size={30} />
              </div>
              <div>
                <h2>Carga una fuente</h2>
                <p>
                  Pega una URL para ver el formato, la calidad y la carpeta antes de
                  descargar.
                </p>
              </div>
            </section>
          )}

          <QueuePanel
            jobs={jobs}
            activeCount={activeCount}
            onCancel={cancelJob}
            onRetry={retryJob}
            onOpenFolder={openFolder}
            onRevealFile={revealFile}
          />
        </main>
      ) : (
        <SetupScreen
          engine={engine}
          busy={engineBusy}
          percent={enginePercent}
          stage={engineStage}
          error={engineError}
          onInstall={() => void runEngineTask("install_engine")}
        />
      )}

      <footer className="deck-foot">
        <span>ClipFetch 0.1.0</span>
        <span>Código abierto / MIT</span>
        <span>Descarga solo contenido propio o con permiso.</span>
      </footer>

      {settingsOpen && engine.installed && (
        <SettingsDrawer
          open={settingsOpen}
          settings={settings}
          onChange={updateSettings}
          onClose={() => setSettingsOpen(false)}
          onPickFolder={pickFolder}
          onPickCookiesFile={pickCookiesFile}
        />
      )}
    </div>
  );
}

interface BootScreenProps {
  error?: string;
  onRetry: () => void;
}

function BootScreen({ error, onRetry }: BootScreenProps) {
  return (
    <div className="boot">
      <div className="boot-brand">
        <Icon name="reel" size={34} />
        <span>ClipFetch</span>
      </div>
      {error ? (
        <div className="boot-error">
          <p>No se pudo comprobar el motor.</p>
          <Notice kind="error">{error}</Notice>
          <button type="button" className="button" onClick={onRetry}>
            Reintentar
          </button>
        </div>
      ) : (
        <>
          <div className="boot-tape" aria-hidden="true">
            <div className="boot-tape-fill" />
          </div>
          <p className="boot-text">Comprobando el motor…</p>
        </>
      )}
    </div>
  );
}

export default App;
