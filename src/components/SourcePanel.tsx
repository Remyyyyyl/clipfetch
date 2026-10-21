import { useState } from "react";
import type { YtDlpInfo } from "../types";
import { formatCount, formatDuration } from "../lib/format";
import { MAX_LISTED_ENTRIES, entryPosition } from "../lib/playlist";
import { Icon } from "./Icon";

interface SourcePanelProps {
  info: YtDlpInfo;
  thumbnail?: string;
  isPlaylist: boolean;
  onPlaylistChange: (value: boolean) => void;
  selectedItems: Set<number>;
  onToggleItem: (position: number) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onSelectRange: (from: number, to: number) => void;
}

export function SourcePanel({
  info,
  thumbnail,
  isPlaylist,
  onPlaylistChange,
  selectedItems,
  onToggleItem,
  onSelectAll,
  onSelectNone,
  onSelectRange,
}: SourcePanelProps) {
  const playlistType = info._type === "playlist";
  const entries = info.entries ?? [];
  const title = info.title || info.id || "Sin título";
  const uploader = info.uploader || info.channel;
  const views = formatCount(info.view_count);
  const [rangeFrom, setRangeFrom] = useState("1");
  const [rangeTo, setRangeTo] = useState("");
  const lastPosition = entries.length
    ? entryPosition(entries[entries.length - 1], entries.length - 1)
    : 0;

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
                <small>Desactívalo para descargar solo el vídeo enlazado.</small>
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

      {playlistType && entries.length > 0 && isPlaylist && (
        <div className="entries entries-select">
          <div className="entries-head">
            <span className="entries-count mono">
              {selectedItems.size} de {entries.length} seleccionados
            </span>
            <div className="entries-actions">
              <button type="button" className="button tiny" onClick={onSelectAll}>
                Todos
              </button>
              <button
                type="button"
                className="button tiny"
                onClick={onSelectNone}
                disabled={selectedItems.size === 0}
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
                      checked={selectedItems.has(position)}
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
      )}

      {playlistType && entries.length > 0 && !isPlaylist && (
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
