import type { ReactNode, Ref } from "react";
import type {
  Clip,
  LocalMedia,
  PreviewState,
  SourceKind,
  ToolKind,
  YtDlpInfo,
} from "../types";
import { formatBytes, formatCount, formatDuration, presetLabel } from "../lib/format";
import { localMeta } from "../lib/local";
import { Icon } from "./Icon";
import { PlaylistPicker } from "./PlaylistPicker";
import { TimelineEditor, type EditorHandle } from "./TimelineEditor";

interface WorkspaceProps {
  tool: ToolKind;
  mode: "simple" | "advanced";
  canAdvanced: boolean;
  source: SourceKind;
  info: YtDlpInfo | null;
  local: LocalMedia | null;
  analyzing: boolean;
  elapsed: number;
  preview: PreviewState;
  preset: string;
  isPlaylist: boolean;
  selection: Set<number>;
  positions: number[];
  onToggleItem: (position: number) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onSelectRange: (from: number, to: number) => void;
  onRetryPreview: () => void;
  onCancelPreview: () => void;
  onAddClips: (ranges: Array<{ start: number; end: number }>) => void;
  editorRef?: Ref<EditorHandle>;
  onClipsChange?: (clips: Clip[]) => void;
  onClipSelectionChange?: (ids: string[]) => void;
  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
  children?: ReactNode;
}

export function Workspace({
  tool,
  mode,
  canAdvanced,
  source,
  info,
  local,
  analyzing,
  elapsed,
  preview,
  preset,
  isPlaylist,
  selection,
  positions,
  onToggleItem,
  onSelectAll,
  onSelectNone,
  onSelectRange,
  onRetryPreview,
  onCancelPreview,
  onAddClips,
  editorRef,
  onClipsChange,
  onClipSelectionChange,
  onHistoryChange,
  children,
}: WorkspaceProps) {
  const isLocal = source === "file";
  const advanced = isLocal || (mode === "advanced" && canAdvanced);
  const canEditor = canAdvanced && (isLocal ? Boolean(local) : Boolean(info && !isPlaylist));
  const format = isLocal ? "Copia rápida" : presetLabel(preset);
  const title = isLocal
    ? local?.title || "Archivo local"
    : info?.title || info?.fulltitle || info?.id || (tool === "video" ? "Vídeo" : "Audio");
  const duration = isLocal ? local?.duration ?? 0 : info?.duration ?? 0;
  const thumb = isLocal ? local?.thumbnailUrl : info?.thumbnail;
  const sourceKey = isLocal
    ? local
      ? `${local.path}:${local.size}`
      : "local"
    : info?.id || info?.webpage_url || title;

  const hint = isPlaylist
    ? "La selección se añade como un solo trabajo."
    : tool === "audio"
      ? preset === "audio"
        ? "Se descarga el audio original, sin recodificar."
        : `Se convierte a ${format}.`
      : preset === "2160" || preset === "1440"
        ? "A esta resolución el sitio suele servir VP9/AV1; el archivo sigue siendo MP4."
        : "MP4 con H.264/AAC cuando el sitio lo ofrece.";

  const localHint =
    tool === "video"
      ? "Copia rápida: el vídeo no se recodifica y el audio pasa a AAC solo si el contenedor lo necesita. El clip puede empezar en el keyframe anterior."
      : "Se extrae y corta la pista de audio original, sin recodificar.";

  return (
    <section
      className={`workspace${advanced ? " is-advanced" : ""}`}
      id="tool-panel"
      role="tabpanel"
      aria-labelledby={`tool-${tool}`}
    >
      {children}

      {isLocal && !local ? (
        <div className={`tool-empty local-empty${analyzing ? " is-busy" : ""}`}>
          <div className="empty-reel" aria-hidden="true">
            <Icon name="film" size={30} />
          </div>
          <div>
            <h2>
              {analyzing
                ? elapsed > 0
                  ? `Leyendo el archivo… ${elapsed} s`
                  : "Leyendo el archivo…"
                : "Abre un vídeo o audio en la botonera"}
            </h2>
            <p>
              {analyzing
                ? "FFprobe está leyendo la duración y los códecs. En archivos muy grandes suele ser cuestión de segundos."
                : "MP4, MKV, MOV, WebM, MP3, FLAC, WAV… También puedes soltarlo en la ventana."}
            </p>
          </div>
        </div>
      ) : !isLocal && !info ? (
        <div className="tool-empty">
          <div className="empty-reel" aria-hidden="true">
            <Icon name="reel" size={30} />
          </div>
          <div>
            <h2>Pega una URL en la botonera</h2>
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
              {thumb ? (
                <img src={thumb} alt="" referrerPolicy="no-referrer" />
              ) : (
                <div className="thumb-empty">
                  <Icon name={tool === "video" ? "film" : "music"} size={24} />
                </div>
              )}
            </div>
            <div className="source-copy">
              <div className="source-tags">
                <span className="tag">
                  {isLocal
                    ? "Archivo local"
                    : isPlaylist
                      ? "Playlist"
                      : tool === "video"
                        ? "Vídeo"
                        : "Audio"}
                </span>
                {isLocal && local?.container && (
                  <span className="tag muted-tag mono">
                    {local.container.toUpperCase()}
                  </span>
                )}
              </div>
              <h2 className="source-title">{title}</h2>
              <div className="meta-line">
                {isLocal && local ? (
                  <>
                    {localMeta(local).map((item) => (
                      <span key={item} className="mono">
                        {item}
                      </span>
                    ))}
                    <span className="mono">{formatBytes(local.size)}</span>
                  </>
                ) : (
                  <>
                    {(info?.uploader || info?.channel) && (
                      <span>{info?.uploader || info?.channel}</span>
                    )}
                    {duration > 0 && (
                      <>
                        <span className="meta-sep" aria-hidden="true" />
                        <span className="mono">{formatDuration(duration)}</span>
                      </>
                    )}
                    {formatCount(info?.view_count) && (
                      <>
                        <span className="meta-sep" aria-hidden="true" />
                        <span className="mono">
                          {formatCount(info?.view_count)} visitas
                        </span>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {!advanced && (
            <div className="workspace-simple">
              <p className="hint">
                {isLocal ? localHint : hint}
              </p>
              <p className="workspace-simple-hint">
                Cambia a <strong>Avanzado</strong> para abrir el editor de tramos.
              </p>
            </div>
          )}

          {isPlaylist && info && (
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

          {canEditor && (
            <div className={`workspace-editor${advanced ? "" : " is-hidden"}`}>
              <TimelineEditor
                ref={editorRef}
                kind={tool}
                title={title}
                sourceKey={sourceKey}
                thumbnail={thumb}
                duration={duration}
                preview={preview}
                formatLabel={format}
                localFile={isLocal}
                active={advanced}
                onRetryPreview={onRetryPreview}
                onCancelPreview={onCancelPreview}
                onAddClips={onAddClips}
                onClipsChange={onClipsChange}
                onClipSelectionChange={onClipSelectionChange}
                onHistoryChange={onHistoryChange}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}
