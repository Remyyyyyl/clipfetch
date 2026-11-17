import { useEffect, useState } from "react";
import type { Clip, Job, JobStatus, StagedItem } from "../types";
import { formatClock, formatDuration, presetLabel } from "../lib/format";
import { Icon } from "./Icon";

interface ClipsPanelProps {
  clips: Clip[];
  clipSelection: string[];
  simple: boolean;
  staged: StagedItem[];
  jobs: Job[];
  activeCount: number;
  onSelectClip: (id: string) => void;
  onDeleteClip: (id: string) => void;
  onRemoveStaged: (id: string) => void;
  onMoveStaged: (id: string, direction: -1 | 1) => void;
  onReorderStaged: (fromId: string, toId: string) => void;
  onExport: () => void;
  onCancel: (job: Job) => void;
  onRetry: (job: Job) => void;
  onOpenFolder: (path: string) => void;
  onRevealFile: (path: string) => void;
  onClearCompleted: () => void;
}

type Tab = "timeline" | "staged" | "downloads";

const STATUS_LABELS: Record<JobStatus, string> = {
  queued: "En cola",
  starting: "Iniciando",
  downloading: "Descargando",
  completed: "Completado",
  error: "Error",
  cancelled: "Cancelado",
};

function jobPercent(job: Job): number {
  const value =
    job.converting && typeof job.convertPercent === "number"
      ? job.convertPercent
      : job.percent;
  return Math.min(100, Math.max(0, value));
}

function stagedMeta(item: StagedItem): string {
  if (item.source === "file") {
    const clip = item.clip
      ? `${formatClock(item.clip.start)}–${formatClock(item.clip.end)}`
      : "Archivo completo";
    const resolution = item.resolution ? ` · ${item.resolution}` : "";
    return `${clip} · Archivo local${resolution}`;
  }
  const format = presetLabel(item.preset);
  if (item.isPlaylist) {
    return `Playlist · ${item.totalItems} ${item.totalItems === 1 ? "vídeo" : "vídeos"}`;
  }
  if (item.clip) {
    return `${formatClock(item.clip.start)}–${formatClock(item.clip.end)} · ${format}`;
  }
  const duration = item.duration ? ` · ${formatDuration(item.duration)}` : "";
  return `${format}${duration}`;
}

export function ClipsPanel({
  clips,
  clipSelection,
  simple,
  staged,
  jobs,
  activeCount,
  onSelectClip,
  onDeleteClip,
  onRemoveStaged,
  onMoveStaged,
  onReorderStaged,
  onExport,
  onCancel,
  onRetry,
  onOpenFolder,
  onRevealFile,
  onClearCompleted,
}: ClipsPanelProps) {
  const [tab, setTab] = useState<Tab>("staged");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const completedCount = jobs.filter((job) => job.status === "completed").length;
  const active = jobs.filter(
    (job) => job.status === "starting" || job.status === "downloading",
  );
  const activePercent =
    active.length === 0
      ? 0
      : active.reduce((sum, job) => sum + jobPercent(job), 0) / active.length;

  useEffect(() => {
    if (simple && tab === "timeline") setTab("staged");
  }, [simple, tab]);

  const selected = new Set(clipSelection);
  const sortedClips = [...clips].sort((first, second) => first.start - second.start);

  const tabButton = (id: Tab, label: string, count?: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      className={`clips-tab${tab === id ? " is-active" : ""}`}
      onClick={() => setTab(id)}
    >
      <span>{label}</span>
      {typeof count === "number" && count > 0 && (
        <span className="clips-tab-count mono">{count}</span>
      )}
    </button>
  );

  return (
    <aside className="clips-panel" aria-label="Barra de clips y cola">
      <header className="clip-panel-head">
        <h2>Clips</h2>
        <span className="mono rail-count">{staged.length + jobs.length}</span>
      </header>

      <div className="clips-tabs" role="tablist" aria-label="Secciones de la barra">
        {!simple && tabButton("timeline", "Línea de tiempo", clips.length)}
        {tabButton("staged", "Preparado", staged.length)}
        {tabButton("downloads", "Descargas", jobs.length)}
      </div>

      <div className="clips-body">
        {tab === "timeline" && !simple && (
          <section className="clips-section" aria-label="Tramos del editor">
            {sortedClips.length === 0 ? (
              <div className="rail-empty">
                <Icon name="cut" size={22} />
                <p>
                  <strong>No hay tramos.</strong> Marca entrada y salida y pulsa
                  «Añadir tramo».
                </p>
              </div>
            ) : (
              <ul className="tl-list clips-timeline-list" aria-label="Tramos del editor">
                {sortedClips.map((clip) => (
                  <li
                    key={clip.id}
                    className={`tl-item${selected.has(clip.id) ? " is-selected" : ""}`}
                  >
                    <button
                      type="button"
                      className="tl-item-main"
                      onClick={() => onSelectClip(clip.id)}
                      aria-pressed={selected.has(clip.id)}
                      title="Seleccionar este tramo"
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
                      onClick={() => onDeleteClip(clip.id)}
                      aria-label={`Quitar tramo de ${formatClock(clip.start)} a ${formatClock(clip.end)}`}
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === "staged" && (
          <section className="clips-section" aria-label="Preparado para exportar">
            {staged.length === 0 ? (
              <div className="rail-empty">
                <Icon name="reel" size={22} />
                <p>
                  <strong>No hay nada preparado.</strong> Añade vídeos o tramos desde la
                  botonera o el editor.
                </p>
              </div>
            ) : (
              <ul className="rail-list">
                {staged.map((item) => (
                  <li
                    key={item.id}
                    className={`rail-staged${draggingId === item.id ? " is-dragging" : ""}`}
                    draggable
                    onDragStart={(event) => {
                      setDraggingId(item.id);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", item.id);
                    }}
                    onDragEnd={() => setDraggingId(null)}
                    onDragOver={(event) => {
                      if (draggingId && draggingId !== item.id) event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (draggingId && draggingId !== item.id) {
                        onReorderStaged(draggingId, item.id);
                      }
                      setDraggingId(null);
                    }}
                  >
                    <button
                      type="button"
                      className="rail-grip"
                      aria-label={`Reordenar ${item.title}. Alt flecha arriba o abajo para mover.`}
                      onKeyDown={(event) => {
                        if (!event.altKey) return;
                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          onMoveStaged(item.id, -1);
                        } else if (event.key === "ArrowDown") {
                          event.preventDefault();
                          onMoveStaged(item.id, 1);
                        }
                      }}
                    >
                      <Icon name="grip" size={14} />
                    </button>

                    <div className="rail-thumb">
                      {item.thumbnail ? (
                        <img src={item.thumbnail} alt="" referrerPolicy="no-referrer" />
                      ) : (
                        <Icon name={item.kind === "video" ? "film" : "music"} size={15} />
                      )}
                      <span className={`rail-kind ${item.kind}`} aria-hidden="true">
                        <Icon name={item.kind === "video" ? "film" : "music"} size={9} />
                      </span>
                    </div>

                    <div className="rail-staged-body">
                      <span className="rail-title" title={item.title}>
                        {item.title}
                      </span>
                      <span className="rail-meta mono">{stagedMeta(item)}</span>
                    </div>

                    <button
                      type="button"
                      className="icon-button rail-remove"
                      onClick={() => onRemoveStaged(item.id)}
                      aria-label={`Quitar ${item.title} de la cola`}
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === "downloads" && (
          <section className="clips-section" aria-label="Descargas">
            {jobs.length === 0 ? (
              <div className="rail-empty">
                <Icon name="download" size={22} />
                <p>
                  <strong>No hay descargas.</strong> Exporta lo preparado para empezar.
                </p>
              </div>
            ) : (
              <ul className="rail-list">
                {jobs.map((job) => (
                  <li key={job.id} className={`rail-job ${job.status}${job.converting ? " converting" : ""}`}>
                    <div className="rail-thumb">
                      {job.thumbnail ? (
                        <img src={job.thumbnail} alt="" referrerPolicy="no-referrer" />
                      ) : (
                        <Icon name="film" size={15} />
                      )}
                    </div>

                    <div className="rail-job-body">
                      <div className="rail-job-top">
                        <span className="rail-title" title={job.title}>
                          {job.title}
                        </span>
                        <span className="rail-percent mono">
                          {Math.round(jobPercent(job))}%
                        </span>
                      </div>

                      <div className="rail-job-meta mono">
                        <span className={`status-dot ${job.status}`} aria-hidden="true" />
                        {job.skipped && job.status === "completed"
                          ? "Ya existía"
                          : job.converting
                            ? "Preparando copia para edición"
                            : job.request.source === "file" && job.status === "downloading"
                              ? "Cortando"
                              : STATUS_LABELS[job.status]}
                      </div>

                      <div className="rail-tape" aria-hidden="true">
                        <span
                          className="rail-tape-fill"
                          style={{ width: `${jobPercent(job)}%` }}
                        />
                      </div>

                      {job.error && (
                        <p className="rail-error" title={job.error}>
                          {job.error}
                        </p>
                      )}

                      <div className="rail-job-actions">
                        {(job.status === "queued" ||
                          job.status === "starting" ||
                          job.status === "downloading") && (
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => onCancel(job)}
                            aria-label={`Cancelar ${job.title}`}
                            title="Cancelar"
                          >
                            <Icon name="close" size={12} />
                          </button>
                        )}
                        {(job.status === "error" || job.status === "cancelled") && (
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => onRetry(job)}
                            aria-label={`Reintentar ${job.title}`}
                            title="Reintentar"
                          >
                            <Icon name="refresh" size={12} />
                          </button>
                        )}
                        {job.status === "completed" && job.filepath && (
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => onRevealFile(job.filepath as string)}
                            aria-label={`Mostrar ${job.title}`}
                            title="Mostrar archivo"
                          >
                            <Icon name="external" size={12} />
                          </button>
                        )}
                        {job.status === "completed" &&
                          job.masterPath &&
                          job.masterPath !== job.filepath && (
                            <button
                              type="button"
                              className="icon-button"
                              onClick={() => onRevealFile(job.masterPath as string)}
                              aria-label={`Mostrar máster de ${job.title}`}
                              title="Mostrar máster"
                            >
                              <Icon name="film" size={12} />
                            </button>
                          )}
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => onOpenFolder(job.outputDir)}
                          aria-label="Abrir carpeta"
                          title="Abrir carpeta"
                        >
                          <Icon name="folder" size={12} />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <footer className="rail-foot clips-foot">
        {activeCount > 0 && (
          <div className="rail-activity">
            <span className="mono">{activeCount} en curso</span>
            <span className="rail-activity-bar" aria-hidden="true">
              <span style={{ width: `${activePercent}%` }} />
            </span>
          </div>
        )}

        {completedCount > 0 && (
          <button type="button" className="button tiny rail-clear" onClick={onClearCompleted}>
            <Icon name="trash" size={12} />
            Limpiar completados
          </button>
        )}

        <button
          type="button"
          className="rail-export"
          onClick={onExport}
          disabled={staged.length === 0}
        >
          <Icon name="export" size={16} />
          <span>Exportar{staged.length > 0 ? ` ${staged.length}` : ""}</span>
        </button>
      </footer>
    </aside>
  );
}
