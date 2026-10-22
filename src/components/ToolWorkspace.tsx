import { useState } from "react";
import type { PreviewState, ToolKind, YtDlpInfo } from "../types";
import { formatCount, formatDuration, presetLabel } from "../lib/format";
import { MAX_LISTED_ENTRIES, entryPosition } from "../lib/playlist";
import { Icon } from "./Icon";
import { Notice } from "./Notice";
import { TimelineEditor } from "./TimelineEditor";

interface PresetOption {
  value: string;
  label: string;
}

interface ToolWorkspaceProps {
  tool: ToolKind;
  mode: "simple" | "advanced";
  onModeChange: (mode: "simple" | "advanced") => void;
  canAdvanced: boolean;
  url: string;
  onUrlChange: (value: string) => void;
  analyzing: boolean;
  elapsed: number;
  onAnalyze: () => void;
  info: YtDlpInfo | null;
  analysisError: string;
  onClearAnalysisError: () => void;
  preview: PreviewState;
  onRetryPreview: () => void;
  preset: string;
  presetOptions: PresetOption[];
  onPresetChange: (value: string) => void;
  outputDir: string;
  onOutputDirChange: (value: string) => void;
  onPickFolder: () => void;
  onStage: () => void;
  isPlaylist: boolean;
  selection: Set<number>;
  positions: number[];
  onToggleItem: (position: number) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onSelectRange: (from: number, to: number) => void;
  onAddClips: (ranges: Array<{ start: number; end: number }>) => void;
}

export function ToolWorkspace({
  tool,
  mode,
  onModeChange,
  canAdvanced,
  url,
  onUrlChange,
  analyzing,
  elapsed,
  onAnalyze,
  info,
  analysisError,
  onClearAnalysisError,
  preview,
  onRetryPreview,
  preset,
  presetOptions,
  onPresetChange,
  outputDir,
  onOutputDirChange,
  onPickFolder,
  onStage,
  isPlaylist,
  selection,
  positions,
  onToggleItem,
  onSelectAll,
  onSelectNone,
  onSelectRange,
  onAddClips,
}: ToolWorkspaceProps) {
  const advanced = mode === "advanced" && canAdvanced;
  const format = presetLabel(preset);
  const title =
    info?.title || info?.fulltitle || info?.id || (tool === "video" ? "Vídeo" : "Audio");
  const duration = info?.duration ?? 0;

  const hint = isPlaylist
    ? "La selección se añade como un solo trabajo."
    : tool === "audio"
      ? preset === "audio"
        ? "Se descarga el audio original, sin recodificar."
        : `Se convierte a ${format}.`
      : preset === "2160" || preset === "1440"
        ? "A esta resolución el sitio suele servir VP9/AV1; el archivo sigue siendo MP4."
        : "MP4 con H.264/AAC cuando el sitio lo ofrece.";

  return (
    <section
      className="tool"
      id="tool-panel"
      role="tabpanel"
      aria-labelledby={`tool-${tool}`}
      aria-live="polite"
    >
      <header className="tool-head">
        <div className="tool-title">
          <h1>{tool === "video" ? "Vídeo" : "Audio"}</h1>
          <p>
            {tool === "video"
              ? "Descarga el vídeo completo o prepara tramos en el editor."
              : "Extrae el audio en el formato que necesites, con o sin cortes."}
          </p>
        </div>

        <div className="mode-switch" role="group" aria-label="Modo de la herramienta">
          <button
            type="button"
            className={mode === "simple" ? "is-on" : ""}
            aria-pressed={mode === "simple"}
            onClick={() => onModeChange("simple")}
          >
            Simple
          </button>
          <button
            type="button"
            className={mode === "advanced" ? "is-on" : ""}
            aria-pressed={mode === "advanced"}
            onClick={() => onModeChange("advanced")}
            disabled={!canAdvanced}
            title={canAdvanced ? undefined : "El montaje por tramos necesita una duración conocida y un vídeo suelto"}
          >
            Avanzado
          </button>
        </div>
      </header>

      <form
        className="url-row"
        onSubmit={(event) => {
          event.preventDefault();
          onAnalyze();
        }}
      >
        <div className="url-field">
          <Icon name={tool === "video" ? "film" : "music"} size={17} />
          <input
            value={url}
            onChange={(event) => onUrlChange(event.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            spellCheck={false}
            aria-label="URL de la fuente"
          />
        </div>
        <button type="submit" className="button solid" disabled={analyzing || !url.trim()}>
          {analyzing ? (elapsed > 0 ? `Leyendo… ${elapsed} s` : "Leyendo…") : "Cargar"}
        </button>
      </form>

      <p className="hint tool-hint">
        {analyzing && elapsed >= 12
          ? "Las playlists y canales grandes tardan más. Seguimos esperando."
          : "YouTube, playlists, canales y otros sitios compatibles con yt-dlp."}
      </p>

      {analysisError && (
        <Notice title="No se pudo leer la URL" onClose={onClearAnalysisError}>
          {analysisError}
        </Notice>
      )}

      {!info ? (
        <div className="tool-empty">
          <div className="empty-reel" aria-hidden="true">
            <Icon name="reel" size={30} />
          </div>
          <div>
            <h2>Pega una URL para empezar</h2>
            <p>
              {tool === "video"
                ? "Verás la miniatura, la duración y las calidades antes de añadirlo a la cola."
                : "Elige el formato de audio y añádelo a la cola, o abre el editor para cortar tramos."}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="source-block">
            <div className="source-thumb-lg">
              {info.thumbnail ? (
                <img src={info.thumbnail} alt="" referrerPolicy="no-referrer" />
              ) : (
                <div className="thumb-empty">
                  <Icon name={tool === "video" ? "film" : "music"} size={24} />
                </div>
              )}
            </div>
            <div className="source-copy">
              <div className="source-tags">
                <span className="tag">{isPlaylist ? "Playlist" : tool === "video" ? "Vídeo" : "Audio"}</span>
              </div>
              <h2 className="source-title">{title}</h2>
              <div className="meta-line">
                {(info.uploader || info.channel) && (
                  <span>{info.uploader || info.channel}</span>
                )}
                {duration > 0 && (
                  <>
                    <span className="meta-sep" aria-hidden="true" />
                    <span className="mono">{formatDuration(duration)}</span>
                  </>
                )}
                {formatCount(info.view_count) && (
                  <>
                    <span className="meta-sep" aria-hidden="true" />
                    <span className="mono">{formatCount(info.view_count)} visitas</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {isPlaylist && (
            <PlaylistPicker
              info={info}
              selection={selection}
              positions={positions}
              onToggleItem={onToggleItem}
              onSelectAll={onSelectAll}
              onSelectNone={onSelectNone}
              onSelectRange={onSelectRange}
            />
          )}

          {!advanced && (
            <div className="tool-options">
              <div className="options-grid">
                <label className="field">
                  <span>{tool === "video" ? "Calidad" : "Formato de audio"}</span>
                  <div className="select-wrap">
                    <select
                      value={preset}
                      onChange={(event) => onPresetChange(event.target.value)}
                    >
                      {presetOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <Icon name="chevron" size={14} />
                  </div>
                </label>

                <label className="field">
                  <span>Carpeta</span>
                  <div className="input-row">
                    <input
                      value={outputDir}
                      onChange={(event) => onOutputDirChange(event.target.value)}
                      spellCheck={false}
                      placeholder="C:\\Users\\TuUsuario\\Downloads"
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
                </label>
              </div>

              <div className="options-foot">
                <p className="hint">{hint}</p>
                <button
                  type="button"
                  className="button solid add-button"
                  onClick={onStage}
                  disabled={isPlaylist && selection.size === 0}
                >
                  <Icon name="download" size={15} />
                  Añadir a la cola
                </button>
              </div>
            </div>
          )}

          {advanced && !isPlaylist && (
            <>
              <div className="advanced-options">
                <label className="field compact">
                  <span>{tool === "video" ? "Calidad" : "Formato"}</span>
                  <div className="select-wrap">
                    <select
                      value={preset}
                      onChange={(event) => onPresetChange(event.target.value)}
                    >
                      {presetOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <Icon name="chevron" size={14} />
                  </div>
                </label>
                <label className="field compact grow">
                  <span>Carpeta</span>
                  <div className="input-row">
                    <input
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
                </label>
              </div>

              <TimelineEditor
                kind={tool}
                title={title}
                thumbnail={info.thumbnail}
                duration={duration}
                preview={preview}
                formatLabel={format}
                onRetryPreview={onRetryPreview}
                onAddClips={onAddClips}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}

interface PlaylistPickerProps {
  info: YtDlpInfo;
  selection: Set<number>;
  positions: number[];
  onToggleItem: (position: number) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onSelectRange: (from: number, to: number) => void;
}

function PlaylistPicker({
  info,
  selection,
  positions,
  onToggleItem,
  onSelectAll,
  onSelectNone,
  onSelectRange,
}: PlaylistPickerProps) {
  const entries = info.entries ?? [];
  const [rangeFrom, setRangeFrom] = useState("1");
  const [rangeTo, setRangeTo] = useState("");
  const lastPosition = positions.length > 0 ? positions[positions.length - 1] : 0;

  return (
    <div className="entries playlist-picker">
      <div className="entries-head">
        <span className="entries-count mono">
          {selection.size} de {entries.length} seleccionados
        </span>
        <div className="entries-actions">
          <button type="button" className="button tiny" onClick={onSelectAll}>
            Todos
          </button>
          <button
            type="button"
            className="button tiny"
            onClick={onSelectNone}
            disabled={selection.size === 0}
          >
            Ninguno
          </button>
        </div>
      </div>

      <div className="range-row">
        <label className="range-field">
          <span>Desde</span>
          <input
            type="number"
            min={1}
            max={lastPosition || undefined}
            value={rangeFrom}
            onChange={(event) => setRangeFrom(event.target.value)}
            inputMode="numeric"
          />
        </label>
        <label className="range-field">
          <span>Hasta</span>
          <input
            type="number"
            min={1}
            max={lastPosition || undefined}
            value={rangeTo}
            placeholder={String(lastPosition)}
            onChange={(event) => setRangeTo(event.target.value)}
            inputMode="numeric"
          />
        </label>
        <button
          type="button"
          className="button tiny"
          onClick={() => {
            const from = Number(rangeFrom);
            const to = Number(rangeTo || lastPosition);
            if (!Number.isFinite(from) || !Number.isFinite(to)) return;
            onSelectRange(Math.round(from), Math.round(to));
          }}
        >
          Añadir rango
        </button>
      </div>

      <ul className="entry-list">
        {entries.slice(0, MAX_LISTED_ENTRIES).map((entry, index) => {
          const position = entryPosition(entry, index);
          return (
            <li key={`${position}-${entry.id ?? index}`}>
              <label className="entry-row">
                <input
                  type="checkbox"
                  checked={selection.has(position)}
                  onChange={() => onToggleItem(position)}
                />
                <span className="entry-index mono">{position}</span>
                <span className="entry-title">
                  {entry.title || entry.url || "Sin título"}
                </span>
                {entry.duration ? (
                  <span className="entry-duration mono">
                    {formatDuration(entry.duration)}
                  </span>
                ) : null}
              </label>
            </li>
          );
        })}
      </ul>
      {entries.length > MAX_LISTED_ENTRIES && (
        <p className="entries-more">
          Se muestran los primeros {MAX_LISTED_ENTRIES}. Para el resto, añade un rango
          (por ejemplo {MAX_LISTED_ENTRIES + 1}-{lastPosition}).
        </p>
      )}
    </div>
  );
}
