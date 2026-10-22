import { useState } from "react";
import type { Job, JobStatus, StagedItem } from "../types";
import { formatClock, formatDuration, presetLabel } from "../lib/format";
import { Icon } from "./Icon";

interface QueueRailProps {
  staged: StagedItem[];
  jobs: Job[];
  activeCount: number;
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

const STATUS_LABELS: Record<JobStatus, string> = {
  queued: "En cola",
  starting: "Iniciando",
  downloading: "Descargando",
  completed: "Completado",
  error: "Error",
  cancelled: "Cancelado",
};

function stagedMeta(item: StagedItem): string {
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

export function QueueRail({
  staged,
  jobs,
  activeCount,
  onRemoveStaged,
  onMoveStaged,
  onReorderStaged,
  onExport,
  onCancel,
  onRetry,
  onOpenFolder,
  onRevealFile,
  onClearCompleted,
}: QueueRailProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const completedCount = jobs.filter((job) => job.status === "completed").length;
  const active = jobs.filter(
    (job) => job.status === "starting" || job.status === "downloading",
  );
  const activePercent =
    active.length === 0
      ? 0
      : active.reduce((sum, job) => sum + Math.min(100, job.percent), 0) / active.length;
  const empty = staged.length === 0 && jobs.length === 0;

  return (
    <aside className="rail" aria-label="Cola de descargas">
      <header className="rail-head">
        <h2>Cola</h2>
        <span className="mono rail-count">{staged.length + jobs.length}</span>
      </header>

      <div className="rail-body">
        {empty && (
          <div className="rail-empty">
            <Icon name="reel" size={22} />
            <p>
              <strong>La cola está vacía.</strong> Añade vídeos o tramos desde las
              herramientas.
            </p>
          </div>
        )}

        {staged.length > 0 && (
          <section className="rail-group" aria-label="Preparado para exportar">
            <h3 className="rail-group-head">
              Preparado <span className="mono">{staged.length}</span>
            </h3>
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
          </section>
        )}

        {jobs.length > 0 && (
          <section className="rail-group" aria-label="Descargas">
            <h3 className="rail-group-head">
              Descargas <span className="mono">{jobs.length}</span>
            </h3>
            <ul className="rail-list">
              {jobs.map((job) => (
                <li key={job.id} className={`rail-job ${job.status}`}>
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
                        {Math.round(Math.min(100, Math.max(0, job.percent)))}%
                      </span>
                    </div>

                    <div className="rail-job-meta mono">
                      <span className={`status-dot ${job.status}`} aria-hidden="true" />
                      {job.skipped && job.status === "completed"
                        ? "Ya existía"
                        : STATUS_LABELS[job.status]}
                    </div>

                    <div className="rail-tape" aria-hidden="true">
                      <span
                        className="rail-tape-fill"
                        style={{ width: `${Math.min(100, Math.max(0, job.percent))}%` }}
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
          </section>
        )}
      </div>

      <footer className="rail-foot">
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
