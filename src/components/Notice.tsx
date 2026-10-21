import type { ReactNode } from "react";
import { Icon } from "./Icon";

interface NoticeProps {
  kind?: "error" | "info";
  title?: string;
  children: ReactNode;
  onClose?: () => void;
}

export function Notice({ kind = "error", title, children, onClose }: NoticeProps) {
  return (
    <div className={`notice ${kind}`} role={kind === "error" ? "alert" : "status"}>
      <Icon name={kind === "error" ? "alert" : "info"} size={16} />
      <div className="notice-copy">
        {title && <strong>{title}</strong>}
        <p>{children}</p>
      </div>
      {onClose && (
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Cerrar aviso"
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}
