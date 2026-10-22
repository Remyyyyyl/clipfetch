import type { EngineStatus as EngineStatusType, EngineUpdate, ToolKind } from "../types";
import { EngineStatus } from "./EngineStatus";
import { Icon } from "./Icon";

interface TopBarProps {
  tool: ToolKind;
  onToolChange: (tool: ToolKind) => void;
  engine: EngineStatusType;
  engineBusy: boolean;
  enginePercent: number | null;
  engineStage: string;
  engineUpdate: EngineUpdate | null;
  onUpdateEngine: () => void;
  onOpenSettings: () => void;
}

export function TopBar({
  tool,
  onToolChange,
  engine,
  engineBusy,
  enginePercent,
  engineStage,
  engineUpdate,
  onUpdateEngine,
  onOpenSettings,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">
          <Icon name="reel" size={24} />
        </span>
        <span className="brand-name">ClipFetch</span>
      </div>

      <nav className="tool-keys" role="tablist" aria-label="Herramientas">
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
      </nav>

      <div className="topbar-tools">
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
            className="button ghost topbar-settings"
            onClick={onOpenSettings}
            aria-label="Ajustes"
          >
            <Icon name="settings" size={16} />
            <span className="button-label">Ajustes</span>
          </button>
        )}
      </div>
    </header>
  );
}
