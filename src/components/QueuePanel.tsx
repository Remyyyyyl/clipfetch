import type { Job, JobStatus } from "../types";
import { formatBytes, formatEta, formatSpeed } from "../lib/format";
import { entryLabel, filesLabel } from "../lib/progress";
import { Icon } from "./Icon";

interface QueuePanelProps {
  jobs: Job[];
  activeCount: number;
  onCancel: (job: Job) => void;
  onRetry: (job: Job) => void;
  onOpenFolder: (path: string) => void;
  onRevealFile: (path: string) => void;
}

const STATUS_LABELS: Record<JobStatus, string> = {
  queued: "En cola",
  starting: "Iniciando",
  downloading: "Descargando",
  completed: "Completado",
  error: "Error",
  cancelled: "Cancelado",
};

export function QueuePanel({
  jobs,
  activeCount,
  onCancel,
  onRetry,
  onOpenFolder,
  onRevealFile,
}: QueuePanelProps) {
  return (
    <section className="panel queue-panel">
      <header className="panel-head queue-head">
        <div className="queue-title">
          <h2>Cola</h2>
          <span className="queue-count mono">
            {jobs.length} {jobs.length === 1 ? "trabajo" : "trabajos"}
          </span>
        </div>
        <span className="queue-active mono">
          {activeCount} {activeCount === 1 ? "activo" : "activos"}
        </span>
      </header>

      {jobs.length === 0 ? (
        <div className="queue-empty">
          <Icon name="film" size={20} />
          <p>
            <strong>La cola está vacía.</strong> Carga una URL para empezar.
          </p>
        </div>
      ) : (
        <div className="reel-list">
          {jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              onCancel={onCancel}
              onRetry={onRetry}
              onOpenFolder={onOpenFolder}
              onRevealFile={onRevealFile}
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface JobRowProps {
  job: Job;
  onCancel: (job: Job) => void;
  onRetry: (job: Job) => void;
  onOpenFolder: (path: string) => void;
  onRevealFile: (path: string) => void;
}

function JobRow({
  job,
  onCancel,
  onRetry,
  onOpenFolder,
  onRevealFile,
}: JobRowProps) {
  const canCancel =
    job.status === "queued" || job.status === "starting" || job.status === "downloading";
  const canRetry = job.status === "error" || job.status === "cancelled";
  const percent = Math.max(0, Math.min(100, job.percent));
  const files = filesLabel(job);
  const entry = entryLabel(job);
  const tapeClass =
    job.status === "completed"
      ? "is-complete"
      : job.status === "error"
        ? "is-error"
        : job.status === "cancelled"
          ? "is-cancelled"
          : "";

  return (
    <article className={`reel-item ${job.status}`}>
      <div className="job-thumb">
        {job.thumbnail ? (
          <img src={job.thumbnail} alt="" referrerPolicy="no-referrer" />
        ) : (
          <div className="thumb-empty">
            <Icon name="film" size={18} />
          </div>
        )}
      </div>

      <div className="job-body">
        <div className="job-top">
          <div className="job-title-wrap">
            <h3 className="job-title">{job.title}</h3>
            {job.uploader && <span className="job-uploader">{job.uploader}</span>}
          </div>
          <span className={`status ${job.status}`}>
            <span className="status-dot" aria-hidden="true" />
            {job.skipped && job.status === "completed"
              ? "Ya existía"
              : STATUS_LABELS[job.status]}
          </span>
        </div>

        <div className="tape-row">
          <div
            className={`tape ${tapeClass}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
            aria-valuetext={`${Math.round(percent)}%`}
          >
            <div className="tape-fill" style={{ width: `${percent}%` }} />
          </div>
          <span className="job-percent mono">{Math.round(percent)}%</span>
        </div>

        <div className="job-meta mono">
          <span>
            {formatBytes(job.downloaded)} / {formatBytes(job.total)}
          </span>
          <span>{formatSpeed(job.speed)}</span>
          <span>ETA {formatEta(job.eta)}</span>
          {entry && <span className="job-tag">vídeo {entry}</span>}
          {files && job.status === "downloading" && (
            <span className="job-tag">archivo {files}</span>
          )}
        </div>

        {job.error && <p className="job-error">{job.error}</p>}

        <div className="job-actions">
          {canCancel && (
            <button type="button" className="button tiny" onClick={() => onCancel(job)}>
              <Icon name="close" size={13} />
              Cancelar
            </button>
          )}
          {canRetry && (
            <button type="button" className="button tiny" onClick={() => onRetry(job)}>
              <Icon name="refresh" size={13} />
              Reintentar
            </button>
          )}
          {job.status === "completed" && job.filepath && (
            <button
              type="button"
              className="button tiny"
              onClick={() => onRevealFile(job.filepath as string)}
            >
              <Icon name="external" size={13} />
              Mostrar archivo
            </button>
          )}
          <button
            type="button"
            className="button tiny"
            onClick={() => onOpenFolder(job.outputDir)}
          >
            <Icon name="folder" size={13} />
            Carpeta
          </button>
        </div>

        <details className="job-log">
          <summary>Registro</summary>
          <pre>{job.log.length ? job.log.join("\n") : "Sin salida todavía."}</pre>
        </details>
      </div>
    </article>
  );
}
