import { invoke } from "@tauri-apps/api/core";

/**
 * Persistencia de la app.
 *
 * Desde la versión con `state.json` los datos viven en
 * `%LOCALAPPDATA%\app.clipfetch.desktop\state.json` (comandos `load_state` y
 * `save_state`). Si esos comandos no están disponibles (por ejemplo al abrir
 * solo el frontend), se usa `localStorage` como respaldo.
 */

export type Section = "settings" | "history";

const SECTIONS: Section[] = ["settings", "history"];

const LOCAL_KEYS: Record<Section, string> = {
  settings: "clipfetch.settings",
  history: "clipfetch.history",
};

/** Clave de la 0.1.0: se lee una vez para no perder los ajustes. */
const LEGACY_KEYS: Partial<Record<Section, string>> = {
  settings: "clipfetch.settings.v1",
};

export interface StorageBackend {
  load(): Promise<Record<string, unknown> | null>;
  save(document: Record<string, unknown>): Promise<void>;
}

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Cuota llena o almacenamiento bloqueado.
  }
}

const localBackend: StorageBackend = {
  async load() {
    const document: Record<string, unknown> = {};
    let found = false;

    for (const section of SECTIONS) {
      const legacyKey = LEGACY_KEYS[section];
      const raw =
        readLocal(LOCAL_KEYS[section]) ?? (legacyKey ? readLocal(legacyKey) : null);
      if (raw === null) continue;
      try {
        document[section] = JSON.parse(raw);
        found = true;
      } catch {
        // Dato corrupto: se ignora esa sección.
      }
    }

    return found ? document : null;
  },

  async save(document) {
    for (const section of SECTIONS) {
      if (!(section in document)) continue;
      writeLocal(LOCAL_KEYS[section], JSON.stringify(document[section]));
    }
  },
};

interface RustStateFile {
  version?: number;
  sections?: Record<string, unknown> | null;
}

let fileDocument: Record<string, unknown> | null = null;

const tauriBackend: StorageBackend = {
  async load() {
    return fileDocument;
  },
  async save(document) {
    fileDocument = document;
    await invoke("save_state", {
      state: { version: 1, sections: document },
    });
  },
};

let backend: StorageBackend = localBackend;

/**
 * Intenta guardar en el fichero de Rust. Devuelve el origen elegido para poder
 * registrarlo en el arranque.
 */
export async function useFileStorage(): Promise<"rust" | "local"> {
  try {
    const state = await invoke<RustStateFile>("load_state");
    fileDocument = state?.sections ?? {};
    backend = tauriBackend;
    return "rust";
  } catch {
    backend = localBackend;
    return "local";
  }
}

export function setStorageBackend(next: StorageBackend): void {
  backend = next;
}

interface Envelope {
  version: number;
  value: unknown;
}

/** Acepta tanto `{ version, value }` como datos heredados sin envoltorio. */
function decode<T>(
  raw: unknown,
  migrate: (value: unknown, fromVersion: number) => T | null,
): T | null {
  let value = raw;
  let version = 0;

  if (
    raw !== null &&
    typeof raw === "object" &&
    typeof (raw as Partial<Envelope>).version === "number"
  ) {
    const envelope = raw as Envelope;
    version = envelope.version;
    value = envelope.value;
  }

  try {
    return migrate(value, version);
  } catch {
    return null;
  }
}

export async function loadSection<T>(
  section: Section,
  migrate: (value: unknown, fromVersion: number) => T | null,
): Promise<T | null> {
  const document = await backend.load();
  if (!document || !(section in document)) return null;
  return decode(document[section], migrate);
}

/** Las escrituras se encadenan para que dos secciones no se pisen. */
let writeQueue: Promise<void> = Promise.resolve();

export async function saveSection(
  section: Section,
  version: number,
  value: unknown,
): Promise<void> {
  const document = (await backend.load()) ?? {};
  document[section] = { version, value } satisfies Envelope;
  const snapshot = { ...document };

  writeQueue = writeQueue.then(
    () => backend.save(snapshot),
    () => backend.save(snapshot),
  );

  try {
    await writeQueue;
  } catch {
    // Guardar es best-effort: la app sigue funcionando en memoria.
  }
}
