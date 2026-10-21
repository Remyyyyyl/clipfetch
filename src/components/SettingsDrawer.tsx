import { useEffect, useRef } from "react";
import type { Settings } from "../types";
import { Icon } from "./Icon";

interface SettingsDrawerProps {
  open: boolean;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
  onPickFolder: () => void;
  onPickCookiesFile: () => void;
}

export function SettingsDrawer({
  open,
  settings,
  onChange,
  onClose,
  onPickFolder,
  onPickCookiesFile,
}: SettingsDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="drawer-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={panelRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header className="drawer-head">
          <div>
            <h2 id="settings-title">Ajustes</h2>
            <p>Se guardan en este equipo.</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Cerrar ajustes"
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="drawer-body">
          <section className="settings-section">
            <h3>Salida</h3>
            <label className="field">
              <span>Carpeta de descargas</span>
              <div className="input-row">
                <input
                  value={settings.outputDir}
                  onChange={(event) => onChange({ outputDir: event.target.value })}
                  placeholder="C:\\Users\\TuUsuario\\Downloads"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="button small"
                  onClick={onPickFolder}
                >
                  <Icon name="folder" size={14} />
                  Elegir
                </button>
              </div>
            </label>
          </section>

          <section className="settings-section">
            <h3>Descargas</h3>
            <div className="settings-grid">
              <label className="field">
                <span>Simultáneas</span>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={settings.concurrency}
                  onChange={(event) =>
                    onChange({
                      concurrency: Math.max(
                        1,
                        Math.min(5, Number(event.target.value) || 1),
                      ),
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Límite de velocidad</span>
                <input
                  value={settings.rateLimit}
                  onChange={(event) => onChange({ rateLimit: event.target.value })}
                  placeholder="Ej. 5M"
                />
              </label>
            </div>
          </section>

          <section className="settings-section">
            <h3>Cookies</h3>
            <label className="field">
              <span>Origen</span>
              <div className="select-wrap">
                <select
                  value={settings.cookiesMode}
                  onChange={(event) =>
                    onChange({
                      cookiesMode: event.target.value as Settings["cookiesMode"],
                    })
                  }
                >
                  <option value="none">Sin cookies</option>
                  <option value="firefox">Usar Firefox</option>
                  <option value="file">Archivo cookies.txt</option>
                </select>
                <Icon name="chevron" size={14} />
              </div>
            </label>

            {settings.cookiesMode === "file" && (
              <label className="field">
                <span>Archivo</span>
                <div className="input-row">
                  <input
                    value={settings.cookiesPath}
                    onChange={(event) => onChange({ cookiesPath: event.target.value })}
                    placeholder="C:\\ruta\\cookies.txt"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="button small"
                    onClick={onPickCookiesFile}
                  >
                    <Icon name="folder" size={14} />
                    Elegir
                  </button>
                </div>
              </label>
            )}

            <p className="note">
              Chrome y Edge en Windows no permiten extraer cookies de forma fiable.
              Usa Firefox o exporta un <code>cookies.txt</code> con una extensión.
            </p>
          </section>

          <section className="settings-section">
            <h3>Avanzado</h3>
            <label className="field">
              <span>Argumentos extra de yt-dlp</span>
              <textarea
                rows={3}
                value={settings.extraArgs}
                onChange={(event) => onChange({ extraArgs: event.target.value })}
                placeholder="--embed-metadata --write-subs --sub-langs es"
                spellCheck={false}
              />
            </label>
            <p className="note">
              Se aplican a todas las descargas. <code>--exec</code> está bloqueado por
              seguridad.
            </p>
          </section>
        </div>

        <footer className="drawer-foot">
          <span>Los cambios se guardan automáticamente.</span>
          <button type="button" className="button" onClick={onClose}>
            Cerrar
          </button>
        </footer>
      </aside>
    </div>
  );
}
