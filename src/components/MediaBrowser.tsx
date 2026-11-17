interface MediaBrowserProps {
  root: string;
}

export function MediaBrowser({ root }: MediaBrowserProps) {
  return (
    <aside className="media-browser" aria-label="Medios">
      <header className="media-head">
        <h2>Medios</h2>
      </header>
      <div className="media-body">
        <p className="hint">Carpeta de salida:</p>
        <code className="media-root mono">{root || "Sin carpeta"}</code>
        <p className="hint media-placeholder">
          El navegador de archivos se activa en la fase de medios.
        </p>
      </div>
    </aside>
  );
}
