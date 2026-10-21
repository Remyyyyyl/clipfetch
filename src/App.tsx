import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./App.css";
import type {
  Clip,
  DownloadRequest,
  EngineProgress,
  EngineStatus,
  EngineUpdate,
  Job,
  JobPlanPayload,
  PreviewState,
  PreviewStream,
  Settings,
  YtDlpInfo,
} from "./types";
import { formatClock, safeMessage, thumbnailOf } from "./lib/format";
import { loadSettings, saveSettings } from "./lib/settings";
import { loadHistory, saveHistory } from "./lib/history";
import { useFileStorage } from "./lib/persistence";
import { buildPlaylistItems, entryPositions, isFullSelection } from "./lib/playlist";
import { aggregateProgress, applyPlan } from "./lib/progress";
import { LogBuffer } from "./lib/logBuffer";
import { EngineStatus as EngineStatusView } from "./components/EngineStatus";
import { Icon } from "./components/Icon";
import { Notice } from "./components/Notice";
import { QueuePanel } from "./components/QueuePanel";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { SetupScreen } from "./components/SetupScreen";
import { SourcePanel } from "./components/SourcePanel";
import { TimelineEditor } from "./components/TimelineEditor";
import { TransferPanel } from "./components/TransferPanel";

const MAX_LOG_LINES = 400;
const ALREADY_DOWNLOADED = /\[download\]\s+(.+?)\s+has already been downloaded/i;

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
  const [engineUpdate, setEngineUpdate] = useState<EngineUpdate | null>(null);
  const [bootError, setBootError] = useState("");
  const [url, setUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeSince, setAnalyzeSince] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [info, setInfo] = useState<YtDlpInfo | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [preset, setPreset] = useState("best");
  const [isPlaylist, setIsPlaylist] = useState(false);
  const [selection, setSelection] = useState<Set<number>>(() => new Set());
  const [jobs, setJobs] = useState<Job[]>([]);
  const [globalError, setGlobalError] = useState("");
  const [globalInfo, setGlobalInfo] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clips, setClips] = useState<Clip[]>([]);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [historyReady, setHistoryReady] = useState(false);
  const startingRef = useRef<Set<string>>(new Set());
  const previewTicketRef = useRef(0);
  const logBufferRef = useRef<LogBuffer | null>(null);

  if (logBufferRef.current === null) {
    logBufferRef.current = new LogBuffer((batch) => {
      setJobs((previous) => {
        let changed = false;
        const next = previous.map((job) => {
          const lines = batch.get(job.id);
          if (!lines || lines.length === 0) return job;
          changed = true;
          return {
            ...job,
            log: [...job.log.slice(-(MAX_LOG_LINES - lines.length)), ...lines],
          };
        });
        return changed ? next : previous;
      });
    });
  }

  const loadApp = useCallback(async () => {
    setBootError("");
    try {
      await useFileStorage();
      const [loaded, history, downloadDir, status] = await Promise.all([
        loadSettings(),
        loadHistory(),
        invoke<string>("default_download_dir").catch(() => ""),
        invoke<EngineStatus>("engine_status"),
      ]);
      if (!loaded.outputDir) loaded.outputDir = downloadDir;
      setEngine(status);
      setSettings(loaded);
      setPreset(loaded.preset);
      if (history && history.length > 0) setJobs(history);
      setHistoryReady(true);
    } catch (error) {
      setBootError(safeMessage(error));
    }
  }, []);

  useEffect(() => {
    void loadApp();
  }, [loadApp]);

  // B5: consulta la última nightly sin descargarla. Si falla, se ignora.
  useEffect(() => {
    if (!engine?.installed) return;
    let cancelled = false;
    void invoke<EngineUpdate | null>("check_engine_update")
      .then((update) => {
        if (!cancelled) setEngineUpdate(update ?? null);
      })
      .catch(() => {
        if (!cancelled) setEngineUpdate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [engine?.installed, engine?.ytdlpVersion]);

  useEffect(() => {
    if (settings) void saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (analyzeSince === null) {
      setElapsed(0);
      return;
    }
    setElapsed(0);
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - analyzeSince) / 1000));
    }, 500);
    return () => window.clearInterval(timer);
  }, [analyzeSince]);

  useEffect(() => {
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];
    const buffer = logBufferRef.current;

    const attach = async () => {
      const progress = await listen<JobProgressPayload>("job://progress", (event) => {
        const payload = event.payload;
        setJobs((previous) =>
          previous.map((job) => {
            if (job.id !== payload.jobId || job.status === "cancelled") return job;

            const aggregate = aggregateProgress(job, payload.percent ?? job.filePercent ?? 0);

            return {
              ...job,
              status: "downloading",
              percent: aggregate.percent,
              filesDone: aggregate.filesDone,
              filesTotal: aggregate.filesTotal,
              filePercent: aggregate.filePercent,
              entryIndex: aggregate.entryIndex,
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
        await listen<JobPlanPayload>("job://plan", (event) => {
          const payload = event.payload;
          setJobs((previous) =>
            previous.map((job) =>
              job.id === payload.jobId ? { ...job, ...applyPlan(job, payload) } : job,
            ),
          );
        }),
      );

      unlisteners.push(
        await listen<JobDonePayload>("job://done", (event) => {
          const payload = event.payload;
          buffer?.flushNow();
          startingRef.current.delete(payload.jobId);
          setJobs((previous) =>
            previous.map((job) =>
              job.id === payload.jobId
                ? {
                    ...job,
                    status: "completed",
                    percent: 100,
                    filePercent: 100,
                    filesDone: job.filesTotal ?? job.filesDone,
                    speed: null,
                    eta: null,
                    filepath: payload.filepath ?? job.filepath,
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
          buffer?.flushNow();
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
          buffer?.flushNow();
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
          const { jobId, line } = event.payload;

          const already = ALREADY_DOWNLOADED.exec(line);
          if (already) {
            const existing = already[1]?.trim();
            setJobs((previous) =>
              previous.map((job) =>
                job.id === jobId
                  ? { ...job, skipped: true, filepath: job.filepath ?? existing ?? null }
                  : job,
              ),
            );
          }

          buffer?.push(jobId, line);
        }),
      );
    };

    void attach();
    return () => {
      disposed = true;
      buffer?.dispose();
      for (const unlisten of unlisteners) unlisten();
    };
  }, []);

  // El historial se guarda solo cuando cambia algo estable del trabajo: guardar
  // en cada evento de progreso escribiría en disco varias veces por segundo.
  const historySignature = jobs
    .map(
      (job) =>
        `${job.id}:${job.status}:${job.filepath ?? ""}:${job.skipped ? 1 : 0}:${job.error}`,
    )
    .join("|");

  useEffect(() => {
    if (!historyReady) return;
    void saveHistory(jobs);
    // `jobs` se lee de la ejecución actual; la firma evita escrituras por progreso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historySignature, historyReady]);

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
      if (command === "update_ytdlp") setEngineUpdate(null);
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

  const loadPreview = useCallback(async (targetUrl: string, conf: Settings) => {
    const ticket = previewTicketRef.current + 1;
    previewTicketRef.current = ticket;
    setPreview({ status: "loading" });

    try {
      const stream = await invoke<PreviewStream>("preview_stream", {
        url: targetUrl,
        cookiesMode: conf.cookiesMode,
        cookiesPath: conf.cookiesPath || null,
      });
      if (previewTicketRef.current !== ticket) return;
      setPreview({ status: "ready", url: stream.url });
    } catch (error) {
      if (previewTicketRef.current !== ticket) return;
      setPreview({ status: "error", message: safeMessage(error) });
    }
  }, []);

  const analyze = async () => {
    if (!settings || !url.trim()) return;
    setAnalyzing(true);
    setAnalyzeSince(Date.now());
    setAnalysisError("");
    setInfo(null);
    setSelection(new Set());
    setClips([]);
    setPreview({ status: "idle" });
    previewTicketRef.current += 1;
    try {
      const result = await invoke<YtDlpInfo>("analyze_url", {
        url: url.trim(),
        cookiesMode: settings.cookiesMode,
        cookiesPath: settings.cookiesPath ? settings.cookiesPath : null,
      });
      const playlist = result._type === "playlist";
      setInfo(result);
      setIsPlaylist(playlist);
      setSelection(new Set(entryPositions(result.entries ?? [])));
      if (!playlist) {
        void loadPreview(result.webpage_url || url.trim(), settings);
      }
    } catch (error) {
      setAnalysisError(safeMessage(error));
    } finally {
      setAnalyzing(false);
      setAnalyzeSince(null);
    }
  };

  const positions = useMemo(() => entryPositions(info?.entries ?? []), [info]);

  const toggleItem = (position: number) => {
    setSelection((previous) => {
      const next = new Set(previous);
      if (next.has(position)) next.delete(position);
      else next.add(position);
      return next;
    });
  };

  const selectAll = () => setSelection(new Set(positions));
  const selectNone = () => setSelection(new Set());
  const selectRange = (from: number, to: number) => {
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    setSelection((previous) => {
      const next = new Set(previous);
      for (const position of positions) {
        if (position >= low && position <= high) next.add(position);
      }
      return next;
    });
  };

  const addClip = (start: number, end: number) => {
    if (clips.some((clip) => clip.start === start && clip.end === end)) {
      setGlobalInfo("Ese tramo ya está en la lista.");
      return;
    }
    setClips((previous) =>
      [...previous, { id: crypto.randomUUID(), start, end }].sort(
        (first, second) => first.start - second.start,
      ),
    );
    setGlobalInfo("");
  };

  const removeClip = (id: string) => {
    setClips((previous) => previous.filter((clip) => clip.id !== id));
  };

  const retryPreview = () => {
    if (!info || !settings) return;
    void loadPreview(info.webpage_url || url.trim(), settings);
  };

  const queueDownload = () => {
    if (!info || !settings) return;
    if (!settings.outputDir.trim()) {
      setSettingsOpen(true);
      setGlobalError("Elige una carpeta de descarga antes de continuar.");
      return;
    }

    const targetUrl = info.webpage_url || url.trim();
    const baseTitle = info.title || info.id || "Video";
    const clipMode = info._type !== "playlist" && clips.length > 0;

    let playlistItems: string | null = null;
    let totalItems = 1;

    if (isPlaylist) {
      const items = buildPlaylistItems(selection);
      if (!items) {
        setGlobalError("Selecciona al menos un vídeo de la lista.");
        return;
      }
      playlistItems = isFullSelection(selection, positions) ? null : items;
      totalItems = Math.max(1, selection.size);
    }

    const drafts = clipMode
      ? clips.map((clip) => ({
          start: clip.start,
          end: clip.end,
          title: `${baseTitle} · ${formatClock(clip.start)}–${formatClock(clip.end)}`,
        }))
      : [{ start: null, end: null, title: baseTitle }];

    const isActive = (job: Job) =>
      job.status === "queued" ||
      job.status === "starting" ||
      job.status === "downloading";

    // A4: un duplicado es mismo enlace y mismo tramo.
    const pending = drafts.filter(
      (draft) =>
        !jobs.some(
          (job) =>
            isActive(job) &&
            job.request.url === targetUrl &&
            (job.request.clipStart ?? null) === draft.start &&
            (job.request.clipEnd ?? null) === draft.end,
        ),
    );

    if (pending.length === 0) {
      setGlobalInfo(
        clipMode
          ? "Esos tramos ya están en la cola."
          : `«${baseTitle}» ya está en la cola.`,
      );
      return;
    }

    const created: Job[] = pending.map((draft) => {
      const jobId = crypto.randomUUID();
      const request: DownloadRequest = {
        jobId,
        url: targetUrl,
        title: baseTitle,
        preset,
        outputDir: settings.outputDir,
        isPlaylist: clipMode ? false : isPlaylist,
        cookiesMode: settings.cookiesMode,
        cookiesPath: settings.cookiesPath || null,
        rateLimit: settings.rateLimit || null,
        playlistItems: clipMode ? null : playlistItems,
        extraArgs: settings.extraArgs || null,
        totalItems: clipMode ? 1 : totalItems,
        clipStart: draft.start,
        clipEnd: draft.end,
      };

      return {
        id: jobId,
        title: draft.title,
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
        filesDone: 0,
        filesTotal: undefined,
        filePercent: 0,
        entryIndex: 1,
      };
    });

    setJobs((previous) => [...created, ...previous]);
    setGlobalError("");
    setGlobalInfo(
      pending.length < drafts.length ? "Algunos tramos ya estaban en la cola." : "",
    );
  };

  const cancelJob = async (job: Job) => {
    startingRef.current.delete(job.id);
    logBufferRef.current?.flushNow();
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
              skipped: false,
              filesDone: 0,
              filesTotal: undefined,
              filePercent: 0,
              entryIndex: 1,
              stage: undefined,
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
            update={engineUpdate}
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
          {globalInfo && (
            <Notice kind="info" onClose={() => setGlobalInfo("")}>
              {globalInfo}
            </Notice>
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
                  {analyzing
                    ? elapsed > 0
                      ? `Leyendo… ${elapsed} s`
                      : "Leyendo…"
                    : "Cargar"}
                </button>
              </div>
            </form>
            <p className="hint">
              {analyzing && elapsed >= 12
                ? "Las playlists y canales grandes tardan más en analizarse. Seguimos esperando."
                : "YouTube, playlists, canales y otros sitios compatibles con yt-dlp."}
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
                selectedItems={selection}
                onToggleItem={toggleItem}
                onSelectAll={selectAll}
                onSelectNone={selectNone}
                onSelectRange={selectRange}
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
                selectedCount={selection.size}
                playlistTotal={positions.length}
                clipCount={info._type !== "playlist" ? clips.length : 0}
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

          {info && info._type !== "playlist" && (info.duration ?? 0) > 1 && (
            <TimelineEditor
              title={info.title || info.id || "Video"}
              thumbnail={thumbnailOf(info)}
              duration={info.duration ?? 0}
              preview={preview}
              clips={clips}
              onRetryPreview={retryPreview}
              onAddClip={addClip}
              onRemoveClip={removeClip}
            />
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
        <span>ClipFetch {__APP_VERSION__}</span>
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
