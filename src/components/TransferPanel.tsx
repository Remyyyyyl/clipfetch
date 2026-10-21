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
}

export function TransferPanel({
  preset,
  onPresetChange,
  outputDir,
  onOutputDirChange,
  onPickFolder,
  onDownload,
  isPlaylist,
}: TransferPanelProps) {
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
          <strong>{isPlaylist ? "Playlist completa" : "Un video"}</strong>
        </div>
      </div>

      <button type="button" className="record-button" onClick={onDownload}>
        <span className="record-light" aria-hidden="true" />
        <span>Descargar</span>
        <Icon name="download" size={17} />
      </button>

      <p className="hint">Se añade a la cola y empieza cuando haya hueco.</p>
    </article>
  );
}
