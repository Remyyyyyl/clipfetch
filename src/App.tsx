import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { confirm as confirmDialog, open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
  LayoutState,
  LocalMedia,
  PreviewFile,
  PreviewProgress,
  PreviewState,
  PreviewStream,
  Settings,
  SourceKind,
  StagedItem,
  ToolKind,
  YtDlpInfo,
} from "./types";
import {
  AUDIO_PRESETS,
  VIDEO_PRESETS,
  bestVideoPreset,
  formatBytes,
  formatClock,
  formatSpeed,
  safeMessage,
  thumbnailOf,
} from "./lib/format";
import { loadSettings, saveSettings } from "./lib/settings";
import { loadHistory, saveHistory } from "./lib/history";
import { DEFAULT_LAYOUT, loadLayout, saveLayout } from "./lib/layout";
import { useFileStorage } from "./lib/persistence";
import { buildPlaylistItems, entryPositions, isFullSelection } from "./lib/playlist";
import { aggregateProgress, applyPlan } from "./lib/progress";
import {
  LOCAL_EXTENSIONS,
  LOCAL_PRESET,
  isLocalMediaPath,
  resolutionLabel,
} from "./lib/local";
import { LogBuffer } from "./lib/logBuffer";
import { isEditableTarget } from "./lib/timeline";
import { ClipsPanel } from "./components/ClipsPanel";
import { ControlPanel } from "./components/ControlPanel";
import { Icon } from "./components/Icon";
import { MediaBrowser } from "./components/MediaBrowser";
import { MenuBar } from "./components/MenuBar";
import { Notice } from "./components/Notice";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { SetupScreen } from "./components/SetupScreen";
import { Workspace } from "./components/Workspace";
import type { EditorHandle } from "./components/TimelineEditor";

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

interface JobPostProcessPayload {
  jobId: string;
  percent: number | null;
}

function describePreviewProgress(
  payload: PreviewProgress,
  percent: number | null,
): string {
  const parts: string[] = [];
  if (percent !== null && Number.isFinite(percent)) {
    parts.push(`${Math.round(percent)} %`);
  }
  if (payload.downloaded && payload.downloaded > 0) {
    parts.push(
      payload.total && payload.total > 0
        ? `${formatBytes(payload.downloaded)} / ${formatBytes(payload.total)}`
        : formatBytes(payload.downloaded),
    );
  }
  if (payload.speed && payload.speed > 0) {
    parts.push(formatSpeed(payload.speed));
  }
  if (payload.stage === "processing") {
    parts.push("procesando");
  }
  return parts.join(" · ");
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

  const [tool, setTool] = useState<ToolKind>("video");
  const [mode, setMode] = useState<"simple" | "advanced">("simple");
  const [source, setSource] = useState<SourceKind>("url");
  const [url, setUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeSince, setAnalyzeSince] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [info, setInfo] = useState<YtDlpInfo | null>(null);
  const [local, setLocal] = useState<LocalMedia | null>(null);
  const [localPicking, setLocalPicking] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [selection, setSelection] = useState<Set<number>>(() => new Set());
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [staged, setStaged] = useState<StagedItem[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [globalError, setGlobalError] = useState("");
  const [globalInfo, setGlobalInfo] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [layout, setLayout] = useState<LayoutState>(DEFAULT_LAYOUT);
  const appRef = useRef<HTMLDivElement | null>(null);
  const resizeRef = useRef<{
    kind: "left" | "right" | "rows";
    startX: number;
    startY: number;
    startLeft: number;
    startRight: number;
    startTop: number;
    width: number;
    height: number;
  } | null>(null);

  const startingRef = useRef<Set<string>>(new Set());
  const previewTicketRef = useRef(0);
  const previewRequestRef = useRef("");
  const previewLocalRef = useRef(false);
  const inspectTicketRef = useRef(0);
  const analyzeTicketRef = useRef(0);
  const settingsRef = useRef<Settings | null>(null);
  const logBufferRef = useRef<LogBuffer | null>(null);

  const editorRef = useRef<EditorHandle | null>(null);
  const [clipSnapshot, setClipSnapshot] = useState<Clip[]>([]);
  const [clipSelection, setClipSelection] = useState<string[]>([]);
  const [editorHistory, setEditorHistory] = useState({
    canUndo: false,
    canRedo: false,
  });

  const handleClipsChange = useCallback((next: Clip[]) => {
    setClipSnapshot(next);
  }, []);

  const handleClipSelectionChange = useCallback((ids: string[]) => {
    setClipSelection(ids);
  }, []);

  const handleHistoryChange = useCallback(
    (state: { canUndo: boolean; canRedo: boolean }) => {
      setEditorHistory(state);
    },
    [],
  );

  useEffect(() => {
    setClipSnapshot([]);
    setClipSelection([]);
    setEditorHistory({ canUndo: false, canRedo: false });
  }, [source]);

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
      const [loaded, history, downloadDir, status, storedLayout] = await Promise.all([
        loadSettings(),
        loadHistory(),
        invoke<string>("default_download_dir").catch(() => ""),
        invoke<EngineStatus>("engine_status"),
        loadLayout(),
      ]);
      if (!loaded.outputDir) loaded.outputDir = downloadDir;
      setEngine(status);
      setSettings(loaded);
      setLayout(storedLayout);
      if (history && history.length > 0) setJobs(history);
      setHistoryReady(true);
    } catch (error) {
      setBootError(safeMessage(error));
    }
  }, []);

  useEffect(() => {
    void loadApp();
  }, [loadApp]);

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
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (settings) void saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!historyReady) return;
    const timer = window.setTimeout(() => {
      void saveLayout(layout);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [layout, historyReady]);

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
                    converting: false,
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
                ? { ...job, status: "error", error: payload.message, speed: null, eta: null, converting: false }
                : job,
            ),
          );
        }),
      );

      unlisteners.push(
        await listen<JobPostProcessPayload>("job://postprocess", (event) => {
          const { jobId, percent } = event.payload;
          setJobs((previous) =>
            previous.map((job) => {
              if (
                job.id !== jobId ||
                job.status === "cancelled" ||
                job.status === "completed" ||
                job.status === "error"
              ) {
                return job;
              }
              const next =
                percent === null || !Number.isFinite(percent)
                  ? job.convertPercent
                  : Math.round(Math.max(0, Math.min(100, percent)));
              return {
                ...job,
                status: "downloading",
                converting: true,
                convertPercent: next,
              };
            }),
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
                ? { ...job, status: "cancelled", speed: null, eta: null, converting: false }
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

      unlisteners.push(
        await listen<PreviewProgress>("preview://progress", (event) => {
          const payload = event.payload;
          if (payload.requestId !== previewRequestRef.current) return;

          setPreview((previous) => {
            if (previous.status !== "loading" || previous.local === false) {
              return previous;
            }
            const percent =
              payload.percent === null
                ? previous.progress ?? 0
                : Math.max(previous.progress ?? 0, payload.percent);
            const detail = describePreviewProgress(payload, percent);
            return {
              ...previous,
              local: true,
              progress: percent,
              detail: detail || previous.detail,
            };
          });
        }),
      );
    };

    void (async () => {
      // En dev, el primer listen puede llegar antes de que Tauri inyecte el IPC.
      // Se reintenta sin dejar promesas rechazadas sin manejar.
      for (let attempt = 0; attempt < 3 && !disposed; attempt += 1) {
        try {
          await attach();
          return;
        } catch {
          if (disposed || unlisteners.length > 0) return;
          await new Promise<void>((resolve) => setTimeout(resolve, 400));
        }
      }
    })();
    return () => {
      disposed = true;
      buffer?.dispose();
      for (const unlisten of unlisteners) unlisten();
    };
  }, []);

  const historySignature = jobs
    .map(
      (job) =>
        `${job.id}:${job.status}:${job.filepath ?? ""}:${job.skipped ? 1 : 0}:${job.error}`,
    )
    .join("|");

  useEffect(() => {
    if (!historyReady) return;
    void saveHistory(jobs);
    // La firma evita escribir en cada evento de progreso.
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

    const isLocal = next.request.source === "file";
    const started = isLocal
      ? invoke<string>("start_local_cut", {
          req: {
            jobId: next.id,
            inputPath: next.request.localPath ?? next.request.url,
            title: next.request.title,
            kind: next.request.kind,
            outputDir: next.request.outputDir,
            clipStart: next.request.clipStart ?? 0,
            clipEnd: next.request.clipEnd ?? 0,
            precise: next.request.precise,
            editorReady: next.request.editorReady,
          },
        })
      : invoke<string>("start_download", { req: next.request });

    void started
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

  const fetchRemotePreview = useCallback(
    async (
      targetUrl: string,
      conf: Settings,
      kind: ToolKind,
      ticket: number,
      localError?: string,
    ) => {
      previewLocalRef.current = false;
      setPreview({
        status: "loading",
        local: false,
        progress: null,
        detail: "Conectando con el stream del sitio…",
      });

      try {
        const stream = await invoke<PreviewStream>("preview_stream", {
          url: targetUrl,
          mode: kind === "audio" ? "audio" : "video",
          cookiesMode: conf.cookiesMode,
          cookiesPath: conf.cookiesPath || null,
        });
        if (previewTicketRef.current !== ticket) return;
        setPreview({ status: "ready", url: stream.url, local: false, progress: 100 });
      } catch (error) {
        if (previewTicketRef.current !== ticket) return;
        const remoteError = safeMessage(error);
        setPreview({
          status: "error",
          local: false,
          message: localError
            ? `No se pudo preparar la copia local (${localError}). Tampoco el stream remoto: ${remoteError}`
            : remoteError,
        });
      }
    },
    [],
  );

  const preparePreview = useCallback(
    async (
      targetUrl: string,
      conf: Settings,
      kind: ToolKind,
      duration: number | null,
      force = false,
    ) => {
      const ticket = previewTicketRef.current + 1;
      previewTicketRef.current = ticket;
      const requestId = crypto.randomUUID();
      previewRequestRef.current = requestId;
      previewLocalRef.current = false;
      setPreview({
        status: "loading",
        local: true,
        progress: 0,
        detail: "Preparando copia local…",
      });

      try {
        const file = await invoke<PreviewFile>("prepare_preview", {
          url: targetUrl,
          mode: kind === "audio" ? "audio" : "video",
          cookiesMode: conf.cookiesMode,
          cookiesPath: conf.cookiesPath || null,
          rateLimit: conf.rateLimit || null,
          duration:
            duration === null || !Number.isFinite(duration)
              ? null
              : Math.max(0, Math.floor(duration)),
          requestId,
          force,
        });
        if (previewTicketRef.current !== ticket) return;
        previewRequestRef.current = "";
        const previewUrl = convertFileSrc(file.path);
        setPreview({
          status: "ready",
          url: previewUrl,
          local: true,
          progress: 100,
          fps: null,
        });
        void invoke<number | null>("probe_fps", { path: file.path })
          .then((fps) => {
            if (previewTicketRef.current !== ticket) return;
            setPreview((previous) =>
              previous.status === "ready" && previous.url === previewUrl
                ? { ...previous, fps }
                : previous,
            );
          })
          .catch(() => {
            // Sin fps: el editor usa 30 y avisa.
          });
      } catch (error) {
        if (previewTicketRef.current !== ticket) return;
        previewRequestRef.current = "";
        await fetchRemotePreview(targetUrl, conf, kind, ticket, safeMessage(error));
      }
    },
    [fetchRemotePreview],
  );

  const prepareLocalPreview = useCallback(
    async (
      path: string,
      kind: ToolKind,
      duration: number | null,
      force = false,
    ) => {
      const ticket = previewTicketRef.current + 1;
      previewTicketRef.current = ticket;
      const requestId = crypto.randomUUID();
      previewRequestRef.current = requestId;
      previewLocalRef.current = true;
      setPreview({
        status: "loading",
        local: true,
        progress: 0,
        detail: "Preparando la vista previa del archivo…",
      });

      try {
        const file = await invoke<PreviewFile>("prepare_local_preview", {
          path,
          mode: kind === "audio" ? "audio" : "video",
          duration:
            duration === null || !Number.isFinite(duration)
              ? null
              : Math.max(0, Math.floor(duration)),
          requestId,
          force,
        });
        if (previewTicketRef.current !== ticket) return;
        previewRequestRef.current = "";
        const previewUrl = convertFileSrc(file.path);
        setPreview({
          status: "ready",
          url: previewUrl,
          local: true,
          progress: 100,
          fps: null,
        });
        void invoke<number | null>("probe_fps", { path: file.path })
          .then((fps) => {
            if (previewTicketRef.current !== ticket) return;
            setPreview((previous) =>
              previous.status === "ready" && previous.url === previewUrl
                ? { ...previous, fps }
                : previous,
            );
          })
          .catch(() => {
            // Sin fps: el editor usa 30 y avisa.
          });
      } catch (error) {
        if (previewTicketRef.current !== ticket) return;
        previewRequestRef.current = "";
        setPreview({ status: "error", local: true, message: safeMessage(error) });
      }
    },
    [],
  );

  const cancelPreview = useCallback((clear = true) => {
    const requestId = previewRequestRef.current;
    const isLocal = previewLocalRef.current;
    previewRequestRef.current = "";
    previewTicketRef.current += 1;
    if (requestId) {
      const command = isLocal ? "cancel_local_preview" : "cancel_preview";
      void invoke(command, { requestId }).catch(() => {
        // La cancelación es best-effort: si el proceso ya terminó, no hay nada que hacer.
      });
    }
    if (clear) setPreview({ status: "idle" });
  }, []);

  const analyze = async () => {
    if (!settings || !url.trim()) return;
    const ticket = analyzeTicketRef.current + 1;
    analyzeTicketRef.current = ticket;
    setAnalyzing(true);
    setAnalyzeSince(Date.now());
    setAnalysisError("");
    setInfo(null);
    setSelection(new Set());
    cancelPreview(true);
    try {
      const result = await invoke<YtDlpInfo>("analyze_url", {
        url: url.trim(),
        cookiesMode: settings.cookiesMode,
        cookiesPath: settings.cookiesPath ? settings.cookiesPath : null,
      });
      if (analyzeTicketRef.current !== ticket) return;
      const playlist = result._type === "playlist";
      setInfo(result);
      if (playlist) {
        setMode("simple");
        setSelection(new Set(entryPositions(result.entries ?? [])));
        updateSettings({ preset: "1080" });
      } else {
        setSelection(new Set());
        updateSettings({ preset: bestVideoPreset(result) });
      }
    } catch (error) {
      if (analyzeTicketRef.current !== ticket) return;
      setAnalysisError(safeMessage(error));
    } finally {
      if (analyzeTicketRef.current === ticket) {
        setAnalyzing(false);
        setAnalyzeSince(null);
      }
    }
  };

  const inspectLocalFile = useCallback(
    async (path: string) => {
      const target = path.trim();
      if (!target) return;
      if (!isLocalMediaPath(target)) {
        setAnalysisError("Elige un archivo de vídeo o audio compatible.");
        return;
      }

      const ticket = inspectTicketRef.current + 1;
      inspectTicketRef.current = ticket;
      analyzeTicketRef.current += 1;
      setAnalyzing(true);
      setAnalyzeSince(Date.now());
      setAnalysisError("");
      setGlobalError("");
      cancelPreview(true);
      setInfo(null);
      setLocal(null);

      try {
        const media = await invoke<LocalMedia>("inspect_local", { path: target });
        if (inspectTicketRef.current !== ticket) return;
        if (!media.duration || media.duration <= 1) {
          throw new Error(
            "No se pudo leer la duración del archivo. Prueba con otro formato o revisa que no esté dañado.",
          );
        }
        if (tool === "video" && !media.hasVideo) {
          throw new Error("Ese archivo no tiene pista de vídeo. Cambia a la herramienta Audio.");
        }
        if (tool === "audio" && !media.hasAudio) {
          throw new Error("Ese archivo no tiene pista de audio.");
        }
        setLocal({
          ...media,
          thumbnailUrl: media.thumbnail ? convertFileSrc(media.thumbnail) : undefined,
        });
        setMode("advanced");
      } catch (error) {
        if (inspectTicketRef.current !== ticket) return;
        setAnalysisError(safeMessage(error));
      } finally {
        if (inspectTicketRef.current === ticket) {
          setAnalyzing(false);
          setAnalyzeSince(null);
        }
      }
    },
    [tool, cancelPreview],
  );

  const pickLocalFile = async () => {
    if (localPicking) return;
    setLocalPicking(true);
    try {
      const selected = await open({
        multiple: false,
        title: "Abrir vídeo o audio",
        filters: [{ name: "Vídeo o audio", extensions: LOCAL_EXTENSIONS }],
      });
      if (typeof selected === "string") await inspectLocalFile(selected);
    } catch (error) {
      setGlobalError(safeMessage(error));
    } finally {
      setLocalPicking(false);
    }
  };

  const switchSource = (next: SourceKind) => {
    if (next === source) return;
    inspectTicketRef.current += 1;
    analyzeTicketRef.current += 1;
    cancelPreview(true);
    setSource(next);
    setInfo(null);
    setLocal(null);
    setSelection(new Set());
    setAnalysisError("");
    setAnalyzing(false);
    setAnalyzeSince(null);
    setMode(next === "file" ? "advanced" : "simple");
  };

  const confirmDiscardClips = async () => {
    if (clipSnapshot.length === 0) return true;
    try {
      return await confirmDialog(
        "Se descartarán los tramos del editor. ¿Quieres continuar?",
        { title: "Cambiar de fuente", kind: "warning" },
      );
    } catch {
      return true;
    }
  };

  const changeSource = async (next: SourceKind) => {
    if (next === source) return true;
    if (!(await confirmDiscardClips())) return false;
    switchSource(next);
    return true;
  };

  const changeTool = (next: ToolKind) => {
    if (next === tool) return;
    analyzeTicketRef.current += 1;
    inspectTicketRef.current += 1;
    setAnalyzing(false);
    setAnalyzeSince(null);
    setTool(next);
    setAnalysisError("");
    if (source === "file" && local) {
      const missing = next === "video" ? !local.hasVideo : !local.hasAudio;
      if (missing) {
        setLocal(null);
        cancelPreview(true);
        setAnalysisError(
          next === "video"
            ? "Ese archivo no tiene pista de vídeo. Cambia a la herramienta Audio."
            : "Ese archivo no tiene pista de audio.",
        );
      }
    }
  };

  const positions = useMemo(() => entryPositions(info?.entries ?? []), [info]);
  const isPlaylist = info?._type === "playlist";

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
  const selectInvert = () =>
    setSelection((previous) => {
      const next = new Set<number>();
      for (const position of positions) {
        if (!previous.has(position)) next.add(position);
      }
      return next;
    });
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

  const selectAllRef = useRef(selectAll);
  selectAllRef.current = selectAll;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.altKey) return;
      if (isEditableTarget(event.target)) return;
      if (
        document.querySelector(".menu-dialog-layer") ||
        document.querySelector(".menu-dropdown") ||
        document.querySelector(".drawer-layer")
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      const editor = editorRef.current;
      const editorActive = Boolean(editor) && (mode === "advanced" || source === "file");
      const target = event.target as HTMLElement | null;
      const inPlaylist = Boolean(target?.closest?.(".playlist-picker"));

      if (key === "z" && !event.shiftKey) {
        if (!editorActive) return;
        event.preventDefault();
        editor?.undo();
      } else if (key === "y" || (key === "z" && event.shiftKey)) {
        if (!editorActive) return;
        event.preventDefault();
        editor?.redo();
      } else if (key === "a") {
        if (inPlaylist) {
          event.preventDefault();
          selectAllRef.current();
        } else if (editorActive) {
          event.preventDefault();
          editor?.selectAllClips();
        }
      } else if (key === "enter") {
        if (!editorActive) return;
        event.preventDefault();
        editor?.stageSelectedClips();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [mode, source]);

  const presets = tool === "video" ? VIDEO_PRESETS : AUDIO_PRESETS;
  const preset = settings
    ? tool === "video"
      ? settings.preset
      : settings.audioPreset
    : tool === "video"
      ? "1080"
      : "mp3-320";

  const changePreset = (value: string) => {
    updateSettings(tool === "video" ? { preset: value } : { audioPreset: value });
  };

  const stageSimple = () => {
    if (!info) return;
    const targetUrl = info.webpage_url || url.trim();
    const baseTitle = info.title || info.id || (tool === "video" ? "Vídeo" : "Audio");
    const playlist = info._type === "playlist";

    let playlistItems: string | null = null;
    let totalItems = 1;

    if (playlist) {
      const items = buildPlaylistItems(selection);
      if (!items) {
        setGlobalError("Selecciona al menos un vídeo de la lista.");
        return;
      }
      playlistItems = isFullSelection(selection, positions) ? null : items;
      totalItems = Math.max(1, selection.size);
    }

    const duplicate = staged.some(
      (item) =>
        item.url === targetUrl &&
        item.preset === preset &&
        item.clip === null &&
        item.isPlaylist === playlist &&
        item.playlistItems === playlistItems,
    );
    if (duplicate) {
      setGlobalInfo("Ese elemento ya está en la cola.");
      return;
    }

    const item: StagedItem = {
      id: crypto.randomUUID(),
      kind: tool,
      source: "url",
      url: targetUrl,
      localPath: null,
      title: baseTitle,
      thumbnail: thumbnailOf(info),
      uploader: info.uploader || info.channel,
      duration: info.duration,
      preset,
      clip: null,
      precise: false,
      isPlaylist: playlist,
      playlistItems,
      totalItems,
    };

    setStaged((previous) => [...previous, item]);
    setGlobalError("");
    setGlobalInfo(playlist ? "Playlist añadida a la cola." : "Añadido a la cola.");
  };

  const stageClips = (ranges: Array<{ start: number; end: number }>) => {
    if (source === "file") {
      if (!local) return;
      const targetPath = local.path;
      const created: StagedItem[] = ranges
        .filter(
          (range) =>
            !staged.some(
              (item) =>
                item.url === targetPath &&
                item.kind === tool &&
                item.preset === LOCAL_PRESET &&
                item.clip?.start === range.start &&
                item.clip?.end === range.end,
            ),
        )
        .map((range) => ({
          id: crypto.randomUUID(),
          kind: tool,
          source: "file" as const,
          url: targetPath,
          localPath: targetPath,
          title: local.title,
          thumbnail: local.thumbnailUrl,
          duration: local.duration,
          sizeBytes: local.size,
          resolution: resolutionLabel(local),
          preset: LOCAL_PRESET,
          clip: range,
          precise: false,
          isPlaylist: false,
          playlistItems: null,
          totalItems: 1,
        }));

      if (created.length === 0) {
        setGlobalInfo("Esos tramos ya están en la cola.");
        return;
      }

      setStaged((previous) => [...previous, ...created]);
      setGlobalError("");
      setGlobalInfo(
        `${created.length} ${created.length === 1 ? "tramo añadido" : "tramos añadidos"} a la cola.`,
      );
      return;
    }

    if (!info) return;
    const targetUrl = info.webpage_url || url.trim();
    const baseTitle = info.title || info.id || "Vídeo";

    const created: StagedItem[] = ranges
      .filter(
        (range) =>
          !staged.some(
            (item) =>
              item.url === targetUrl &&
              item.preset === preset &&
              item.clip?.start === range.start &&
              item.clip?.end === range.end,
          ),
      )
      .map((range) => ({
        id: crypto.randomUUID(),
        kind: tool,
        source: "url" as const,
        url: targetUrl,
        localPath: null,
        title: baseTitle,
        thumbnail: thumbnailOf(info),
        uploader: info.uploader || info.channel,
        duration: info.duration,
        preset,
        clip: range,
        precise: false,
        isPlaylist: false,
        playlistItems: null,
        totalItems: 1,
      }));

    if (created.length === 0) {
      setGlobalInfo("Esos tramos ya están en la cola.");
      return;
    }

    setStaged((previous) => [...previous, ...created]);
    setGlobalError("");
    setGlobalInfo(
      `${created.length} ${created.length === 1 ? "tramo añadido" : "tramos añadidos"} a la cola.`,
    );
  };

  const removeStaged = (id: string) => {
    setStaged((previous) => previous.filter((item) => item.id !== id));
  };

  const moveStaged = (id: string, direction: -1 | 1) => {
    setStaged((previous) => {
      const index = previous.findIndex((item) => item.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const reorderStaged = (fromId: string, toId: string) => {
    setStaged((previous) => {
      const from = previous.findIndex((item) => item.id === fromId);
      const to = previous.findIndex((item) => item.id === toId);
      if (from < 0 || to < 0 || from === to) return previous;
      const next = [...previous];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const buildJob = (item: StagedItem, conf: Settings): Job => {
    const jobId = crypto.randomUUID();
    const title = item.clip
      ? `${item.title} · ${formatClock(item.clip.start)}–${formatClock(item.clip.end)}`
      : item.title;

    const request: DownloadRequest = {
      jobId,
      source: item.source,
      localPath: item.localPath,
      kind: item.kind,
      url: item.url,
      title: item.title,
      preset: item.preset,
      outputDir: conf.outputDir,
      isPlaylist: item.isPlaylist,
      cookiesMode: conf.cookiesMode,
      cookiesPath: conf.cookiesPath || null,
      rateLimit: conf.rateLimit || null,
      playlistItems: item.playlistItems,
      extraArgs: conf.extraArgs || null,
      totalItems: item.totalItems,
      clipStart: item.clip?.start ?? null,
      clipEnd: item.clip?.end ?? null,
      precise: item.precise,
      editorReady: conf.editorReady,
    };

    return {
      id: jobId,
      title,
      url: item.url,
      status: "queued",
      percent: 0,
      downloaded: null,
      total: null,
      speed: null,
      eta: null,
      filepath: null,
      outputDir: conf.outputDir,
      error: "",
      log: [],
      thumbnail: item.thumbnail,
      uploader: item.uploader,
      duration: item.duration,
      request,
      filesDone: 0,
      filesTotal: undefined,
      filePercent: 0,
      entryIndex: 1,
    };
  };

  const exportQueue = () => {
    if (!settings || staged.length === 0) return;
    if (!settings.outputDir.trim()) {
      setSettingsOpen(true);
      setGlobalError("Elige una carpeta de descarga antes de exportar.");
      return;
    }

    const isActive = (job: Job) =>
      job.status === "queued" ||
      job.status === "starting" ||
      job.status === "downloading";

    const pending = staged.filter(
      (item) =>
        !jobs.some(
          (job) =>
            isActive(job) &&
            job.request.source === item.source &&
            job.request.kind === item.kind &&
            job.request.url === item.url &&
            (job.request.clipStart ?? null) === (item.clip?.start ?? null) &&
            (job.request.clipEnd ?? null) === (item.clip?.end ?? null),
        ),
    );

    if (pending.length === 0) {
      setGlobalInfo("Esos elementos ya están en marcha.");
      return;
    }

    const created = pending.map((item) => buildJob(item, settings));
    setJobs((previous) => [...created, ...previous]);
    setStaged((previous) => previous.filter((item) => !pending.includes(item)));
    setGlobalError("");
    setGlobalInfo(
      `${created.length} ${created.length === 1 ? "elemento en marcha" : "elementos en marcha"}.`,
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
          ? { ...item, status: "cancelled", speed: null, eta: null, converting: false }
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
              converting: false,
              convertPercent: 0,
            }
          : item,
      ),
    );
  };

  const clearCompleted = () => {
    setJobs((previous) => previous.filter((job) => job.status !== "completed"));
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

  const exitApp = async () => {
    if (activeCount > 0) {
      let confirmed = false;
      try {
        confirmed = await confirmDialog(
          "Hay descargas en curso. ¿Cerrar ClipFetch de todos modos?",
          { title: "Salir de ClipFetch", kind: "warning" },
        );
      } catch {
        confirmed = true;
      }
      if (!confirmed) return;
    }
    await getCurrentWindow().close();
  };

  const openLocalFromMenu = async () => {
    if (!(await changeSource("file"))) return;
    await pickLocalFile();
  };

  const analyzeFromMenu = async () => {
    if (!(await changeSource("url"))) return;
    if (url.trim()) await analyze();
  };

  const openLocalPath = async (path: string) => {
    if (!(await changeSource("file"))) return;
    await inspectLocalFile(path);
  };

  const selectClipsAll = () => editorRef.current?.selectAllClips();
  const selectClipsNone = () => editorRef.current?.clearClipSelection();
  const selectClipsInvert = () => editorRef.current?.invertClipSelection();
  const selectClipFromPanel = (id: string) => editorRef.current?.selectClip(id);
  const deleteClipFromPanel = (id: string) => editorRef.current?.deleteClip(id);

  const resetLayout = () => {
    setLayout(DEFAULT_LAYOUT);
  };

  const startResize =
    (kind: "left" | "right" | "rows") =>
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const rect = appRef.current?.getBoundingClientRect();
      if (!rect) return;
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Puntero sintético.
      }
      resizeRef.current = {
        kind,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: layout.columns.left,
        startRight: layout.columns.right,
        startTop: layout.rows.top,
        width: rect.width,
        height: rect.height,
      };
    };

  const moveResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize) return;
    event.preventDefault();
    if (resize.kind === "left" || resize.kind === "right") {
      const delta = ((event.clientX - resize.startX) / Math.max(1, resize.width)) * 100;
      setLayout((previous) => ({
        ...previous,
        columns: {
          ...previous.columns,
          left:
            resize.kind === "left"
              ? Math.min(40, Math.max(12, resize.startLeft + delta))
              : previous.columns.left,
          right:
            resize.kind === "right"
              ? Math.min(45, Math.max(18, resize.startRight - delta))
              : previous.columns.right,
        },
      }));
      return;
    }
    const delta =
      ((event.clientY - resize.startY) / Math.max(1, resize.height - 44)) * 100;
    setLayout((previous) => ({
      ...previous,
      rows: {
        top: Math.min(78, Math.max(35, resize.startTop + delta)),
      },
    }));
  };

  const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    resizeRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // La captura ya se liberó.
    }
  };

  const canAdvanced =
    source === "file"
      ? Boolean(local && (local.duration ?? 0) > 1)
      : Boolean(info && info._type !== "playlist" && (info.duration ?? 0) > 1);

  useEffect(() => {
    if (canAdvanced) return;
    setClipSnapshot([]);
    setClipSelection([]);
    setEditorHistory({ canUndo: false, canRedo: false });
  }, [canAdvanced]);

  const previewRetry = () => {
    if (source === "file") {
      if (!local) return;
      cancelPreview(false);
      void prepareLocalPreview(local.path, tool, local.duration, true);
      return;
    }
    if (!info || !settings) return;
    cancelPreview(false);
    void preparePreview(
      info.webpage_url || url.trim(),
      settings,
      tool,
      info.duration ?? null,
      true,
    );
  };

  useEffect(() => {
    if (source !== "url") return;
    if (!info || mode !== "advanced" || !canAdvanced) {
      if (previewRequestRef.current) cancelPreview(true);
      return;
    }

    const conf = settingsRef.current;
    if (!conf) return;
    const targetUrl = info.webpage_url || url.trim();
    if (!targetUrl) return;

    let disposed = false;
    const timer = window.setTimeout(() => {
      if (disposed) return;
      void preparePreview(targetUrl, conf, tool, info.duration ?? null);
    }, 60);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      cancelPreview(true);
    };
    // La calidad o la carpeta no deben reiniciar la copia local; solo el vídeo o la herramienta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, mode, info, tool, canAdvanced, preparePreview, cancelPreview]);

  useEffect(() => {
    if (source !== "file") return;
    if (!local || mode !== "advanced" || !canAdvanced) {
      if (previewRequestRef.current) cancelPreview(true);
      return;
    }

    let disposed = false;
    const timer = window.setTimeout(() => {
      if (disposed) return;
      void prepareLocalPreview(local.path, tool, local.duration, false);
    }, 60);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      cancelPreview(true);
    };
  }, [source, local, mode, tool, canAdvanced, prepareLocalPreview, cancelPreview]);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    const onEvent = (event: {
      payload:
        | { type: "enter"; paths: string[] }
        | { type: "over" }
        | { type: "drop"; paths: string[] }
        | { type: "leave" };
    }) => {
      if (event.payload.type === "leave") {
        setDragActive(false);
        return;
      }
      if (event.payload.type !== "drop") {
        setDragActive(true);
        return;
      }

      setDragActive(false);
      const target = event.payload.paths.find(isLocalMediaPath);
      if (!target) {
        setGlobalError("Suelta un archivo de vídeo o audio.");
        return;
      }
      if (event.payload.paths.length > 1) {
        setGlobalInfo("Se abre el primer archivo de vídeo o audio soltado.");
      }
      setSource("file");
      setMode("advanced");
      setInfo(null);
      setAnalysisError("");
      void inspectLocalFile(target);
    };

    void (async () => {
      for (let attempt = 0; attempt < 3 && !disposed; attempt += 1) {
        try {
          const stop = await getCurrentWebview().onDragDropEvent(onEvent);
          if (disposed) {
            stop();
            return;
          }
          unlisten = stop;
          return;
        } catch {
          if (disposed) return;
          await new Promise((resolve) => window.setTimeout(resolve, 400));
        }
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [inspectLocalFile]);

  if (!settings || !engine) {
    return <BootScreen error={bootError} onRetry={loadApp} />;
  }

  const hasCompleted = jobs.some((job) => job.status === "completed");
  const queueCount = staged.length + jobs.length;
  const editorActive = mode === "advanced" || source === "file";

  return (
    <div
      className={`app-shell${layout.clipsVisible ? "" : " is-clips-hidden"}${
        layout.mediaVisible ? "" : " is-media-hidden"
      }`}
      style={
        {
          "--col-left": `${layout.columns.left}%`,
          "--col-right": `${layout.columns.right}%`,
          "--row-top": `${layout.rows.top}fr`,
          "--row-bottom": `${100 - layout.rows.top}fr`,
          "--monitor-max": `${layout.workspace.monitor}vh`,
        } as CSSProperties
      }
    >
      <MenuBar
        engine={engine}
        engineBusy={engineBusy}
        enginePercent={enginePercent}
        engineStage={engineStage}
        engineUpdate={engineUpdate}
        onUpdateEngine={() => void runEngineTask("update_ytdlp")}
        onOpenSettings={() => setSettingsOpen(true)}
        canEdit={editorActive}
        canUndo={editorHistory.canUndo}
        canRedo={editorHistory.canRedo}
        onUndo={() => editorRef.current?.undo()}
        onRedo={() => editorRef.current?.redo()}
        canCut={clipSnapshot.length > 0}
        onCut={() => editorRef.current?.cutAtPlayhead()}
        canDelete={clipSelection.length > 0}
        onDelete={() => editorRef.current?.deleteSelectedClips()}
        onMarkIn={() => editorRef.current?.markIn()}
        onMarkOut={() => editorRef.current?.markOut()}
        playlistAvailable={Boolean(isPlaylist)}
        onPlaylistAll={selectAll}
        onPlaylistNone={selectNone}
        onPlaylistInvert={selectInvert}
        clipsAvailable={clipSnapshot.length > 0}
        onClipsAll={selectClipsAll}
        onClipsNone={selectClipsNone}
        onClipsInvert={selectClipsInvert}
        clipsVisible={layout.clipsVisible}
        mediaVisible={layout.mediaVisible}
        onToggleClips={() =>
          setLayout((previous) => ({
            ...previous,
            clipsVisible: !previous.clipsVisible,
          }))
        }
        onToggleMedia={() =>
          setLayout((previous) => ({
            ...previous,
            mediaVisible: !previous.mediaVisible,
          }))
        }
        onFit={() => editorRef.current?.fitView()}
        onResetLayout={resetLayout}
        onOpenLocal={() => void openLocalFromMenu()}
        onAnalyze={() => void analyzeFromMenu()}
        onExport={exportQueue}
        stagedCount={staged.length}
        hasCompleted={hasCompleted}
        onClearCompleted={clearCompleted}
        onExit={() => void exitApp()}
        queueCount={queueCount}
        jobs={jobs}
      />

      {engine.installed ? (
        <>
          <div className="left-column">
            <ControlPanel
              tool={tool}
              onToolChange={changeTool}
              mode={mode}
              onModeChange={setMode}
              canAdvanced={canAdvanced}
              source={source}
              onSourceChange={(next) => void changeSource(next)}
              url={url}
              onUrlChange={setUrl}
              analyzing={analyzing}
              elapsed={elapsed}
              onAnalyze={() => void analyze()}
              info={info}
              local={local}
              localPicking={localPicking}
              onPickLocal={() => void pickLocalFile()}
              analysisError={analysisError}
              onClearAnalysisError={() => setAnalysisError("")}
              preset={preset}
              presetOptions={presets}
              onPresetChange={changePreset}
              editorReady={settings.editorReady}
              outputDir={settings.outputDir}
              onOutputDirChange={(value) => updateSettings({ outputDir: value })}
              onPickFolder={pickFolder}
              onStage={stageSimple}
              stageDisabled={Boolean(isPlaylist) && selection.size === 0}
            />

            <div
              className="layout-divider is-h"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Ajustar la altura de la botonera"
              onPointerDown={startResize("rows")}
              onPointerMove={moveResize}
              onPointerUp={endResize}
              onPointerCancel={endResize}
            />
            <MediaBrowser
              root={settings.outputDir}
              onOpenFile={(path) => void openLocalPath(path)}
            />
          </div>

          <Workspace
            tool={tool}
            mode={mode}
            canAdvanced={canAdvanced}
            source={source}
            info={info}
            local={local}
            analyzing={analyzing}
            elapsed={elapsed}
            preview={preview}
            preset={preset}
            monitorPercent={layout.workspace.monitor}
            onMonitorChange={(value) =>
              setLayout((previous) => ({
                ...previous,
                workspace: { monitor: value },
              }))
            }
            isPlaylist={Boolean(isPlaylist)}
            selection={selection}
            positions={positions}
            onToggleItem={toggleItem}
            onSelectAll={selectAll}
            onSelectNone={selectNone}
            onSelectRange={selectRange}
            onRetryPreview={previewRetry}
            onCancelPreview={() => cancelPreview(true)}
            onAddClips={stageClips}
            editorRef={editorRef}
            onClipsChange={handleClipsChange}
            onClipSelectionChange={handleClipSelectionChange}
            onHistoryChange={handleHistoryChange}
          >
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
          </Workspace>

          <div
            className="layout-divider is-v is-v-left"
            role="separator"
            aria-orientation="vertical"
            aria-label="Ajustar el ancho de la botonera"
            onPointerDown={startResize("left")}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />

          <ClipsPanel
            clips={clipSnapshot}
            clipSelection={clipSelection}
            simple={mode === "simple"}
            staged={staged}
            jobs={jobs}
            activeCount={activeCount}
            onSelectClip={selectClipFromPanel}
            onDeleteClip={deleteClipFromPanel}
            onRemoveStaged={removeStaged}
            onMoveStaged={moveStaged}
            onReorderStaged={reorderStaged}
            onExport={exportQueue}
            onCancel={cancelJob}
            onRetry={retryJob}
            onOpenFolder={openFolder}
            onRevealFile={revealFile}
            onClearCompleted={clearCompleted}
          />

          <div
            className="layout-divider is-v is-v-right"
            role="separator"
            aria-orientation="vertical"
            aria-label="Ajustar el ancho de la barra de clips"
            onPointerDown={startResize("right")}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />
        </>
      ) : (
        <section
          className="workspace setup-workspace"
          id="tool-panel"
          role="tabpanel"
          aria-labelledby={`tool-${tool}`}
        >
          <SetupScreen
            engine={engine}
            busy={engineBusy}
            percent={enginePercent}
            stage={engineStage}
            error={engineError}
            onInstall={() => void runEngineTask("install_engine")}
          />
        </section>
      )}

      {dragActive && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-card">
            <Icon name="film" size={30} />
            <strong>Suelta el vídeo o el audio</strong>
            <span>Se abrirá en el editor de tramos.</span>
          </div>
        </div>
      )}

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
