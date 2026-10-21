import type { EngineStatus } from "../types";
import { stageLabel } from "../lib/format";
import { Icon } from "./Icon";
import { Notice } from "./Notice";

interface SetupScreenProps {
  engine: EngineStatus;
  busy: boolean;
  percent: number | null;
  stage: string;
  error: string;
  onInstall: () => void;
}

const COMPONENTS = [
  { key: "yt-dlp", name: "yt-dlp", role: "Extracción y descarga" },
  { key: "ffmpeg", name: "FFmpeg", role: "Unión y conversión" },
  { key: "deno", name: "Deno", role: "Desafíos de YouTube" },
];

export function SetupScreen({
  engine,
  busy,
  percent,
  stage,
  error,
  onInstall,
}: SetupScreenProps) {
  const partial = engine.missing.length > 0 && engine.missing.length < COMPONENTS.length;
  const stateLabel = busy ? "Instalando" : partial ? "Incompleto" : "Pendiente";

  return (
    <main className="setup-screen">
      <section className="setup-copy">
        <h1>Prepara el motor.</h1>
        <p className="lede">
          ClipFetch necesita tres componentes para descargar, unir y entender
          YouTube. Se instalan una vez y se actualizan por separado.
        </p>

        <ul className="component-list">
          {COMPONENTS.map((component) => (
            <li key={component.key}>
              <span className="component-name">{component.name}</span>
              <span className="component-role">{component.role}</span>
            </li>
          ))}
        </ul>

        <div className="setup-path">
          <span>Se guarda en</span>
          <code title={engine.dir}>{engine.dir}</code>
        </div>
      </section>

      <aside className="engine-bay" aria-label="Estado del motor">
        <div className="bay-head">
          <span className={`led ${busy ? "busy" : "idle"}`} aria-hidden="true" />
          <div>
            <span className="bay-label">Estado</span>
            <span className="bay-value">{stateLabel}</span>
          </div>
        </div>

        <div className="bay-progress">
          <div className="bay-progress-head">
            <span>{busy ? stageLabel(stage) : "Componentes"}</span>
            <span>{percent === null ? "—" : `${Math.round(percent)}%`}</span>
          </div>
          <div
            className={`tape large${busy && percent === null ? " is-indeterminate" : ""}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent === null ? undefined : Math.round(percent)}
          >
            <div
              className="tape-fill"
              style={{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }}
            />
          </div>
        </div>

        <ul className="bay-list">
          {COMPONENTS.map((component) => {
            const ready = !engine.missing.includes(component.key);
            const active = busy && stage === component.key;
            return (
              <li key={component.key}>
                <span
                  className={`led ${ready ? "ready" : active ? "busy" : "idle"}`}
                  aria-hidden="true"
                />
                <span className="bay-name">{component.name}</span>
                <span className={`bay-state ${ready ? "ready" : active ? "active" : ""}`}>
                  {ready ? "Listo" : active ? "Instalando" : "Pendiente"}
                </span>
              </li>
            );
          })}
        </ul>

        {error && (
          <Notice kind="error" title="No se pudo completar la instalación">
            {error}
          </Notice>
        )}

        <button
          type="button"
          className="record-button"
          onClick={onInstall}
          disabled={busy}
        >
          <span className="record-light" aria-hidden="true" />
          <span>{busy ? "Instalando…" : partial ? "Completar motor" : "Instalar motor"}</span>
          <Icon name="download" size={17} />
        </button>

        <p className="bay-note">
          ~250 MB de descarga
          <span aria-hidden="true"> / </span>
          ~450 MB en disco
        </p>
      </aside>
    </main>
  );
}
