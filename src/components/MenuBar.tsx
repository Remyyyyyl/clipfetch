import { useEffect, useRef, useState } from "react";
import type { EngineStatus as EngineStatusType, EngineUpdate, Job } from "../types";
import { EngineStatus } from "./EngineStatus";
import { Icon } from "./Icon";

interface MenuBarProps {
  engine: EngineStatusType;
  engineBusy: boolean;
  enginePercent: number | null;
  engineStage: string;
  engineUpdate: EngineUpdate | null;
  onUpdateEngine: () => void;
  onOpenSettings: () => void;
  canEdit: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canCut: boolean;
  onCut: () => void;
  canDelete: boolean;
  onDelete: () => void;
  onMarkIn: () => void;
  onMarkOut: () => void;
  playlistAvailable: boolean;
  onPlaylistAll: () => void;
  onPlaylistNone: () => void;
  onPlaylistInvert: () => void;
  clipsAvailable: boolean;
  onClipsAll: () => void;
  onClipsNone: () => void;
  onClipsInvert: () => void;
  clipsVisible: boolean;
  mediaVisible: boolean;
  onToggleClips: () => void;
  onToggleMedia: () => void;
  onFit: () => void;
  onResetLayout: () => void;
  onOpenLocal: () => void;
  onAnalyze: () => void;
  onExport: () => void;
  stagedCount: number;
  hasCompleted: boolean;
  onClearCompleted: () => void;
  onExit: () => void;
  queueCount: number;
  jobs: Job[];
}

type MenuId = "file" | "edit" | "selection" | "view" | "help";
type DialogId = "shortcuts" | "log" | "about";

const SHORTCUTS: Array<[string, string]> = [
  ["Espacio", "Reproducir / pausar"],
  ["← / →", "±1 s"],
  ["Mayús + ← / →", "±10 s"],
  [", / .", "Frame anterior / siguiente"],
  ["Inicio / Fin", "Ir al principio / al final"],
  ["I / O", "Marcar entrada / salida"],
  ["C", "Cortar en la aguja"],
  ["V / H / Z", "Seleccionar / Mover / Zoom"],
  ["S", "Imán"],
  ["M", "Silencio"],
  ["+ / − / 0", "Escala / ver todo"],
  ["Supr", "Eliminar tramos seleccionados"],
  ["Ctrl+Z / Ctrl+Y", "Deshacer / rehacer"],
  ["Ctrl+A", "Seleccionar todo en el panel"],
  ["Ctrl+Enter", "Añadir la selección a Preparado"],
];

export function MenuBar({
  engine,
  engineBusy,
  enginePercent,
  engineStage,
  engineUpdate,
  onUpdateEngine,
  onOpenSettings,
  canEdit,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  canCut,
  onCut,
  canDelete,
  onDelete,
  onMarkIn,
  onMarkOut,
  playlistAvailable,
  onPlaylistAll,
  onPlaylistNone,
  onPlaylistInvert,
  clipsAvailable,
  onClipsAll,
  onClipsNone,
  onClipsInvert,
  clipsVisible,
  mediaVisible,
  onToggleClips,
  onToggleMedia,
  onFit,
  onResetLayout,
  onOpenLocal,
  onAnalyze,
  onExport,
  stagedCount,
  hasCompleted,
  onClearCompleted,
  onExit,
  queueCount,
  jobs,
}: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [dialog, setDialog] = useState<DialogId | null>(null);
  const [logJobId, setLogJobId] = useState("");
  const barRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  useEffect(() => {
    if (!dialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialog(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialog]);

  const activeJob =
    jobs.find((job) => job.id === logJobId) ?? jobs[0] ?? null;

  const item = (
    label: string,
    action: () => void,
    options?: { shortcut?: string; disabled?: boolean; title?: string },
  ) => (
    <button
      type="button"
      role="menuitem"
      className="menu-item"
      disabled={options?.disabled}
      title={options?.title}
      onClick={() => {
        if (options?.disabled) return;
        action();
        setOpenMenu(null);
      }}
    >
      <span>{label}</span>
      {options?.shortcut && (
        <span className="menu-shortcut mono">{options.shortcut}</span>
      )}
    </button>
  );

  const menuButton = (id: MenuId, label: string) => (
    <button
      type="button"
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={openMenu === id}
      className={`menu-trigger${openMenu === id ? " is-open" : ""}`}
      onClick={() => setOpenMenu(openMenu === id ? null : id)}
    >
      {label}
    </button>
  );

  return (
    <header className="menu-bar" ref={barRef}>
      <div className="brand">
        <span className="brand-mark">
          <Icon name="reel" size={20} />
        </span>
        <span className="brand-name">ClipFetch</span>
      </div>

      <nav className="menu-bar-menus" role="menubar" aria-label="Menú principal">
        <div className="menu-root">
          {menuButton("file", "Archivo")}
          {openMenu === "file" && (
            <div className="menu-dropdown" role="menu">
              {item("Abrir archivo local…", onOpenLocal)}
              {item("Analizar URL", onAnalyze)}
              <span className="menu-separator" role="separator" />
              {item("Exportar cola", onExport, {
                disabled: stagedCount === 0,
              })}
              {item("Limpiar completados", onClearCompleted, {
                disabled: !hasCompleted,
              })}
              <span className="menu-separator" role="separator" />
              {item("Salir", onExit)}
            </div>
          )}
        </div>

        <div className="menu-root">
          {menuButton("edit", "Edición")}
          {openMenu === "edit" && (
            <div className="menu-dropdown" role="menu">
              {item("Deshacer", onUndo, {
                shortcut: "Ctrl+Z",
                disabled: !canEdit || !canUndo,
              })}
              {item("Rehacer", onRedo, {
                shortcut: "Ctrl+Y",
                disabled: !canEdit || !canRedo,
              })}
              <span className="menu-separator" role="separator" />
              {item("Cortar en la aguja", onCut, {
                shortcut: "C",
                disabled: !canEdit || !canCut,
              })}
              {item("Eliminar tramo", onDelete, {
                shortcut: "Supr",
                disabled: !canEdit || !canDelete,
              })}
              <span className="menu-separator" role="separator" />
              {item("Marcar entrada", onMarkIn, {
                shortcut: "I",
                disabled: !canEdit,
              })}
              {item("Marcar salida", onMarkOut, {
                shortcut: "O",
                disabled: !canEdit,
              })}
            </div>
          )}
        </div>

        <div className="menu-root">
          {menuButton("selection", "Selección")}
          {openMenu === "selection" && (
            <div className="menu-dropdown" role="menu">
              <span className="menu-group-label">Playlist</span>
              {item("Todos", onPlaylistAll, { disabled: !playlistAvailable })}
              {item("Ninguno", onPlaylistNone, { disabled: !playlistAvailable })}
              {item("Invertir", onPlaylistInvert, { disabled: !playlistAvailable })}
              <span className="menu-separator" role="separator" />
              <span className="menu-group-label">Tramos</span>
              {item("Todos", onClipsAll, {
                disabled: !canEdit || !clipsAvailable,
              })}
              {item("Ninguno", onClipsNone, {
                disabled: !canEdit || !clipsAvailable,
              })}
              {item("Invertir", onClipsInvert, {
                disabled: !canEdit || !clipsAvailable,
              })}
            </div>
          )}
        </div>

        <div className="menu-root">
          {menuButton("view", "Vista")}
          {openMenu === "view" && (
            <div className="menu-dropdown" role="menu">
              {item(clipsVisible ? "Ocultar barra de clips" : "Mostrar barra de clips", onToggleClips)}
              {item(mediaVisible ? "Ocultar medios" : "Mostrar medios", onToggleMedia)}
              <span className="menu-separator" role="separator" />
              {item("Ver toda la línea de tiempo", onFit, {
                shortcut: "0",
                disabled: !canEdit,
              })}
              {item("Restablecer disposición", onResetLayout)}
            </div>
          )}
        </div>

        <div className="menu-root">
          {menuButton("help", "Ayuda")}
          {openMenu === "help" && (
            <div className="menu-dropdown" role="menu">
              {item("Atajos de teclado", () => setDialog("shortcuts"))}
              {item("Registro de actividad", () => setDialog("log"), {
                disabled: jobs.length === 0,
              })}
              {item("Acerca de ClipFetch", () => setDialog("about"))}
            </div>
          )}
        </div>
      </nav>

      <div className="menu-bar-tools">
        {queueCount > 0 && !clipsVisible && (
          <button
            type="button"
            className="button tiny menu-queue"
            onClick={onToggleClips}
            title="Mostrar la cola"
          >
            Cola ({queueCount})
          </button>
        )}
        <EngineStatus
          engine={engine}
          busy={engineBusy}
          percent={enginePercent}
          stage={engineStage}
          update={engineUpdate}
          onUpdate={onUpdateEngine}
        />
        {engine.installed && (
          <button
            type="button"
            className="button ghost menu-settings"
            onClick={onOpenSettings}
            aria-label="Ajustes"
          >
            <Icon name="settings" size={16} />
            <span className="button-label">Ajustes</span>
          </button>
        )}
      </div>

      {dialog && (
        <div
          className="menu-dialog-layer"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDialog(null);
          }}
        >
          <div
            className="menu-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={
              dialog === "shortcuts"
                ? "Atajos de teclado"
                : dialog === "log"
                  ? "Registro de actividad"
                  : "Acerca de ClipFetch"
            }
          >
            <header className="menu-dialog-head">
              <h2>
                {dialog === "shortcuts"
                  ? "Atajos de teclado"
                  : dialog === "log"
                    ? "Registro de actividad"
                    : "Acerca de ClipFetch"}
              </h2>
              <button
                type="button"
                className="icon-button"
                onClick={() => setDialog(null)}
                aria-label="Cerrar"
              >
                <Icon name="close" size={18} />
              </button>
            </header>

            {dialog === "shortcuts" && (
              <div className="shortcut-dialog">
                {SHORTCUTS.map(([key, action]) => (
                  <div key={key} className="shortcut-row">
                    <kbd>{key}</kbd>
                    <span>{action}</span>
                  </div>
                ))}
              </div>
            )}

            {dialog === "log" && (
              <div className="log-dialog">
                <label className="field">
                  <span>Trabajo</span>
                  <select
                    value={activeJob?.id ?? ""}
                    onChange={(event) => setLogJobId(event.target.value)}
                  >
                    {jobs.map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.title}
                      </option>
                    ))}
                  </select>
                </label>
                <pre className="log-pre mono">
                  {activeJob?.log.length
                    ? activeJob.log.slice(-400).join("\n")
                    : "Sin actividad registrada."}
                </pre>
              </div>
            )}

            {dialog === "about" && (
              <div className="about-dialog">
                <p>
                  <strong>ClipFetch {__APP_VERSION__}</strong>
                </p>
                <p>
                  Interfaz de escritorio para yt-dlp y FFmpeg. Descarga y recorta
                  vídeo o audio sin recodificar por defecto.
                </p>
                <p className="hint">
                  El motor se guarda en la carpeta local de datos de la app.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
