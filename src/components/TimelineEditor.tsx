import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Clip, PreviewState } from "../types";
import { formatClock, formatDuration } from "../lib/format";
import { Icon } from "./Icon";

interface TimelineEditorProps {
  title: string;
  thumbnail?: string;
  duration: number;
  preview: PreviewState;
  clips: Clip[];
  onRetryPreview: () => void;
  onAddClip: (start: number, end: number) => void;
  onRemoveClip: (id: string) => void;
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
  title,
  thumbnail,
  duration,
  preview,
  clips,
  onRetryPreview,
  onAddClip,
  onRemoveClip,
}: TimelineEditorProps) {
  const total = Math.max(MIN_CLIP, Math.floor(duration || 0));
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(() => Math.min(30, total));
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ mode: "start" | "end" | "seek"; rect: DOMRect } | null>(null);

  // Cada vídeo nuevo empieza con un tramo de 30 s propuesto.
  useEffect(() => {
    setStart(0);
    setEnd(Math.min(30, total));
    setCurrent(0);
    setPlaying(false);
    setVideoFailed(false);
  }, [title, total]);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setVideoFailed(false);
  }, [preview.url]);

  const seek = useCallback(
    (seconds: number) => {
      const target = clamp(seconds, 0, total);
      const video = videoRef.current;
      if (video && video.readyState > 0) {
        try {
          video.currentTime = target;
        } catch {
          // Todavía sin metadatos: el playhead se mueve igual.
        }
      }
      setCurrent(target);
    },
    [total],
  );

  // Playhead suave y parada automática al final del tramo.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;

    const tick = () => {
      const video = videoRef.current;
      if (!video) return;
      const time = video.currentTime;
      setCurrent(time);
      if (time >= end - 0.05) {
        video.pause();
        setCurrent(end);
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, end]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video || preview.status !== "ready" || videoFailed) return;

    if (!video.paused) {
      video.pause();
      setPlaying(false);
      return;
    }

    const from = current < start || current >= end ? start : current;
    if (Math.abs(video.currentTime - from) > 0.2) {
      try {
        video.currentTime = from;
      } catch {
        // Sin metadatos todavía.
      }
    }
    setCurrent(from);

    const result = video.play();
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

  const addClip = () => {
    if (end - start < MIN_CLIP) return;
    onAddClip(Math.round(start), Math.round(end));
  };

  const onTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Puntero sintético o ya liberado: el arrastre sigue funcionando igual.
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

  const ready = preview.status === "ready" && Boolean(preview.url) && !videoFailed;
  const startPercent = (start / total) * 100;
  const endPercent = (end / total) * 100;
  const playheadPercent = (clamp(current, 0, total) / total) * 100;
  const clipLength = end - start;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(total * ratio));

  return (
    <section className="panel timeline-panel" aria-labelledby="timeline-heading">
      <header className="panel-head">
        <div className="queue-title">
          <h2 id="timeline-heading">Tramos</h2>
          <span className="tag muted-tag">Editor</span>
        </div>
        <span className="timeline-count mono">
          {clips.length === 0
            ? "Sin tramos"
            : `${clips.length} ${clips.length === 1 ? "tramo" : "tramos"}`}
        </span>
      </header>

      <div className="timeline-grid">
        <div className="tl-monitor">
          {ready ? (
            <video
              ref={videoRef}
              src={preview.url}
              preload="metadata"
              playsInline
              onTimeUpdate={() => {
                const video = videoRef.current;
                if (video && !playing) setCurrent(video.currentTime);
              }}
              onPause={() => {
                setPlaying(false);
                const video = videoRef.current;
                if (video) setCurrent(video.currentTime);
              }}
              onEnded={() => {
                setPlaying(false);
                setCurrent(end);
              }}
              onError={() => setVideoFailed(true)}
            />
          ) : (
            <>
              {thumbnail ? (
                <img className="tl-poster" src={thumbnail} alt="" referrerPolicy="no-referrer" />
              ) : (
                <div className="thumb-empty">
                  <Icon name="film" size={26} />
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
                      {videoFailed
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
          {ready && <span className="tl-badge mono">Vista previa</span>}
        </div>

        <div className="tl-deck">
          <div className="tl-readout">
            <button
              type="button"
              className="button tiny tl-play"
              onClick={togglePlay}
              disabled={!ready}
              aria-label={playing ? "Pausar" : "Reproducir el tramo"}
              title={playing ? "Pausar" : "Reproducir el tramo"}
            >
              <Icon name={playing ? "pause" : "play"} size={13} />
              {playing ? "Pausar" : "Reproducir"}
            </button>
            <span className="mono tl-time">
              {formatClock(current)} / {formatClock(total)}
            </span>
            <span className="mono tl-range-readout">
              {formatClock(start)} → {formatClock(end)}
              <span className="tl-range-length">{formatDuration(clipLength)}</span>
            </span>
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
              <span key={`${tick}-${index}`}>
                {tick === 0 ? "0:00" : formatDuration(tick)}
              </span>
            ))}
          </div>

          <div className="tl-actions">
            <button type="button" className="button small" onClick={markStart}>
              Marcar inicio
            </button>
            <button type="button" className="button small" onClick={markEnd}>
              Marcar fin
            </button>
            <button
              type="button"
              className="button small solid tl-add"
              onClick={addClip}
              disabled={clipLength < MIN_CLIP}
            >
              <Icon name="cut" size={13} />
              Añadir tramo
            </button>
          </div>

          {clips.length === 0 ? (
            <p className="hint tl-hint">
              Arrastra los tiradores de la línea de tiempo y añade el tramo a la lista.
            </p>
          ) : (
            <ul className="tl-list">
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
                    onClick={() => onRemoveClip(clip.id)}
                    aria-label={`Quitar tramo de ${formatClock(clip.start)} a ${formatClock(clip.end)}`}
                  >
                    <Icon name="close" size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
