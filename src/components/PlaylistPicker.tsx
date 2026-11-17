import { useState } from "react";
import type { YtDlpInfo } from "../types";
import { formatDuration } from "../lib/format";
import { MAX_LISTED_ENTRIES, entryPosition } from "../lib/playlist";

interface PlaylistPickerProps {
  info: YtDlpInfo;
  selection: Set<number>;
  positions: number[];
  onToggleItem: (position: number) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onSelectRange: (from: number, to: number) => void;
}

export function PlaylistPicker({
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
          Se muestran los primeros {MAX_LISTED_ENTRIES}. Para el resto, añade un
          rango (por ejemplo {MAX_LISTED_ENTRIES + 1}-{lastPosition}).
        </p>
      )}
    </div>
  );
}
