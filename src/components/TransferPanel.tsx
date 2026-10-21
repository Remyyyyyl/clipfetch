import { PRESETS, presetLabel } from "../lib/format";
import { Icon } from "./Icon";

interface TransferPanelProps {
  preset: string;
  onPresetChange: (value: string) => void;
  outputDir: string;
  onOutputDirChange: (value: string) => void;
  onPickFolder: () => void;
  onDownload: () => void;
  isPlaylist: boolean;
  selectedCount: number;
  playlistTotal: number;
  clipCount: number;
}

export function TransferPanel({
  preset,
  onPresetChange,
  outputDir,
  onOutputDirChange,
  onPickFolder,
  onDownload,
  isPlaylist,
  selectedCount,
  playlistTotal,
  clipCount,
}: TransferPanelProps) {
  const selectionEmpty = isPlaylist && selectedCount === 0;
  const scope = isPlaylist
    ? `Playlist · ${selectedCount} de ${playlistTotal}`
    : clipCount > 0
      ? `${clipCount} ${clipCount === 1 ? "tramo" : "tramos"}`
      : "Un vídeo";

  return (
    <article className="panel transfer-panel">
      <header className="panel-head">
        <h2>Transferencia</h2>
        <span className="tag muted-tag">Salida</span>
      </header>

      <div className="field">
        <label htmlFor="format-preset">Calidad</label>
        <div className="select-wrap">
          <select
            id="format-preset"
            value={preset}
            onChange={(event) => onPresetChange(event.target.value)}
          >
            {PRESETS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Icon name="chevron" size={14} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="output-folder">Carpeta</label>
        <div className="input-row">
          <input
            id="output-folder"
            value={outputDir}
            onChange={(event) => onOutputDirChange(event.target.value)}
            spellCheck={false}
          />
          <button
            type="button"
            className="button small"
            onClick={onPickFolder}
            aria-label="Elegir carpeta de descarga"
          >
            <Icon name="folder" size={14} />
            Elegir
          </button>
        </div>
      </div>

      <div className="transfer-readout">
        <div>
          <span>Formato</span>
          <strong>{presetLabel(preset)}</strong>
        </div>
        <div>
          <span>Alcance</span>
          <strong>{scope}</strong>
        </div>
      </div>

      <button
        type="button"
        className="record-button"
        onClick={onDownload}
        disabled={selectionEmpty}
      >
        <span className="record-light" aria-hidden="true" />
        <span>
          {clipCount > 0
            ? `Descargar ${clipCount} ${clipCount === 1 ? "tramo" : "tramos"}`
            : "Descargar"}
        </span>
        <Icon name="download" size={17} />
      </button>

      <p className="hint">
        {selectionEmpty ? (
          <span className="hint-warn">Selecciona al menos un vídeo de la lista.</span>
        ) : clipCount > 0 ? (
          "Un trabajo por tramo, en una carpeta con el nombre del vídeo."
        ) : (
          "Se añade a la cola y empieza cuando haya hueco."
        )}
      </p>
    </article>
  );
}
