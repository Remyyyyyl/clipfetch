import type { EditorProfileId, LocalMedia, SourceKind, ToolKind, YtDlpInfo } from "../types";
import { editorProfileLabel } from "../lib/format";
import { Icon } from "./Icon";
import { Notice } from "./Notice";

interface PresetOption {
  value: string;
  label: string;
}

interface ControlPanelProps {
  tool: ToolKind;
  onToolChange: (tool: ToolKind) => void;
  mode: "simple" | "advanced";
  onModeChange: (mode: "simple" | "advanced") => void;
  canAdvanced: boolean;
  source: SourceKind;
  onSourceChange: (source: SourceKind) => void;
  url: string;
  onUrlChange: (value: string) => void;
  analyzing: boolean;
  elapsed: number;
  onAnalyze: () => void;
  info: YtDlpInfo | null;
  local: LocalMedia | null;
  localPicking: boolean;
  onPickLocal: () => void;
  analysisError: string;
  onClearAnalysisError: () => void;
  preset: string;
  presetOptions: PresetOption[];
  onPresetChange: (value: string) => void;
  editorProfile: EditorProfileId;
  keepMaster: boolean;
  outputDir: string;
  onOutputDirChange: (value: string) => void;
  onPickFolder: () => void;
  onStage: () => void;
  stageDisabled: boolean;
}

export function ControlPanel({
  tool,
  onToolChange,
  mode,
  onModeChange,
  canAdvanced,
  source,
  onSourceChange,
  url,
  onUrlChange,
  analyzing,
  elapsed,
  onAnalyze,
  info,
  local,
  localPicking,
  onPickLocal,
  analysisError,
  onClearAnalysisError,
  preset,
  presetOptions,
  onPresetChange,
  editorProfile,
  keepMaster,
  outputDir,
  onOutputDirChange,
  onPickFolder,
  onStage,
  stageDisabled,
}: ControlPanelProps) {
  const isLocal = source === "file";

  return (
    <aside className="control-panel" aria-label="Configuración de la sesión">
      <div className="tool-keys" role="tablist" aria-label="Herramientas">
        <button
          type="button"
          role="tab"
          id="tool-video"
          aria-selected={tool === "video"}
          aria-controls="tool-panel"
          tabIndex={tool === "video" ? 0 : -1}
          className={`tool-key${tool === "video" ? " is-active" : ""}`}
          onClick={() => onToolChange("video")}
        >
          <span className="tool-led" aria-hidden="true" />
          <Icon name="film" size={14} />
          <span>Vídeo</span>
        </button>
        <button
          type="button"
          role="tab"
          id="tool-audio"
          aria-selected={tool === "audio"}
          aria-controls="tool-panel"
          tabIndex={tool === "audio" ? 0 : -1}
          className={`tool-key${tool === "audio" ? " is-active" : ""}`}
          onClick={() => onToolChange("audio")}
        >
          <span className="tool-led" aria-hidden="true" />
          <Icon name="music" size={14} />
          <span>Audio</span>
        </button>
      </div>

      <div className="control-body">
        <div className="source-switch" role="group" aria-label="Origen del archivo">
          <button
            type="button"
            className={!isLocal ? "is-on" : ""}
            aria-pressed={!isLocal}
            onClick={() => onSourceChange("url")}
          >
            Enlace
          </button>
          <button
            type="button"
            className={isLocal ? "is-on" : ""}
            aria-pressed={isLocal}
            onClick={() => onSourceChange("file")}
          >
            Archivo local
          </button>
        </div>

        {!isLocal && (
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
              title={
                canAdvanced
                  ? undefined
                  : "El montaje por tramos necesita una duración conocida y un vídeo suelto"
              }
            >
              Avanzado
            </button>
          </div>
        )}
        {!isLocal ? (
          <>
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
              <button
                type="submit"
                className="button solid"
                disabled={analyzing || !url.trim()}
              >
                {analyzing
                  ? elapsed > 0
                    ? `Leyendo… ${elapsed} s`
                    : "Leyendo…"
                  : "Analizar"}
              </button>
            </form>

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

            {tool === "video" && (
              <p className="hint">
                {editorProfile === "original"
                  ? "Se guarda el archivo original; Premiere puede no abrirlo."
                  : `Se descarga en la máxima calidad y se crea una copia ${editorProfileLabel(editorProfile)}${
                      keepMaster ? ", conservando el máster" : ""
                    }.`}
              </p>
            )}
          </>
        ) : (
          <div className="local-row">
            <button
              type="button"
              className="button solid"
              onClick={onPickLocal}
              disabled={localPicking || analyzing}
            >
              <Icon name="folder" size={15} />
              {localPicking ? "Abriendo…" : local ? "Cambiar archivo" : "Abrir archivo"}
            </button>
            <p className="hint">
              También puedes soltar un vídeo o audio en la ventana. No se copia el archivo
              completo: solo se leen sus datos y se corta lo que pidas.
            </p>
            {local && tool === "video" && editorProfile !== "original" && (
              <p className="hint">
                Se creará una copia {editorProfileLabel(editorProfile)}; el archivo original
                no se modifica.
              </p>
            )}
          </div>
        )}

        {analysisError && (
          <Notice
            title={isLocal ? "No se pudo abrir el archivo" : "No se pudo leer la URL"}
            onClose={onClearAnalysisError}
          >
            {analysisError}
          </Notice>
        )}

        <div className="field">
          <span>Precisión de corte</span>
          <div className="precision-switch" role="group" aria-label="Precisión de corte">
            <button type="button" className="is-on" aria-pressed={true}>
              Rápido (keyframe)
            </button>
            <button
              type="button"
              disabled
              title="Recodifica para cortar en el fotograma exacto. Próximamente."
            >
              Exacto
            </button>
          </div>
          <p className="hint">Rápido no recodifica; puede incluir el keyframe anterior.</p>
        </div>

        <label className="field">
          <span>Carpeta de salida</span>
          <div className="input-row">
            <input
              value={outputDir}
              onChange={(event) => onOutputDirChange(event.target.value)}
              spellCheck={false}
              placeholder="C:\Users\TuUsuario\Downloads"
            />
            <button
              type="button"
              className="button small"
              onClick={onPickFolder}
              aria-label="Elegir carpeta de salida"
            >
              <Icon name="folder" size={14} />
              Elegir
            </button>
          </div>
        </label>

      </div>

      {!isLocal && mode === "simple" && (
        <div className="control-foot">
          <p className="hint">
            {info
              ? `Se añadirá con la calidad ${presetOptions.find((item) => item.value === preset)?.label ?? preset}.`
              : "Analiza una URL para añadirla a la cola."}
          </p>
          <button
            type="button"
            className="button solid add-button"
            onClick={onStage}
            disabled={stageDisabled || !info}
          >
            <Icon name="download" size={15} />
            Añadir a la cola
          </button>
        </div>
      )}
    </aside>
  );
}
