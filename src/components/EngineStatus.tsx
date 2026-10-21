import type { EngineStatus as EngineStatusType } from "../types";
import { stageLabel } from "../lib/format";
import { Icon } from "./Icon";

interface EngineStatusProps {
  engine: EngineStatusType | null;
  busy: boolean;
  percent: number | null;
  stage: string;
  onUpdate: () => void;
}

export function EngineStatus({
  engine,
  busy,
  percent,
  stage,
  onUpdate,
}: EngineStatusProps) {
  const installed = Boolean(engine?.installed);
  const state = busy ? "busy" : installed ? "ready" : engine ? "idle" : "checking";
  const value = busy
    ? `${stageLabel(stage)}${percent === null ? "" : ` ${Math.round(percent)}%`}`
    : engine
      ? installed
        ? `yt-dlp ${engine.ytdlpVersion}`
        : "Sin instalar"
      : "Comprobando";

  return (
    <div
      className={`engine-status ${state}`}
      title={
        engine
          ? [
              `yt-dlp ${engine.ytdlpVersion}`,
              engine.ffmpegVersion,
              engine.denoVersion,
            ]
              .filter(Boolean)
              .join("\n")
          : undefined
      }
    >
      <span className="led" aria-hidden="true" />
      <div className="engine-text">
        <span className="engine-label">Motor</span>
        <span className="engine-value">{value}</span>
      </div>
      {installed && (
        <button
          type="button"
          className="icon-button"
          onClick={onUpdate}
          disabled={busy}
          aria-label="Actualizar yt-dlp"
          title="Actualizar yt-dlp"
        >
          <Icon name="refresh" size={14} />
        </button>
      )}
    </div>
  );
}
