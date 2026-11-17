import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { MediaEntry } from "../types";
import { formatBytes } from "../lib/format";
import { isLocalMediaPath } from "../lib/local";
import { Icon } from "./Icon";

interface MediaBrowserProps {
  root: string;
  onOpenFile: (path: string) => void;
  onPrepareFile?: (path: string) => void;
  onCancelPrepare?: () => void;
  preparingPath?: string | null;
  preparePercent?: number;
  refreshToken?: number;
}

const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "m4v",
  "mov",
  "mkv",
  "webm",
  "avi",
  "mts",
  "m2ts",
  "ts",
  "flv",
  "wmv",
  "ogv",
]);

function isVideoName(name: string): boolean {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXTENSIONS.has(extension);
}

function parentPath(path: string): string | null {
  const cleaned = path.replace(/[\\/]+$/, "");
  if (!cleaned || /^[A-Za-z]:$/.test(cleaned)) return null;
  const index = Math.max(cleaned.lastIndexOf("\\"), cleaned.lastIndexOf("/"));
  if (index < 0) return null;
  const parent = cleaned.slice(0, index);
  if (!parent) return null;
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}\\`;
  return parent;
}

function modifiedLabel(value: number): string {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString("es", {
      day: "2-digit",
      month: "short",
    });
  } catch {
    return "";
  }
}

export function MediaBrowser({
  root,
  onOpenFile,
  onPrepareFile,
  onCancelPrepare,
  preparingPath,
  preparePercent,
  refreshToken,
}: MediaBrowserProps) {
  const [browserRoot, setBrowserRoot] = useState(root);
  const [currentPath, setCurrentPath] = useState(root);
  const [entries, setEntries] = useState<MediaEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef(0);

  useEffect(() => {
    setBrowserRoot(root);
    setCurrentPath(root);
  }, [root]);

  useEffect(() => {
    if (!currentPath) {
      setEntries([]);
      return;
    }
    const ticket = requestRef.current + 1;
    requestRef.current = ticket;
    setLoading(true);
    setError("");
    void invoke<MediaEntry[]>("list_media_dir", { path: currentPath })
      .then((list) => {
        if (requestRef.current !== ticket) return;
        setEntries(
          list.filter((entry) => entry.isDir || isLocalMediaPath(entry.name)),
        );
      })
      .catch((reason) => {
        if (requestRef.current !== ticket) return;
        setEntries([]);
        setError(String(reason));
      })
      .finally(() => {
        if (requestRef.current === ticket) setLoading(false);
      });
  }, [currentPath, refreshToken]);

  const chooseFolder = async () => {
    try {
      const selectedFolder = await open({
        directory: true,
        multiple: false,
        title: "Elegir carpeta para Medios",
        defaultPath: browserRoot || undefined,
      });
      if (typeof selectedFolder === "string") {
        setBrowserRoot(selectedFolder);
        setCurrentPath(selectedFolder);
        setSelected(null);
      }
    } catch (reason) {
      setError(String(reason));
    }
  };

  const openEntry = (entry: MediaEntry) => {
    if (entry.isDir) {
      setCurrentPath(entry.path);
      setSelected(null);
    } else {
      onOpenFile(entry.path);
    }
  };

  const up = parentPath(currentPath);
  const canGoUp = Boolean(up) && currentPath !== browserRoot;

  return (
    <aside className="media-browser" aria-label="Medios">
      <header className="media-head">
        <h2>Medios</h2>
        <div className="media-head-actions">
          <button type="button" className="button tiny" onClick={() => void chooseFolder()}>
            Elegir
          </button>
          <button
            type="button"
            className="button tiny"
            onClick={() => {
              if (canGoUp && up) {
                setCurrentPath(up);
                setSelected(null);
              }
            }}
            disabled={!canGoUp}
            title="Subir una carpeta"
          >
            Subir
          </button>
        </div>
      </header>

      <div className="media-body">
        <code className="media-root mono" title={currentPath}>
          {currentPath || "Sin carpeta"}
        </code>

        {loading ? (
          <p className="hint">Leyendo la carpeta…</p>
        ) : error ? (
          <p className="media-error">{error}</p>
        ) : entries.length === 0 ? (
          <p className="hint">No hay vídeos, audios ni subcarpetas aquí.</p>
        ) : (
          <ul className="media-list">
            {entries.map((entry) => (
              <li key={entry.path} className="media-item">
                <button
                  type="button"
                  className={`media-row${selected === entry.path ? " is-selected" : ""}`}
                  onClick={() => setSelected(entry.path)}
                  onDoubleClick={() => openEntry(entry)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      openEntry(entry);
                    }
                  }}
                  title={entry.isDir ? "Abrir carpeta" : "Abrir en el editor"}
                >
                  <span className="media-icon" aria-hidden="true">
                    <Icon name={entry.isDir ? "folder" : "film"} size={14} />
                  </span>
                  <span className="media-name" title={entry.name}>
                    {entry.name}
                  </span>
                  <span className="media-meta mono">
                    {entry.isDir ? "" : formatBytes(entry.size)}
                    {entry.isDir ? "" : " · "}
                    {modifiedLabel(entry.modified)}
                  </span>
                </button>
                {!entry.isDir && isVideoName(entry.name) && onPrepareFile && (
                  <button
                    type="button"
                    className="button tiny media-prepare"
                    onClick={() =>
                      preparingPath === entry.path
                        ? onCancelPrepare?.()
                        : onPrepareFile(entry.path)
                    }
                    title={
                      preparingPath === entry.path
                        ? "Cancelar la preparación"
                        : "Crear una copia para edición"
                    }
                  >
                    {preparingPath === entry.path
                      ? `Cancelar ${Math.round(preparePercent ?? 0)}%`
                      : "Editar"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
