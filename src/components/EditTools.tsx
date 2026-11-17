import type { EditorTool } from "./TimelineEditor";
import { Icon } from "./Icon";

interface EditToolsProps {
  tool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
  snap: boolean;
  onToggleSnap: () => void;
}

export function EditTools({ tool, onToolChange, snap, onToggleSnap }: EditToolsProps) {
  return (
    <div className="edit-tools" role="toolbar" aria-label="Herramientas de edición">
      <button
        type="button"
        className={`edit-tool${tool === "select" ? " is-active" : ""}`}
        aria-pressed={tool === "select"}
        title="Seleccionar (V)"
        onClick={() => onToolChange("select")}
      >
        <Icon name="cursor" size={16} />
      </button>
      <button
        type="button"
        className={`edit-tool${tool === "cut" ? " is-active" : ""}`}
        aria-pressed={tool === "cut"}
        title="Cortar en la aguja (C). Clic en un tramo para dividirlo."
        onClick={() => onToolChange("cut")}
      >
        <Icon name="cut" size={16} />
      </button>
      <button
        type="button"
        className={`edit-tool${snap ? " is-active" : ""}`}
        aria-pressed={snap}
        title="Imán (S)"
        onClick={onToggleSnap}
      >
        <Icon name="magnet" size={16} />
      </button>
      <button
        type="button"
        className={`edit-tool${tool === "hand" ? " is-active" : ""}`}
        aria-pressed={tool === "hand"}
        title="Mover la vista (H)"
        onClick={() => onToolChange("hand")}
      >
        <Icon name="hand" size={16} />
      </button>
      <button
        type="button"
        className={`edit-tool${tool === "zoom" ? " is-active" : ""}`}
        aria-pressed={tool === "zoom"}
        title="Zoom (Z). Clic acerca; Alt+clic aleja."
        onClick={() => onToolChange("zoom")}
      >
        <Icon name="zoom" size={16} />
      </button>
    </div>
  );
}
