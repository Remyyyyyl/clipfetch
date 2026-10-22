import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Clip, PreviewState, ToolKind } from "../types";
import { formatClock, formatDuration } from "../lib/format";
import { Icon } from "./Icon";

interface TimelineEditorProps {
  kind: ToolKind;
  title: string;
  thumbnail?: string;
  duration: number;
  preview: PreviewState;
  formatLabel: string;
  onRetryPreview: () => void;
  onAddClips: (ranges: Array<{ start: number; end: number }>) => void;
}

const MIN_CLIP = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function secondsAt(clientX: number, rect: DOMRect, total: number): number {
  if (rect.width <= 0) return 0;
  const ratio = (clientX - rect.left) / rect.width;
  return clamp(Math.round(ratio * total), 0, total);
}

export function TimelineEditor({
  kind,
  title,
  thumbnail,
  duration,
  preview,
  formatLabel,
  onRetryPreview,
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

  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ mode: "start" | "end" | "seek"; rect: DOMRect } | null>(null);

  const setMedia = (element: HTMLVideoElement | HTMLAudioElement | null) => {
    mediaRef.current = element;
  };

  useEffect(() => {
    setClips([]);
    setStart(0);
    setEnd(Math.min(30, total));
    setCurrent(0);
    setPlaying(false);
    setMediaFailed(false);
  }, [title, total, kind]);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setMediaFailed(false);
  }, [preview.url]);

  const seek = useCallback(
    (seconds: number) => {
      const target = clamp(seconds, 0, total);
      const media = mediaRef.current;
      if (media && media.readyState > 0) {
        try {
          media.currentTime = target;
        } catch {
          // Sin metadatos todavía: la aguja se mueve igual.
        }
      }
      setCurrent(target);
    },
    [total],
  );

  // Reproducción con parada o bucle al final del tramo.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;

    const tick = () => {
      const media = mediaRef.current;
      if (!media) return;
      const time = media.currentTime;
      setCurrent(time);
      if (time >= end - 0.05) {
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

  const togglePlay = () => {
    const media = mediaRef.current;
    if (!media || preview.status !== "ready" || mediaFailed) return;

    if (!media.paused) {
      media.pause();
      setPlaying(false);
      return;
    }

    const from = current < start || current >= end ? start : current;
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
  };

  const markStart = () => {
    const value = clamp(Math.round(current), 0, total - MIN_CLIP);
    setStart(value);
    if (end <= value) setEnd(Math.min(total, value + MIN_CLIP));
  };

  const markEnd = () => {
    const value = clamp(Math.round(current), MIN_CLIP, total);
    setEnd(value);
    if (start >= value) setStart(Math.max(0, value - MIN_CLIP));
  };

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

  const onTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Puntero sintético o ya liberado.
    }
    dragRef.current = { mode: "seek", rect };
    seek(secondsAt(event.clientX, rect, total));
  };

  const onHandlePointerDown =
    (mode: "start" | "end") => (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Puntero sintético: seguimos con los eventos del track.
      }
      dragRef.current = { mode, rect };
    };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const value = secondsAt(event.clientX, drag.rect, total);

    if (drag.mode === "seek") {
      seek(value);
      return;
    }

    seek(value);
    if (drag.mode === "start") {
      setStart(clamp(value, 0, end - MIN_CLIP));
    } else {
      setEnd(clamp(value, start + MIN_CLIP, total));
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const onHandleKey =
    (mode: "start" | "end") => (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const value = mode === "start" ? start : end;
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
          next = 0;
          break;
        case "End":
          next = total;
          break;
        default:
          return;
      }

      event.preventDefault();
      if (mode === "start") {
        const clamped = clamp(next, 0, end - MIN_CLIP);
        setStart(clamped);
        seek(clamped);
      } else {
        const clamped = clamp(next, start + MIN_CLIP, total);
        setEnd(clamped);
        seek(clamped);
      }
    };

  const ready = preview.status === "ready" && Boolean(preview.url) && !mediaFailed;
  const startPercent = (start / total) * 100;
  const endPercent = (end / total) * 100;
  const playheadPercent = (clamp(current, 0, total) / total) * 100;
  const clipLength = end - start;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(total * ratio));
  const isAudio = kind === "audio";

  return (
    <section className="tl-editor" aria-label="Editor de tramos">
      <div className={`tl-monitor${isAudio ? " is-audio" : ""}`}>
        {ready ? (
          isAudio ? (
            <>
              <audio
                ref={setMedia}
                src={preview.url}
                preload="metadata"
                onTimeUpdate={() => {
                  const media = mediaRef.current;
                  if (media && !playing) setCurrent(media.currentTime);
                }}
                onPause={() => {
                  setPlaying(false);
                  const media = mediaRef.current;
                  if (media) setCurrent(media.currentTime);
                }}
                onEnded={() => setPlaying(false)}
                onError={() => setMediaFailed(true)}
              />
              <div className="tl-audio-card">
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
              preload="metadata"
              playsInline
              onTimeUpdate={() => {
                const media = mediaRef.current;
                if (media && !playing) setCurrent(media.currentTime);
              }}
              onPause={() => {
                setPlaying(false);
                const media = mediaRef.current;
                if (media) setCurrent(media.currentTime);
              }}
              onEnded={() => setPlaying(false)}
              onError={() => setMediaFailed(true)}
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
                <p>Cargando vista previa…</p>
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
          <span className="tl-badge mono">{isAudio ? "Solo audio" : "Vista previa"}</span>
        )}
      </div>

      <div className="tl-transport">
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

        <span className="mono tl-range-readout">
          {formatClock(start)} → {formatClock(end)}
          <span className="tl-range-length">{formatDuration(clipLength)}</span>
        </span>

        <div className="tl-marks">
          <button type="button" className="button tiny" onClick={markStart}>
            Marcar inicio
          </button>
          <button type="button" className="button tiny" onClick={markEnd}>
            Marcar fin
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

      <div
        ref={trackRef}
        className="tl-track"
        onPointerDown={onTrackPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="presentation"
      >
        {clips.map((clip) => (
          <span
            key={clip.id}
            className="tl-clip-block"
            style={{
              left: `${(clip.start / total) * 100}%`,
              width: `${((clip.end - clip.start) / total) * 100}%`,
            }}
          />
        ))}

        <span
          className="tl-selection"
          style={{ left: `${startPercent}%`, width: `${endPercent - startPercent}%` }}
        />

        <span className="tl-playhead" style={{ left: `${playheadPercent}%` }} />

        <button
          type="button"
          className="tl-handle"
          style={{ left: `${startPercent}%` }}
          role="slider"
          aria-label="Inicio del tramo"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={start}
          aria-valuetext={formatClock(start)}
          onPointerDown={onHandlePointerDown("start")}
          onKeyDown={onHandleKey("start")}
        />
        <button
          type="button"
          className="tl-handle"
          style={{ left: `${endPercent}%` }}
          role="slider"
          aria-label="Fin del tramo"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={end}
          aria-valuetext={formatClock(end)}
          onPointerDown={onHandlePointerDown("end")}
          onKeyDown={onHandleKey("end")}
        />
      </div>

      <div className="tl-ticks mono" aria-hidden="true">
        {ticks.map((tick, index) => (
          <span key={`${tick}-${index}`}>{tick === 0 ? "0:00" : formatDuration(tick)}</span>
        ))}
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
          Añadir {clips.length || ""} {clips.length === 1 ? "tramo" : "tramos"} a la cola
        </button>

        <span className="hint tl-format">Se guardan como {formatLabel}.</span>
      </div>

      {clips.length === 0 && (
        <p className="hint tl-hint">
          Arrastra los tiradores y pulsa «Añadir tramo». Puedes preparar varios antes de
          pasarlos a la cola.
        </p>
      )}
    </section>
  );
}
