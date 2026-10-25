import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Clip, PreviewState, ToolKind } from "../types";
import { formatClock, formatDuration } from "../lib/format";
import {
  buildRulerTicks,
  clamp,
  findSnap,
  isEditableTarget,
  type SnapCandidate,
} from "../lib/timeline";
import { Icon } from "./Icon";

interface TimelineEditorProps {
  kind: ToolKind;
  title: string;
  sourceKey: string;
  thumbnail?: string;
  duration: number;
  preview: PreviewState;
  formatLabel: string;
  onRetryPreview: () => void;
  onCancelPreview: () => void;
  onAddClips: (ranges: Array<{ start: number; end: number }>) => void;
}

const MIN_CLIP = 1;
const SNAP_PX = 8;
const SNAP_MAX_SECONDS = 2;
const MIN_VIEW_SECONDS = 2;
const ZOOM_EDGE_PX = 6;

interface DragState {
  mode: "start" | "end" | "seek";
  rect: DOMRect;
  wasPlaying: boolean;
  viewStart: number;
  viewDuration: number;
}

interface BlockedState {
  side: "start" | "end";
}

interface HoverState {
  time: number;
}

interface SnapState {
  time: number;
  label: SnapCandidate["label"];
}

function timeAt(
  clientX: number,
  rect: DOMRect,
  viewStart: number,
  viewDuration: number,
): number {
  if (rect.width <= 0 || viewDuration <= 0) return viewStart;
  const ratio = (clientX - rect.left) / rect.width;
  return clamp(
    viewStart + ratio * viewDuration,
    Math.max(0, viewStart),
    viewStart + viewDuration,
  );
}

function formatVolume(value: number): string {
  return `${Math.round(value * 100)} %`;
}

export function TimelineEditor({
  kind,
  title,
  sourceKey,
  thumbnail,
  duration,
  preview,
  formatLabel,
  onRetryPreview,
  onCancelPreview,
  onAddClips,
}: TimelineEditorProps) {
  const total = Math.max(MIN_CLIP, Math.floor(duration || 0));
  const [clips, setClips] = useState<Clip[]>([]);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(() => Math.min(30, total));
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [snap, setSnap] = useState(true);
  const [snapTarget, setSnapTarget] = useState<SnapState | null>(null);
  const [blocked, setBlocked] = useState<BlockedState | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [dragging, setDragging] = useState<"start" | "end" | "seek" | null>(null);
  const [seeking, setSeeking] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [viewStart, setViewStart] = useState(0);
  const [zoomHover, setZoomHover] = useState<"pan" | "start" | "end" | null>(
    null,
  );

  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const blockedTimerRef = useRef<number | null>(null);
  const snapClearTimerRef = useRef<number | null>(null);
  const seekFrameRef = useRef<number | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const previewOnlySeekRef = useRef(false);
  const viewStartRef = useRef(0);
  const viewDurationRef = useRef(total);
  const zoomDragRef = useRef<{
    mode: "pan" | "start" | "end";
    startX: number;
    startView: number;
    startDuration: number;
    startEnd: number;
    rect: DOMRect;
  } | null>(null);
  const wheelHandlerRef = useRef<(event: WheelEvent) => void>(() => {});

  const minViewDuration = Math.min(MIN_VIEW_SECONDS, total);
  const viewDuration = total * Math.pow(minViewDuration / total, zoom);
  const maxViewStart = Math.max(0, total - viewDuration);
  const viewEnd = Math.min(total, viewStart + viewDuration);
  const canZoom = total > minViewDuration + 0.001;

  viewStartRef.current = viewStart;
  viewDurationRef.current = viewDuration;

  const setMedia = (element: HTMLVideoElement | HTMLAudioElement | null) => {
    mediaRef.current = element;
  };

  const rulerTicks = useMemo(
    () => buildRulerTicks(viewStart, viewEnd),
    [viewStart, viewEnd],
  );

  // Cambiar de vídeo reinicia el montaje. Cambiar de URL de preview no.
  useEffect(() => {
    pendingSeekRef.current = null;
    previewOnlySeekRef.current = false;
    if (seekFrameRef.current !== null) {
      cancelAnimationFrame(seekFrameRef.current);
      seekFrameRef.current = null;
    }
    setClips([]);
    setStart(0);
    setEnd(Math.min(30, total));
    setCurrent(0);
    setPlaying(false);
    setMediaFailed(false);
    setSnapTarget(null);
    setBlocked(null);
    setHover(null);
    setDragging(null);
    setZoom(0);
    setViewStart(0);
    dragRef.current = null;
  }, [sourceKey, total]);

  useEffect(() => {
    setViewStart((previous) => clamp(previous, 0, maxViewStart));
  }, [maxViewStart]);

  useEffect(() => {
    setPlaying(false);
    setMediaFailed(false);
    setSeeking(false);
  }, [preview.url]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    media.volume = volume;
    media.muted = muted;
  }, [volume, muted, preview.url]);

  useEffect(() => {
    return () => {
      if (blockedTimerRef.current !== null) window.clearTimeout(blockedTimerRef.current);
      if (snapClearTimerRef.current !== null) {
        window.clearTimeout(snapClearTimerRef.current);
      }
      if (seekFrameRef.current !== null) cancelAnimationFrame(seekFrameRef.current);
    };
  }, []);

  const flashBlocked = useCallback((side: "start" | "end") => {
    setBlocked({ side });
    if (blockedTimerRef.current !== null) window.clearTimeout(blockedTimerRef.current);
    blockedTimerRef.current = window.setTimeout(() => {
      blockedTimerRef.current = null;
      setBlocked(null);
    }, 900);
  }, []);

  const clearBlocked = useCallback(() => {
    if (blockedTimerRef.current !== null) {
      window.clearTimeout(blockedTimerRef.current);
      blockedTimerRef.current = null;
    }
    setBlocked(null);
  }, []);

  const ensureVisible = useCallback(
    (time: number) => {
      const start = viewStartRef.current;
      const duration = viewDurationRef.current;
      if (time >= start && time <= start + duration) return;
      const limit = Math.max(0, total - duration);
      setViewStart(clamp(time - duration / 2, 0, limit));
    },
    [total],
  );

  const seek = useCallback(
    (seconds: number, movePlayhead = true) => {
      const target = clamp(seconds, 0, total);
      previewOnlySeekRef.current = !movePlayhead;
      if (movePlayhead) {
        setCurrent(target);
        ensureVisible(target);
      }
      pendingSeekRef.current = target;
      if (seekFrameRef.current !== null) return;

      seekFrameRef.current = requestAnimationFrame(() => {
        seekFrameRef.current = null;
        const pending = pendingSeekRef.current;
        if (pending === null) return;
        const media = mediaRef.current;
        if (!media || media.readyState === 0) return;
        try {
          const fastSeek = (
            media as HTMLMediaElement & { fastSeek?: (time: number) => void }
          ).fastSeek;
          if (typeof fastSeek === "function") fastSeek.call(media, pending);
          else media.currentTime = pending;
        } catch {
          // Sin metadatos todavía: la aguja se mueve igual.
        }
      });
    },
    [total, ensureVisible],
  );

  const togglePlay = useCallback(() => {
    const media = mediaRef.current;
    if (!media || preview.status !== "ready" || mediaFailed) return;

    if (!media.paused) {
      media.pause();
      return;
    }

    const from = current < start || current >= end ? start : current;
    previewOnlySeekRef.current = false;
    ensureVisible(from);
    if (Math.abs(media.currentTime - from) > 0.2) {
      try {
        media.currentTime = from;
      } catch {
        // Sin metadatos.
      }
    }
    setCurrent(from);

    const result = media.play();
    if (result) {
      result.then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      setPlaying(true);
    }
  }, [preview.status, mediaFailed, current, start, end, ensureVisible]);

  const focusAndToggle = () => {
    sectionRef.current?.focus({ preventScroll: true });
    togglePlay();
  };

  const zoomAnchor = () =>
    current >= viewStart && current <= viewEnd
      ? current
      : viewStart + viewDuration / 2;

  const zoomTo = (
    nextZoom: number,
    anchorTime = zoomAnchor(),
    anchorRatio?: number,
  ) => {
    const next = clamp(nextZoom, 0, 1);
    const nextDuration = total * Math.pow(minViewDuration / total, next);
    const nextMaxStart = Math.max(0, total - nextDuration);
    let ratio = anchorRatio;

    if (ratio === undefined || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
      ratio = viewDuration > 0 ? (anchorTime - viewStart) / viewDuration : 0.5;
    }
    ratio = clamp(ratio, 0, 1);

    setZoom(next);
    setViewStart(clamp(anchorTime - nextDuration * ratio, 0, nextMaxStart));
  };

  const zoomFromDuration = (duration: number) => {
    if (!canZoom) return 0;
    const safe = clamp(duration, minViewDuration, total);
    return clamp(
      Math.log(safe / total) / Math.log(minViewDuration / total),
      0,
      1,
    );
  };

  const zoomBy = (delta: number) => {
    if (!canZoom) return;
    zoomTo(zoom + delta, zoomAnchor());
  };

  const fitView = () => {
    setZoom(0);
    setViewStart(0);
  };

  wheelHandlerRef.current = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      return;
    }
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;

    event.preventDefault();

    if (event.shiftKey) {
      const direction = (event.deltaY || event.deltaX) > 0 ? 1 : -1;
      setViewStart(
        clamp(viewStart + direction * viewDuration * 0.18, 0, maxViewStart),
      );
      return;
    }

    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const anchor = viewStart + ratio * viewDuration;
    const delta = event.deltaY < 0 ? 0.08 : -0.08;
    zoomTo(zoom + delta, anchor, ratio);
  };

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const handler = (event: WheelEvent) => wheelHandlerRef.current(event);
    track.addEventListener("wheel", handler, { passive: false });
    return () => track.removeEventListener("wheel", handler);
  }, []);

  const onZoomPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;

    const x = event.clientX - rect.left;
    const windowEl = event.currentTarget.querySelector<HTMLElement>(
      ".tl-zoombar-window",
    );
    const windowRect = windowEl?.getBoundingClientRect();
    const left = windowRect
      ? windowRect.left - rect.left
      : (viewStart / total) * rect.width;
    const right = windowRect
      ? windowRect.right - rect.left
      : ((viewStart + viewDuration) / total) * rect.width;
    const startDistance = Math.abs(x - left);
    const endDistance = Math.abs(x - right);
    let mode: "pan" | "start" | "end";
    let nextStart = viewStart;

    if (Math.min(startDistance, endDistance) <= ZOOM_EDGE_PX) {
      mode = startDistance <= endDistance ? "start" : "end";
    } else if (x > left && x < right) {
      mode = "pan";
    } else {
      const time = (x / rect.width) * total;
      nextStart = clamp(time - viewDuration / 2, 0, maxViewStart);
      setViewStart(nextStart);
      mode = "pan";
    }

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Puntero sintético o ya liberado.
    }

    zoomDragRef.current = {
      mode,
      startX: event.clientX,
      startView: nextStart,
      startDuration: viewDuration,
      startEnd: viewEnd,
      rect,
    };
    setZoomHover(mode);
  };

  const onZoomPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const drag = zoomDragRef.current;

    if (!drag) {
      const x = event.clientX - rect.left;
      const windowEl = event.currentTarget.querySelector<HTMLElement>(
        ".tl-zoombar-window",
      );
      const windowRect = windowEl?.getBoundingClientRect();
      const left = windowRect
        ? windowRect.left - rect.left
        : (viewStart / total) * rect.width;
      const right = windowRect
        ? windowRect.right - rect.left
        : ((viewStart + viewDuration) / total) * rect.width;
      const startDistance = Math.abs(x - left);
      const endDistance = Math.abs(x - right);

      if (Math.min(startDistance, endDistance) <= ZOOM_EDGE_PX) {
        setZoomHover(startDistance <= endDistance ? "start" : "end");
      } else if (x > left && x < right) {
        setZoomHover("pan");
      } else {
        setZoomHover(null);
      }
      return;
    }

    const deltaTime = ((event.clientX - drag.startX) / drag.rect.width) * total;

    if (drag.mode === "pan") {
      setViewStart(
        clamp(drag.startView + deltaTime, 0, total - drag.startDuration),
      );
      return;
    }

    if (!canZoom) return;

    if (drag.mode === "start") {
      const nextStart = clamp(
        drag.startView + deltaTime,
        0,
        drag.startEnd - minViewDuration,
      );
      const nextDuration = drag.startEnd - nextStart;
      setViewStart(nextStart);
      setZoom(zoomFromDuration(nextDuration));
    } else {
      const nextEnd = clamp(
        drag.startEnd + deltaTime,
        drag.startView + minViewDuration,
        total,
      );
      const nextDuration = nextEnd - drag.startView;
      setZoom(zoomFromDuration(nextDuration));
      setViewStart(drag.startView);
    }
  };

  const onZoomPointerUp = (event?: ReactPointerEvent<HTMLDivElement>) => {
    if (event) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // La captura ya se liberó.
      }
    }
    zoomDragRef.current = null;
    setZoomHover(null);
  };

  const onZoomPointerLeave = () => {
    if (!zoomDragRef.current) setZoomHover(null);
  };

  // La aguja se mueve con cada frame mientras hay reproducción.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;

    const tick = () => {
      const media = mediaRef.current;
      if (!media) return;
      const time = media.currentTime;
      setCurrent(time);

      if (time >= end - 0.04) {
        if (loop) {
          try {
            media.currentTime = start;
          } catch {
            // Sin metadatos.
          }
          setCurrent(start);
          frame = requestAnimationFrame(tick);
          return;
        }
        media.pause();
        setCurrent(end);
        setPlaying(false);
        return;
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, end, start, loop]);

  // Mientras se reproduce, la ventana sigue a la aguja para no perderla.
  useEffect(() => {
    if (!playing || viewDuration >= total - 0.001 || zoomDragRef.current) return;
    const left = viewStart + viewDuration * 0.05;
    const right = viewStart + viewDuration * 0.9;

    if (current < left) {
      setViewStart(clamp(current - viewDuration * 0.1, 0, maxViewStart));
    } else if (current > right) {
      setViewStart(clamp(current - viewDuration * 0.15, 0, maxViewStart));
    }
  }, [playing, current, viewStart, viewDuration, total, maxViewStart]);

  const markStart = useCallback(() => {
    const raw = Math.round(current);
    const max = Math.max(0, end - MIN_CLIP);
    const value = clamp(raw, 0, max);
    if (raw > max) flashBlocked("start");
    else clearBlocked();
    setStart(value);
    seek(value);
  }, [current, end, flashBlocked, clearBlocked, seek]);

  const markEnd = useCallback(() => {
    const raw = Math.round(current);
    const min = Math.min(total, start + MIN_CLIP);
    const value = clamp(raw, min, total);
    if (raw < min) flashBlocked("end");
    else clearBlocked();
    setEnd(value);
    seek(value);
  }, [current, start, total, flashBlocked, clearBlocked, seek]);

  const addWorkingClip = () => {
    if (end - start < MIN_CLIP) return;
    const range = { start: Math.round(start), end: Math.round(end) };
    setClips((previous) => {
      if (previous.some((clip) => clip.start === range.start && clip.end === range.end)) {
        return previous;
      }
      return [...previous, { id: crypto.randomUUID(), ...range }].sort(
        (first, second) => first.start - second.start,
      );
    });
  };

  const stageClips = () => {
    if (clips.length === 0) return;
    onAddClips(clips.map((clip) => ({ start: clip.start, end: clip.end })));
    setClips([]);
  };

  const baseSnapCandidates = useMemo<SnapCandidate[]>(() => {
    const list: SnapCandidate[] = [];
    for (const clip of clips) {
      if (clip.start >= viewStart && clip.start <= viewEnd) {
        list.push({ time: clip.start, label: "Corte" });
      }
      if (clip.end >= viewStart && clip.end <= viewEnd) {
        list.push({ time: clip.end, label: "Corte" });
      }
    }
    for (const tick of rulerTicks) {
      if (tick.major) list.push({ time: tick.time, label: "Marca" });
    }

    const seen = new Set<number>();
    return list.filter((candidate) => {
      if (seen.has(candidate.time)) return false;
      seen.add(candidate.time);
      return true;
    });
  }, [clips, rulerTicks, viewStart, viewEnd]);

  const resolveTime = useCallback(
    (raw: number, rect: DOMRect, bypass: boolean, includePlayhead = true) => {
      const rounded = Math.round(raw);
      if (!snap || bypass) {
        return { value: rounded, target: null as SnapState | null };
      }

      const threshold = Math.min(
        SNAP_MAX_SECONDS,
        (SNAP_PX / Math.max(1, rect.width)) * viewDuration,
      );
      const playhead = Math.round(current);
      if (
        includePlayhead &&
        playhead >= viewStart &&
        playhead <= viewEnd &&
        Math.abs(playhead - raw) <= threshold
      ) {
        return {
          value: playhead,
          target: { time: playhead, label: "Aguja" as const },
        };
      }

      const found = findSnap(raw, baseSnapCandidates, threshold);
      return found
        ? {
            value: found.time,
            target: { time: found.time, label: found.label },
          }
        : { value: rounded, target: null as SnapState | null };
    },
    [snap, viewDuration, viewStart, viewEnd, current, baseSnapCandidates],
  );

  const beginDrag = (mode: "start" | "end" | "seek", rect: DOMRect) => {
    const media = mediaRef.current;
    const wasPlaying = media ? !media.paused && !media.ended : false;
    if (wasPlaying && media) media.pause();
    clearBlocked();
    dragRef.current = {
      mode,
      rect,
      wasPlaying,
      viewStart,
      viewDuration,
    };
    setDragging(mode);
    setSnapTarget(null);
    setHover(null);
  };

  const onTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Puntero sintético o ya liberado.
    }
    beginDrag("seek", rect);
    sectionRef.current?.focus({ preventScroll: true });
    const resolved = resolveTime(
      timeAt(event.clientX, rect, viewStart, viewDuration),
      rect,
      event.altKey,
      false,
    );
    setSnapTarget(resolved.target);
    seek(resolved.value);
  };

  const onHandlePointerDown =
    (mode: "start" | "end") => (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return;
      event.currentTarget.focus();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Puntero sintético: seguimos con los eventos del track.
      }
      beginDrag(mode, rect);
      seek(mode === "start" ? start : end, false);
    };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      const rect = trackRef.current?.getBoundingClientRect();
      if (rect) {
        setHover({ time: timeAt(event.clientX, rect, viewStart, viewDuration) });
      }
      return;
    }

    const raw = timeAt(
      event.clientX,
      drag.rect,
      drag.viewStart,
      drag.viewDuration,
    );
    const resolved = resolveTime(raw, drag.rect, event.altKey, drag.mode !== "seek");
    setSnapTarget(resolved.target);

    if (drag.mode === "seek") {
      seek(resolved.value);
      return;
    }

    if (drag.mode === "start") {
      const max = Math.max(0, end - MIN_CLIP);
      const next = clamp(resolved.value, 0, max);
      if (resolved.value > max) {
        setSnapTarget(null);
        flashBlocked("start");
      } else {
        clearBlocked();
      }
      setStart(next);
      seek(next, false);
    } else {
      const min = Math.min(total, start + MIN_CLIP);
      const next = clamp(resolved.value, min, total);
      if (resolved.value < min) {
        setSnapTarget(null);
        flashBlocked("end");
      } else {
        clearBlocked();
      }
      setEnd(next);
      seek(next, false);
    }
  };

  const finishDrag = (event?: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragging(null);
    setHover(null);

    if (event) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // La captura ya se liberó.
      }
    }

    if (snapClearTimerRef.current !== null) {
      window.clearTimeout(snapClearTimerRef.current);
    }
    snapClearTimerRef.current = window.setTimeout(() => setSnapTarget(null), 650);

    if (drag.wasPlaying) {
      const media = mediaRef.current;
      if (media && media.paused) {
        const resumeAt = current < start || current >= end ? start : current;
        previewOnlySeekRef.current = false;
        if (Math.abs(media.currentTime - resumeAt) > 0.05) {
          try {
            media.currentTime = resumeAt;
          } catch {
            // Sin metadatos.
          }
        }
        setCurrent(resumeAt);
        const result = media.play();
        if (result) result.catch(() => setPlaying(false));
      }
    }
  };

  const onTrackPointerLeave = () => {
    if (!dragRef.current) setHover(null);
  };

  const onHandleKey =
    (mode: "start" | "end") => (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const value = mode === "start" ? start : end;
      const min = mode === "start" ? 0 : start + MIN_CLIP;
      const max = mode === "start" ? end - MIN_CLIP : total;
      const step = event.shiftKey ? 10 : 1;
      let next = value;

      switch (event.key) {
        case "ArrowLeft":
        case "ArrowDown":
          next -= step;
          break;
        case "ArrowRight":
        case "ArrowUp":
          next += step;
          break;
        case "Home":
          next = min;
          break;
        case "End":
          next = max;
          break;
        default:
          return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (next < min || next > max) flashBlocked(mode);
      else clearBlocked();
      next = clamp(next, min, max);
      if (mode === "start") setStart(next);
      else setEnd(next);
      seek(next, false);
    };

  const shortcutRef = useRef({
    togglePlay,
    seek,
    current,
    total,
    markStart,
    markEnd,
    zoomBy,
    fitView,
  });
  shortcutRef.current = {
    togglePlay,
    seek,
    current,
    total,
    markStart,
    markEnd,
    zoomBy,
    fitView,
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (isEditableTarget(event.target)) return;
      if (document.querySelector(".drawer-layer")) return;
      if (event.repeat && event.key === " ") return;

      const targetElement = event.target as HTMLElement | null;
      const isTimelineHandle = Boolean(targetElement?.closest?.(".tl-handle"));
      const isRangeInput =
        targetElement instanceof HTMLInputElement && targetElement.type === "range";
      const isNavigationKey =
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight" ||
        event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "Home" ||
        event.key === "End";
      if ((isTimelineHandle || isRangeInput) && isNavigationKey) {
        return;
      }

      const shortcuts = shortcutRef.current;
      const handle = (action: () => void) => {
        event.preventDefault();
        event.stopPropagation();
        action();
      };

      switch (event.key) {
        case " ":
          handle(shortcuts.togglePlay);
          break;
        case "ArrowLeft":
        case "ArrowRight": {
          handle(() => {
            const direction = event.key === "ArrowLeft" ? -1 : 1;
            shortcuts.seek(
              clamp(
                shortcuts.current + direction * (event.shiftKey ? 10 : 1),
                0,
                shortcuts.total,
              ),
            );
          });
          break;
        }
        case "Home":
          handle(() => shortcuts.seek(0));
          break;
        case "End":
          handle(() => shortcuts.seek(shortcuts.total));
          break;
        default: {
          const key = event.key.toLowerCase();
          if (key === "i") handle(shortcuts.markStart);
          else if (key === "o") handle(shortcuts.markEnd);
          else if (key === "s") handle(() => setSnap((value) => !value));
          else if (key === "m") handle(() => setMuted((value) => !value));
          else if (key === "+" || key === "=") {
            handle(() => shortcuts.zoomBy(0.12));
          } else if (key === "-" || key === "_") {
            handle(() => shortcuts.zoomBy(-0.12));
          } else if (key === "0") {
            handle(shortcuts.fitView);
          }
        }
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const ready = preview.status === "ready" && Boolean(preview.url) && !mediaFailed;
  const preparing = preview.status === "loading" && preview.local !== false;
  const viewPercent = (time: number) => ((time - viewStart) / viewDuration) * 100;
  const startPercent = viewPercent(start);
  const endPercent = viewPercent(end);
  const playheadPercent = viewPercent(clamp(current, 0, total));
  const clipLength = end - start;
  const isAudio = kind === "audio";
  const progress = preview.progress ?? 0;
  const snapPercent = snapTarget ? viewPercent(snapTarget.time) : null;
  const hoverPercent = hover ? viewPercent(hover.time) : null;

  const mediaEvents = {
    onPlay: () => {
      previewOnlySeekRef.current = false;
      setPlaying(true);
    },
    onPause: () => {
      setPlaying(false);
      const media = mediaRef.current;
      if (media) setCurrent(media.currentTime);
    },
    onEnded: () => {
      const media = mediaRef.current;
      if (loop && media) {
        try {
          media.currentTime = start;
        } catch {
          // Sin metadatos.
        }
        setCurrent(start);
        const result = media.play();
        if (result) {
          result.then(() => setPlaying(true)).catch(() => setPlaying(false));
        }
        return;
      }
      setPlaying(false);
    },
    onError: () => {
      setPlaying(false);
      setMediaFailed(true);
    },
    onTimeUpdate: () => {
      if (previewOnlySeekRef.current) return;
      const media = mediaRef.current;
      if (media) setCurrent(media.currentTime);
    },
    onSeeking: () => setSeeking(true),
    onSeeked: () => {
      setSeeking(false);
      if (previewOnlySeekRef.current) return;
      const media = mediaRef.current;
      if (media && media.paused) setCurrent(media.currentTime);
    },
    onLoadedMetadata: () => {
      const media = mediaRef.current;
      if (!media) return;
      previewOnlySeekRef.current = false;
      media.volume = volume;
      media.muted = muted;
      if (current > 0.05) {
        try {
          media.currentTime = clamp(current, 0, total);
        } catch {
          // Sin metadatos utilizables.
        }
      }
    },
  };

  return (
    <section
      ref={sectionRef}
      className="tl-editor"
      aria-label="Editor de tramos"
      tabIndex={-1}
    >
      <div className={`tl-monitor${isAudio ? " is-audio" : ""}${ready ? " is-ready" : ""}`}>
        {ready ? (
          isAudio ? (
            <>
              <audio ref={setMedia} src={preview.url} preload="auto" {...mediaEvents} />
              <div className="tl-audio-card" onClick={focusAndToggle}>
                {thumbnail ? (
                  <img src={thumbnail} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <div className="thumb-empty">
                    <Icon name="music" size={26} />
                  </div>
                )}
                <span className="tl-audio-icon" aria-hidden="true">
                  <Icon name="music" size={26} />
                </span>
                <span className="tl-audio-copy">
                  <strong>{title}</strong>
                  <small>{playing ? "Reproduciendo" : "Solo audio"}</small>
                </span>
              </div>
            </>
          ) : (
            <video
              ref={setMedia}
              src={preview.url}
              preload="auto"
              playsInline
              onClick={focusAndToggle}
              title={playing ? "Pausar" : "Reproducir"}
              {...mediaEvents}
            />
          )
        ) : (
          <>
            {thumbnail ? (
              <img className="tl-poster" src={thumbnail} alt="" referrerPolicy="no-referrer" />
            ) : (
              <div className="thumb-empty">
                <Icon name={isAudio ? "music" : "film"} size={26} />
              </div>
            )}
            <div className="tl-overlay">
              {preview.status === "loading" ? (
                <>
                  <p className="tl-overlay-title">
                    {preparing ? "Preparando la copia local" : "Conectando con el vídeo"}
                  </p>
                  {preparing && (
                    <div
                      className="tl-progress"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(progress)}
                    >
                      <span style={{ width: `${clamp(progress, 0, 100)}%` }} />
                    </div>
                  )}
                  <p>
                    {preview.detail ||
                      (preparing
                        ? "Descargando una copia de baja resolución para editar con fluidez."
                        : "Buscando el stream del sitio…")}
                  </p>
                  {preparing && (
                    <p className="hint">Puedes marcar el tramo mientras termina.</p>
                  )}
                  {preparing && (
                    <button type="button" className="button tiny" onClick={onCancelPreview}>
                      Cancelar
                    </button>
                  )}
                </>
              ) : preview.status === "idle" ? (
                <button type="button" className="button tiny" onClick={onRetryPreview}>
                  Cargar vista previa
                </button>
              ) : (
                <>
                  <p>
                    {mediaFailed
                      ? "El navegador no pudo reproducir esta vista previa. Los tramos se pueden marcar igual."
                      : preview.message || "No se pudo cargar la vista previa."}
                  </p>
                  <button type="button" className="button tiny" onClick={onRetryPreview}>
                    Reintentar
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {ready && (
          <span
            className={`tl-badge mono${preview.local ? " is-local" : ""}`}
            title={
              preview.local
                ? "Copia local de baja resolución para editar. El corte final se descarga en la calidad elegida."
                : "La copia local no está disponible; se usa el stream del sitio."
            }
          >
            {isAudio
              ? preview.local
                ? "Audio local"
                : "Audio remoto"
              : preview.local
                ? "Copia local"
                : "Stream remoto"}
          </span>
        )}
        {dragging && dragging !== "seek" ? (
          <span className="tl-seek-badge mono">
            {dragging === "start" ? "Entrada" : "Salida"}{" "}
            {formatClock(dragging === "start" ? start : end)}
          </span>
        ) : (
          seeking &&
          ready && <span className="tl-seek-badge mono">Buscando…</span>
        )}
      </div>

      <div className="tl-transport">
        <div className="tl-transport-main">
          <button
            type="button"
            className="tl-play"
            onClick={togglePlay}
            disabled={!ready}
            aria-label={playing ? "Pausar" : "Reproducir el tramo"}
          >
            <Icon name={playing ? "pause" : "play"} size={15} />
            <span>{playing ? "Pausar" : "Reproducir"}</span>
          </button>

          <span className="mono tl-time">
            {formatClock(current)} / {formatClock(total)}
          </span>

          <div className="tl-selection-readout mono">
            <span>
              <span className="tl-readout-label">Entrada</span>
              {formatClock(start)}
            </span>
            <span>
              <span className="tl-readout-label">Duración</span>
              {formatClock(clipLength)}
            </span>
            <span>
              <span className="tl-readout-label">Salida</span>
              {formatClock(end)}
            </span>
          </div>

          <div className="tl-volume">
            <button
              type="button"
              className="icon-button"
              onClick={() => setMuted((value) => !value)}
              aria-label={muted ? "Activar sonido" : "Silenciar"}
              aria-pressed={muted}
              title="Silencio (M)"
              disabled={!ready}
            >
              <Icon name={muted ? "volume-off" : "volume"} size={15} />
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(event) => {
                const next = Number(event.target.value);
                setVolume(next);
                setMuted(next === 0);
              }}
              aria-label="Volumen"
              aria-valuetext={formatVolume(muted ? 0 : volume)}
              disabled={!ready}
            />
          </div>
        </div>

        <div className="tl-transport-tools">
          <div className="tl-marks">
            <button
              type="button"
              className="button tiny"
              onClick={markStart}
              title="Marcar entrada en la aguja (I)"
            >
              Marcar entrada
            </button>
            <button
              type="button"
              className="button tiny"
              onClick={markEnd}
              title="Marcar salida en la aguja (O)"
            >
              Marcar salida
            </button>
            <button
              type="button"
              className={`button tiny tl-snap${snap ? " is-on" : ""}`}
              onClick={() => setSnap((value) => !value)}
              aria-pressed={snap}
              title="Imán: S. Mantén Alt al arrastrar para desactivarlo."
            >
              <Icon name="magnet" size={12} />
              Imán
            </button>
            <button
              type="button"
              className={`button tiny tl-loop${loop ? " is-on" : ""}`}
              onClick={() => setLoop((value) => !value)}
              aria-pressed={loop}
              title="Repetir el tramo al llegar al final"
            >
              <Icon name="refresh" size={12} />
              Loop
            </button>
          </div>
        </div>
      </div>

      <div
        className="tl-scale"
        title="Arrastra la ventana para recorrer; arrastra sus bordes para hacer zoom. Ctrl o Alt + rueda para zoom."
      >
        <span className="tl-scale-label">Escala</span>
        <button
          type="button"
          className="tl-scale-step"
          onClick={() => zoomBy(-0.12)}
          disabled={!canZoom || zoom <= 0}
          aria-label="Alejar la línea de tiempo"
        >
          −
        </button>
        <div
          className={`tl-zoombar${zoomHover ? ` is-${zoomHover}` : ""}`}
          onPointerDown={onZoomPointerDown}
          onPointerMove={onZoomPointerMove}
          onPointerUp={onZoomPointerUp}
          onPointerCancel={() => onZoomPointerUp()}
          onPointerLeave={onZoomPointerLeave}
          role="presentation"
        >
          <span
            className="tl-zoombar-selection"
            style={{
              left: `${(start / total) * 100}%`,
              width: `${((end - start) / total) * 100}%`,
            }}
          />
          <span
            className="tl-zoombar-window"
            style={{
              left: `${(viewStart / total) * 100}%`,
              width: `${(viewDuration / total) * 100}%`,
            }}
          >
            <span className="tl-zoombar-edge is-start" />
            <span className="tl-zoombar-edge is-end" />
          </span>
          <span
            className="tl-zoombar-playhead"
            style={{ left: `${(current / total) * 100}%` }}
          />
        </div>
        <button
          type="button"
          className="tl-scale-step"
          onClick={() => zoomBy(0.12)}
          disabled={!canZoom || zoom >= 1}
          aria-label="Acercar la línea de tiempo"
        >
          +
        </button>
        <button
          type="button"
          className="button tiny tl-scale-fit"
          onClick={fitView}
          disabled={zoom <= 0}
        >
          Todo
        </button>
      </div>

      <div
        ref={trackRef}
        className={`tl-track${dragging ? " is-dragging" : ""}${snapTarget ? " has-snap" : ""}`}
        onPointerDown={onTrackPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={() => finishDrag()}
        onPointerLeave={onTrackPointerLeave}
        role="presentation"
      >
        <div className="tl-track-view">
          <div className="tl-ruler" aria-hidden="true">
          {rulerTicks.map((tick) => {
            const percent = viewPercent(tick.time);
            return (
              <span
                key={tick.time}
                className={`tl-tick${tick.major ? " is-major" : " is-minor"}`}
                style={{ left: `${percent}%` }}
              >
                {tick.major && tick.label && (
                  <span
                    className={`tl-tick-label${percent < 8 ? " is-first" : ""}${
                      percent > 92 ? " is-last" : ""
                    }`}
                  >
                    {tick.label}
                  </span>
                )}
              </span>
            );
          })}
        </div>

        {clips.map((clip) => (
          <span
            key={clip.id}
            className="tl-clip-block"
            style={{
              left: `${viewPercent(clip.start)}%`,
              width: `${viewPercent(clip.end) - viewPercent(clip.start)}%`,
            }}
          />
        ))}

        <span
          className="tl-selection"
          style={{ left: `${startPercent}%`, width: `${endPercent - startPercent}%` }}
        />

        {hoverPercent !== null && !dragging && (
          <>
            <span className="tl-hover" style={{ left: `${hoverPercent}%` }} />
            <span
              className="tl-hover-tag mono"
              style={{ left: `${clamp(hoverPercent, 4, 96)}%` }}
            >
              {formatClock(Math.round(hover?.time ?? 0))}
            </span>
          </>
        )}

        {snapTarget && snapPercent !== null && (
          <span className="tl-snap-guide" style={{ left: `${snapPercent}%` }}>
            <span className="tl-snap-tag mono">
              {snapTarget.label} {formatClock(snapTarget.time)}
            </span>
          </span>
        )}

          {clipLength <= MIN_CLIP && (
            <span
              className="tl-min-gap"
              style={{ left: `${(startPercent + endPercent) / 2}%` }}
            >
              mín. 1 s
            </span>
          )}
        </div>

        {current >= viewStart && current <= viewEnd && (
          <span className="tl-playhead" style={{ left: `${playheadPercent}%` }} />
        )}

        {start >= viewStart && start <= viewEnd && (
          <button
            type="button"
            className={`tl-handle is-start${dragging === "start" ? " is-active" : ""}${
              blocked?.side === "start" ? " is-blocked" : ""
            }`}
            style={{ left: `${startPercent}%` }}
            role="slider"
            aria-label="Entrada del tramo"
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={Math.max(0, end - MIN_CLIP)}
            aria-valuenow={start}
            aria-valuetext={formatClock(start)}
            aria-describedby="tl-limit-status"
            onPointerDown={onHandlePointerDown("start")}
            onKeyDown={onHandleKey("start")}
          />
        )}
        {end >= viewStart && end <= viewEnd && (
          <button
            type="button"
            className={`tl-handle is-end${dragging === "end" ? " is-active" : ""}${
              blocked?.side === "end" ? " is-blocked" : ""
            }`}
            style={{ left: `${endPercent}%` }}
            role="slider"
            aria-label="Salida del tramo"
            aria-orientation="horizontal"
            aria-valuemin={Math.min(total, start + MIN_CLIP)}
            aria-valuemax={total}
            aria-valuenow={end}
            aria-valuetext={formatClock(end)}
            aria-describedby="tl-limit-status"
            onPointerDown={onHandlePointerDown("end")}
            onKeyDown={onHandleKey("end")}
          />
        )}
      </div>

      <div className="tl-foot">
        <p
          id="tl-limit-status"
          className={`tl-status${blocked ? " is-blocked" : ""}`}
          role="status"
          aria-live="polite"
        >
          {blocked
            ? blocked.side === "start"
              ? "La entrada no puede alcanzar la salida. Mínimo 1 s por tramo."
              : "La salida no puede quedar antes de la entrada. Mínimo 1 s por tramo."
            : snap
              ? "Imán activo: se ajusta a la aguja, los cortes y las marcas. Alt lo desactiva al arrastrar."
              : "Imán desactivado: los tiradores se ajustan a segundos enteros."}
        </p>

        <p className="tl-shortcuts hint">
          <span>
            <kbd>Espacio</kbd> reproducir
          </span>
          <span>
            <kbd>←</kbd>
            <kbd>→</kbd> ±1 s
          </span>
          <span>
            <kbd>Mayús</kbd> + flechas ±10 s
          </span>
          <span>
            <kbd>I</kbd>
            <kbd>O</kbd> marcar
          </span>
          <span>
            <kbd>S</kbd> imán
          </span>
          <span>
            <kbd>M</kbd> silencio
          </span>
          <span>
            <kbd>+</kbd>
            <kbd>−</kbd> escala
          </span>
          <span>
            <kbd>0</kbd> ver todo
          </span>
        </p>
      </div>

      {clips.length > 0 && (
        <ul className="tl-list" aria-label="Tramos preparados">
          {clips.map((clip) => (
            <li key={clip.id} className="tl-item">
              <button
                type="button"
                className="tl-item-main"
                onClick={() => {
                  setStart(clip.start);
                  setEnd(clip.end);
                  seek(clip.start);
                }}
                title="Ver este tramo"
              >
                <span className="mono">
                  {formatClock(clip.start)} → {formatClock(clip.end)}
                </span>
                <span className="mono tl-item-length">
                  {formatDuration(clip.end - clip.start)}
                </span>
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() =>
                  setClips((previous) => previous.filter((item) => item.id !== clip.id))
                }
                aria-label={`Quitar tramo de ${formatClock(clip.start)} a ${formatClock(clip.end)}`}
              >
                <Icon name="close" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="tl-actions">
        <button
          type="button"
          className="button small"
          onClick={addWorkingClip}
          disabled={clipLength < MIN_CLIP}
        >
          <Icon name="cut" size={13} />
          Añadir tramo
        </button>

        <button
          type="button"
          className="button solid tl-stage"
          onClick={stageClips}
          disabled={clips.length === 0}
        >
          <Icon name="download" size={14} />
          {clips.length === 0
            ? "Añadir tramos a la cola"
            : `Añadir ${clips.length} ${
                clips.length === 1 ? "tramo" : "tramos"
              } a la cola`}
        </button>

        <span className="hint tl-format">Se guardan como {formatLabel}.</span>
      </div>

      {preview.local && ready && (
        <p className="hint tl-cache-note">
          La copia local es solo para el editor; el corte final se descarga en {formatLabel}.
        </p>
      )}

      {clips.length === 0 && (
        <p className="hint tl-hint">
          Arrastra los tiradores o usa I/O para marcar. Puedes preparar varios antes de
          pasarlos a la cola.
        </p>
      )}
    </section>
  );
}
