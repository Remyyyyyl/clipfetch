import type { YtDlpInfo } from "../types";
import { formatCount, formatDuration } from "../lib/format";
import { Icon } from "./Icon";

interface SourcePanelProps {
  info: YtDlpInfo;
  thumbnail?: string;
  isPlaylist: boolean;
  onPlaylistChange: (value: boolean) => void;
}

export function SourcePanel({
  info,
  thumbnail,
  isPlaylist,
  onPlaylistChange,
}: SourcePanelProps) {
  const playlistType = info._type === "playlist";
  const entries = info.entries ?? [];
  const title = info.title || info.id || "Sin título";
  const uploader = info.uploader || info.channel;
  const views = formatCount(info.view_count);

  return (
    <article className="panel source-panel">
      <header className="panel-head">
        <h2>Fuente</h2>
        <span className="tag">{playlistType ? "Playlist" : "Video"}</span>
      </header>

      <div className="source-media">
        <div className="source-thumb">
          {thumbnail ? (
            <img src={thumbnail} alt="" referrerPolicy="no-referrer" />
          ) : (
            <div className="thumb-empty">
              <Icon name="film" size={26} />
            </div>
          )}
          {info.duration ? (
            <span className="timecode">{formatDuration(info.duration)}</span>
          ) : null}
        </div>

        <div className="source-copy">
          <h3 className="source-title">{title}</h3>

          <div className="meta-line">
            {uploader && <span>{uploader}</span>}
            {info.duration ? (
              <>
                <span className="meta-sep" aria-hidden="true" />
                <span className="mono">{formatDuration(info.duration)}</span>
              </>
            ) : null}
            {views ? (
              <>
                <span className="meta-sep" aria-hidden="true" />
                <span className="mono">{views} visitas</span>
              </>
            ) : null}
          </div>

          {playlistType && (
            <p className="source-note">
              {entries.length} {entries.length === 1 ? "video" : "videos"} en esta lista.
            </p>
          )}

          {playlistType && (
            <label className="switch-row">
              <span className="switch-copy">
                <span>Descargar la playlist completa</span>
                <small>Desactívalo para descargar solo el primer elemento.</small>
              </span>
              <input
                type="checkbox"
                checked={isPlaylist}
                onChange={(event) => onPlaylistChange(event.target.checked)}
              />
              <span className="switch" aria-hidden="true">
                <span className="switch-knob" />
              </span>
            </label>
          )}
        </div>
      </div>

      {playlistType && entries.length > 0 && (
        <details className="entries">
          <summary>
            Ver los primeros {Math.min(entries.length, 12)} videos
          </summary>
          <ol>
            {entries.slice(0, 12).map((entry, index) => (
              <li key={entry.id || index}>{entry.title || entry.url || "Sin título"}</li>
            ))}
          </ol>
          {entries.length > 12 && (
            <p className="entries-more">y {entries.length - 12} más</p>
          )}
        </details>
      )}
    </article>
  );
}
