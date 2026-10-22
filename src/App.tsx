import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  EngineUpdate,
  Job,
  JobPlanPayload,
  PreviewState,
  PreviewStream,
  Settings,
  StagedItem,
  ToolKind,
  YtDlpInfo,
} from "./types";
import {
  AUDIO_PRESETS,
  VIDEO_PRESETS,
  formatClock,
  safeMessage,
  thumbnailOf,
} from "./lib/format";
import { loadSettings, saveSettings } from "./lib/settings";
import { loadHistory, saveHistory } from "./lib/history";
import { useFileStorage } from "./lib/persistence";
import { buildPlaylistItems, entryPositions, isFullSelection } from "./lib/playlist";
import { aggregateProgress, applyPlan } from "./lib/progress";
import { LogBuffer } from "./lib/logBuffer";
import { Icon } from "./components/Icon";
import { Notice } from "./components/Notice";
import { QueueRail } from "./components/QueueRail";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { SetupScreen } from "./components/SetupScreen";
import { ToolWorkspace } from "./components/ToolWorkspace";
import { TopBar } from "./components/TopBar";

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

  const [tool, setTool] = useState<ToolKind>("video");
  const [mode, setMode] = useState<"simple" | "advanced">("simple");
  const [url, setUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeSince, setAnalyzeSince] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [info, setInfo] = useState<YtDlpInfo | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [selection, setSelection] = useState<Set<number>>(() => new Set());
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [staged, setStaged] = useState<StagedItem[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [globalError, setGlobalError] = useState("");
  const [globalInfo, setGlobalInfo] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  const loadPreview = useCallback(
    async (targetUrl: string, conf: Settings, kind: ToolKind) => {
      const ticket = previewTicketRef.current + 1;
      previewTicketRef.current = ticket;
      setPreview({ status: "loading" });

      try {
        const stream = await invoke<PreviewStream>("preview_stream", {
          url: targetUrl,
          mode: kind === "audio" ? "audio" : "video",
          cookiesMode: conf.cookiesMode,
          cookiesPath: conf.cookiesPath || null,
        });
        if (previewTicketRef.current !== ticket) return;
        setPreview({ status: "ready", url: stream.url });
      } catch (error) {
        if (previewTicketRef.current !== ticket) return;
        setPreview({ status: "error", message: safeMessage(error) });
      }
    },
    [],
  );

  const analyze = async () => {
    if (!settings || !url.trim()) return;
    setAnalyzing(true);
    setAnalyzeSince(Date.now());
    setAnalysisError("");
    setInfo(null);
    setSelection(new Set());
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
      if (playlist) {
        setMode("simple");
        setSelection(new Set(entryPositions(result.entries ?? [])));
      } else {
        setSelection(new Set());
        void loadPreview(result.webpage_url || url.trim(), settings, tool);
      }
    } catch (error) {
      setAnalysisError(safeMessage(error));
    } finally {
      setAnalyzing(false);
      setAnalyzeSince(null);
    }
  };

  const changeTool = (next: ToolKind) => {
    if (next === tool) return;
    setTool(next);
    if (info && info._type !== "playlist" && settings) {
      void loadPreview(info.webpage_url || url.trim(), settings, next);
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

  const presets = tool === "video" ? VIDEO_PRESETS : AUDIO_PRESETS;
  const preset = settings
    ? tool === "video"
      ? settings.preset
      : settings.audioPreset
    : tool === "video"
      ? "best"
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
      url: targetUrl,
      title: baseTitle,
      thumbnail: thumbnailOf(info),
      uploader: info.uploader || info.channel,
      duration: info.duration,
      preset,
      clip: null,
      isPlaylist: playlist,
      playlistItems,
      totalItems,
    };

    setStaged((previous) => [...previous, item]);
    setGlobalError("");
    setGlobalInfo(playlist ? "Playlist añadida a la cola." : "Añadido a la cola.");
  };

  const stageClips = (ranges: Array<{ start: number; end: number }>) => {
    if (!info) return;
    const targetUrl = info.webpage_url || url.trim();
    const baseTitle = info.title || info.id || "Vídeo";

    const created = ranges
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
        url: targetUrl,
        title: baseTitle,
        thumbnail: thumbnailOf(info),
        uploader: info.uploader || info.channel,
        duration: info.duration,
        preset,
        clip: range,
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

  const canAdvanced = Boolean(
    info && info._type !== "playlist" && (info.duration ?? 0) > 1,
  );

  const previewRetry = () => {
    if (!info || !settings) return;
    void loadPreview(info.webpage_url || url.trim(), settings, tool);
  };

  if (!settings || !engine) {
    return <BootScreen error={bootError} onRetry={loadApp} />;
  }

  return (
    <div className="app-shell">
      <TopBar
        tool={tool}
        onToolChange={changeTool}
        engine={engine}
        engineBusy={engineBusy}
        enginePercent={enginePercent}
        engineStage={engineStage}
        engineUpdate={engineUpdate}
        onUpdateEngine={() => void runEngineTask("update_ytdlp")}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="app-body">
        <QueueRail
          staged={staged}
          jobs={jobs}
          activeCount={activeCount}
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

        <main className="canvas">
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

          {engine.installed ? (
            <ToolWorkspace
              tool={tool}
              mode={mode}
              onModeChange={setMode}
              canAdvanced={canAdvanced}
              url={url}
              onUrlChange={setUrl}
              analyzing={analyzing}
              elapsed={elapsed}
              onAnalyze={() => void analyze()}
              info={info}
              analysisError={analysisError}
              onClearAnalysisError={() => setAnalysisError("")}
              preview={preview}
              onRetryPreview={previewRetry}
              preset={preset}
              presetOptions={presets}
              onPresetChange={changePreset}
              outputDir={settings.outputDir}
              onOutputDirChange={(value) => updateSettings({ outputDir: value })}
              onPickFolder={pickFolder}
              onStage={stageSimple}
              isPlaylist={Boolean(isPlaylist)}
              selection={selection}
              positions={positions}
              onToggleItem={toggleItem}
              onSelectAll={selectAll}
              onSelectNone={selectNone}
              onSelectRange={selectRange}
              onAddClips={stageClips}
            />
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
        </main>
      </div>

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
