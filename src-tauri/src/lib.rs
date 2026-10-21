mod engine;
mod jobs;

use tauri::Manager;

#[tauri::command]
fn default_download_dir(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .download_dir()
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|e| format!("No se pudo obtener la carpeta de descargas: {e}"))
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("La carpeta está vacía".to_string());
    }
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("No se pudo abrir la carpeta: {e}"))
}

#[tauri::command]
fn reveal_file(path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("La ruta está vacía".to_string());
    }
    std::process::Command::new("explorer")
        .arg(format!("/select,{path}"))
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("No se pudo abrir la carpeta: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(jobs::AppState::default())
        .invoke_handler(tauri::generate_handler![
            engine::engine_status,
            engine::install_engine,
            engine::update_ytdlp,
            jobs::analyze_url,
            jobs::start_download,
            jobs::cancel_download,
            default_download_dir,
            open_folder,
            reveal_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<jobs::AppState>() {
                    jobs::kill_all(state.inner());
                }
            }
        });
}
