use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::Manager;
use tokio::io::AsyncWriteExt;

const STATE_FILE: &str = "state.json";
const STATE_PART: &str = "state.json.part";
const CORRUPT_FILE: &str = "state.corrupt.json";
const STATE_VERSION: u32 = 1;

fn default_version() -> u32 {
    STATE_VERSION
}

/// Documento único de la app. `sections` guarda los datos del frontend
/// (`settings`, `history`) para no atar el formato a una clave concreta.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateFile {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub sections: HashMap<String, Value>,
}

impl Default for StateFile {
    fn default() -> Self {
        Self {
            version: STATE_VERSION,
            sections: HashMap::new(),
        }
    }
}

fn state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("No se pudo obtener la carpeta de datos: {e}"))?;
    Ok(base.join(STATE_FILE))
}

#[tauri::command]
pub async fn load_state(app: tauri::AppHandle) -> Result<StateFile, String> {
    let path = state_path(&app)?;
    match tokio::fs::read(&path).await {
        Ok(bytes) => match serde_json::from_slice::<StateFile>(&bytes) {
            Ok(state) => Ok(state),
            Err(_) => {
                // Un estado corrupto no debe impedir abrir la app: se aparta.
                let corrupt = path.with_file_name(CORRUPT_FILE);
                let _ = tokio::fs::rename(&path, &corrupt).await;
                Ok(StateFile::default())
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(StateFile::default()),
        Err(error) => Err(format!("No se pudo leer el estado: {error}")),
    }
}

#[tauri::command]
pub async fn save_state(app: tauri::AppHandle, state: StateFile) -> Result<(), String> {
    let path = state_path(&app)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("No se pudo crear la carpeta de datos: {e}"))?;
    }

    let data = serde_json::to_vec(&state)
        .map_err(|e| format!("No se pudo serializar el estado: {e}"))?;

    let part = path.with_file_name(STATE_PART);
    let mut file = tokio::fs::File::create(&part)
        .await
        .map_err(|e| format!("No se pudo escribir el estado: {e}"))?;
    file.write_all(&data)
        .await
        .map_err(|e| format!("No se pudo escribir el estado: {e}"))?;
    file.sync_all()
        .await
        .map_err(|e| format!("No se pudo guardar el estado: {e}"))?;
    drop(file);

    tokio::fs::rename(&part, &path)
        .await
        .map_err(|e| format!("No se pudo guardar el estado: {e}"))?;
    Ok(())
}
