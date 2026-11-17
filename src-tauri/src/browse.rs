use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: u64,
}

/// Lista una carpeta sin recursión. El filtro de extensiones se hace en el
/// frontend con LOCAL_EXTENSIONS para que la lista viva en un solo sitio.
#[tauri::command]
pub fn list_media_dir(path: String) -> Result<Vec<MediaEntry>, String> {
    let root = PathBuf::from(path.trim());
    if !root.is_dir() {
        return Err("La carpeta no existe o no es accesible.".to_string());
    }

    let entries = std::fs::read_dir(&root)
        .map_err(|e| format!("No se pudo leer la carpeta: {e}"))?;
    let mut list = Vec::new();

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let entry_path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let is_dir = metadata.is_dir();
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0);

        list.push(MediaEntry {
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_dir,
            size: if is_dir { 0 } else { metadata.len() },
            modified,
        });
    }

    list.sort_by(|first, second| {
        second
            .is_dir
            .cmp(&first.is_dir)
            .then_with(|| first.name.to_lowercase().cmp(&second.name.to_lowercase()))
    });

    Ok(list)
}

/// Devuelve la carpeta padre de una ruta, o la misma ruta si ya es la raíz.
#[tauri::command]
pub fn parent_media_dir(path: String) -> Option<String> {
    let current = Path::new(path.trim());
    current
        .parent()
        .map(|parent| parent.to_string_lossy().to_string())
}
