export type IconName =
  | "reel"
  | "play"
  | "pause"
  | "cut"
  | "music"
  | "grip"
  | "export"
  | "trash"
  | "download"
  | "folder"
  | "settings"
  | "refresh"
  | "close"
  | "alert"
  | "info"
  | "check"
  | "chevron"
  | "external"
  | "film"
  | "magnet"
  | "volume"
  | "volume-off";

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function Icon({ name, size = 16, strokeWidth = 1.7, className }: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className,
  };

  switch (name) {
    case "reel":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="3.4" />
          <circle cx="12" cy="5.9" r="2" />
          <circle cx="17.3" cy="15.2" r="2" />
          <circle cx="6.7" cy="15.2" r="2" />
        </svg>
      );
    case "play":
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M8.2 5.4v13.2L19 12 8.2 5.4Z" />
        </svg>
      );
    case "pause":
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <rect x="7" y="5" width="3.6" height="14" rx="0.6" />
          <rect x="13.4" y="5" width="3.6" height="14" rx="0.6" />
        </svg>
      );
    case "cut":
      return (
        <svg {...common}>
          <circle cx="6" cy="6.5" r="2.4" />
          <circle cx="6" cy="17.5" r="2.4" />
          <path d="M8.1 8 20 17.5" />
          <path d="M8.1 16 20 6.5" />
        </svg>
      );
    case "music":
      return (
        <svg {...common}>
          <path d="M9 18V6l10-2v12" />
          <circle cx="6.5" cy="18" r="2.5" />
          <circle cx="16.5" cy="16" r="2.5" />
        </svg>
      );
    case "grip":
      return (
        <svg {...common} strokeWidth={2.6}>
          <path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01" />
        </svg>
      );
    case "export":
      return (
        <svg {...common}>
          <path d="M12 16V4" />
          <path d="m7 9 5-5 5 5" />
          <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
        </svg>
      );
    case "trash":
      return (
        <svg {...common}>
          <path d="M4 7h16" />
          <path d="M9 7V5h6v2" />
          <path d="m6.5 7 1 13h9l1-13" />
        </svg>
      );
    case "download":
      return (
        <svg {...common}>
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M4 20h16" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-10Z" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path d="M4 7h16M4 12h16M4 17h16" />
          <circle cx="9" cy="7" r="2" />
          <circle cx="15" cy="12" r="2" />
          <circle cx="7" cy="17" r="2" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...common}>
          <path d="M20 11a8 8 0 0 0-14.9-4" />
          <path d="M4 5v5h5" />
          <path d="M4 13a8 8 0 0 0 14.9 4" />
          <path d="M20 19v-5h-5" />
        </svg>
      );
    case "close":
      return (
        <svg {...common}>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      );
    case "alert":
      return (
        <svg {...common}>
          <path d="M12 3.5 21 19H3L12 3.5Z" />
          <path d="M12 9v4" />
          <path d="M12 16.5h.01" />
        </svg>
      );
    case "info":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5" />
          <path d="M12 8h.01" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="m5 12 4.5 4.5L19 7" />
        </svg>
      );
    case "chevron":
      return (
        <svg {...common}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case "external":
      return (
        <svg {...common}>
          <path d="M14 4h6v6" />
          <path d="m20 4-8 8" />
          <path d="M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
        </svg>
      );
    case "film":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="1" />
          <path d="M7 5v14M17 5v14" />
          <path d="M7 8h.01M7 12h.01M7 16h.01M17 8h.01M17 12h.01M17 16h.01" />
        </svg>
      );
    case "magnet":
      return (
        <svg {...common}>
          <path d="M6 4H3v8a9 9 0 0 0 18 0V4h-3v8a6 6 0 0 1-12 0V4Z" />
          <path d="M3 8h3M18 8h3" />
        </svg>
      );
    case "volume":
      return (
        <svg {...common}>
          <path d="M11 5 6 9H3v6h3l5 4V5Z" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 5.5a9 9 0 0 1 0 13" />
        </svg>
      );
    case "volume-off":
      return (
        <svg {...common}>
          <path d="M11 5 6 9H3v6h3l5 4V5Z" />
          <path d="m16 9 5 6M21 9l-5 6" />
        </svg>
      );
  }
}
