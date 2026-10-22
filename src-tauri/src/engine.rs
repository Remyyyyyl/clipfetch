use futures_util::StreamExt;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

pub const YTDLP_URL: &str =
    "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp.exe";
pub const FFMPEG_URL: &str =
    "https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip";
pub const DENO_URL: &str =
    "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip";

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub installed: bool,
    pub dir: String,
    pub ytdlp_version: String,
    pub ffmpeg_version: String,
    pub deno_version: String,
    pub missing: Vec<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineProgress {
    stage: String,
    downloaded: u64,
    total: Option<u64>,
    percent: Option<f64>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineUpdate {
    pub current: String,
    pub latest: String,
    pub update_available: bool,
}

pub fn engine_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("No se pudo obtener la carpeta de datos: {e}"))?;
    Ok(base.join("engine"))
}

fn hide_console_std(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

fn hide_console_tokio(cmd: &mut tokio::process::Command) {
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
}

fn version_of(bin: &Path, args: &[&str]) -> Option<String> {
    if !bin.exists() {
        return None;
    }
    let mut cmd = std::process::Command::new(bin);
    cmd.args(args);
    hide_console_std(&mut cmd);
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let first = text.lines().next()?.trim();
    if first.is_empty() {
        None
    } else {
        Some(first.to_string())
    }
}

pub fn status(app: &AppHandle) -> EngineStatus {
    let dir = engine_dir(app).unwrap_or_default();
    let ytdlp = dir.join("yt-dlp.exe");
    let ffmpeg = dir.join("ffmpeg.exe");
    let ffprobe = dir.join("ffprobe.exe");
    let deno = dir.join("deno.exe");

    let mut missing = Vec::new();
    if !ytdlp.exists() {
        missing.push("yt-dlp".to_string());
    }
    if !ffmpeg.exists() || !ffprobe.exists() {
        missing.push("ffmpeg".to_string());
    }
    if !deno.exists() {
        missing.push("deno".to_string());
    }

    EngineStatus {
        installed: missing.is_empty(),
        dir: dir.to_string_lossy().to_string(),
        ytdlp_version: version_of(&ytdlp, &["--version"]).unwrap_or_default(),
        ffmpeg_version: version_of(&ffmpeg, &["-version"]).unwrap_or_default(),
        deno_version: version_of(&deno, &["--version"]).unwrap_or_default(),
        missing,
    }
}

fn emit_progress(
    app: &AppHandle,
    stage: &str,
    downloaded: u64,
    total: Option<u64>,
) {
    let percent = total
        .filter(|t| *t > 0)
        .map(|t| (downloaded as f64 / t as f64 * 100.0).min(100.0));
    let _ = app.emit(
        "engine://progress",
        EngineProgress {
            stage: stage.to_string(),
            downloaded,
            total,
            percent,
        },
    );
}

async fn download(
    app: &AppHandle,
    stage: &str,
    url: &str,
    dest: &Path,
) -> Result<(), String> {
    let part = dest.with_extension("part");
    let client = reqwest::Client::builder()
        .user_agent(format!("ClipFetch/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("No se pudo crear el cliente HTTP: {e}"))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("No se pudo descargar {stage}: {e}"))?
        .error_for_status()
        .map_err(|e| format!("GitHub respondió con error al descargar {stage}: {e}"))?;

    let total = response.content_length();
    let mut file = tokio::fs::File::create(&part)
        .await
        .map_err(|e| format!("No se pudo crear {}: {e}", part.display()))?;
    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();

    emit_progress(app, stage, 0, total);

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Descarga interrumpida ({stage}): {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("No se pudo escribir {stage}: {e}"))?;
        downloaded += chunk.len() as u64;

        if last_emit.elapsed().as_millis() >= 200 {
            emit_progress(app, stage, downloaded, total);
            last_emit = Instant::now();
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("No se pudo guardar {stage}: {e}"))?;
    drop(file);

    tokio::fs::rename(&part, dest)
        .await
        .map_err(|e| format!("No se pudo finalizar {stage}: {e}"))?;

    emit_progress(app, stage, downloaded, Some(downloaded));
    Ok(())
}

async fn extract_zip(zip: &Path, dest: &Path) -> Result<(), String> {
    tokio::fs::create_dir_all(dest)
        .await
        .map_err(|e| format!("No se pudo crear {}: {e}", dest.display()))?;

    let system_tar = Path::new(r"C:\Windows\System32\tar.exe");
    let program = if system_tar.exists() {
        system_tar
    } else {
        Path::new("tar")
    };
    let mut cmd = tokio::process::Command::new(program);
    cmd.arg("-xf")
        .arg(zip)
        .arg("-C")
        .arg(dest);
    hide_console_tokio(&mut cmd);

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("No se pudo extraer {}: {e}", zip.display()))?;

    if !output.status.success() {
        return Err(format!(
            "No se pudo extraer {}: {}",
            zip.display(),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}

fn find_file(root: &Path, name: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_file(&path, name) {
                return Some(found);
            }
        } else if path
            .file_name()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.eq_ignore_ascii_case(name))
        {
            return Some(path);
        }
    }
    None
}

async fn has_file(path: &Path) -> bool {
    tokio::fs::metadata(path)
        .await
        .map(|m| m.len() > 1_000_000)
        .unwrap_or(false)
}

#[tauri::command]
pub fn engine_status(app: AppHandle) -> EngineStatus {
    status(&app)
}

#[tauri::command]
pub async fn install_engine(app: AppHandle) -> Result<EngineStatus, String> {
    let dir = engine_dir(&app)?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("No se pudo crear la carpeta del motor: {e}"))?;

    if !has_file(&dir.join("yt-dlp.exe")).await {
        download(&app, "yt-dlp", YTDLP_URL, &dir.join("yt-dlp.exe")).await?;
    }

    if !has_file(&dir.join("ffmpeg.exe")).await || !has_file(&dir.join("ffprobe.exe")).await {
        let zip = dir.join("ffmpeg.zip");
        let tmp = dir.join("ffmpeg-tmp");
        download(&app, "ffmpeg", FFMPEG_URL, &zip).await?;
        let _ = tokio::fs::remove_dir_all(&tmp).await;
        extract_zip(&zip, &tmp).await?;
        for name in ["ffmpeg.exe", "ffprobe.exe"] {
            let src = find_file(&tmp, name)
                .ok_or_else(|| format!("No se encontró {name} en el paquete de ffmpeg"))?;
            tokio::fs::copy(&src, dir.join(name))
                .await
                .map_err(|e| format!("No se pudo instalar {name}: {e}"))?;
        }
        let _ = tokio::fs::remove_dir_all(&tmp).await;
        let _ = tokio::fs::remove_file(&zip).await;
    }

    if !has_file(&dir.join("deno.exe")).await {
        let zip = dir.join("deno.zip");
        let tmp = dir.join("deno-tmp");
        download(&app, "deno", DENO_URL, &zip).await?;
        let _ = tokio::fs::remove_dir_all(&tmp).await;
        extract_zip(&zip, &tmp).await?;
        let src = find_file(&tmp, "deno.exe")
            .ok_or_else(|| "No se encontró deno.exe en el paquete de Deno".to_string())?;
        tokio::fs::copy(&src, dir.join("deno.exe"))
            .await
            .map_err(|e| format!("No se pudo instalar deno.exe: {e}"))?;
        let _ = tokio::fs::remove_dir_all(&tmp).await;
        let _ = tokio::fs::remove_file(&zip).await;
    }

    Ok(status(&app))
}

#[tauri::command]
pub async fn update_ytdlp(app: AppHandle) -> Result<EngineStatus, String> {
    let dir = engine_dir(&app)?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("No se pudo crear la carpeta del motor: {e}"))?;
    download(&app, "yt-dlp", YTDLP_URL, &dir.join("yt-dlp.exe")).await?;
    Ok(status(&app))
}

fn version_key(value: &str) -> Vec<u64> {
    value
        .split('.')
        .map(|part| part.trim().parse::<u64>().unwrap_or(0))
        .collect()
}

fn is_newer(latest: &str, current: &str) -> bool {
    let mut remote = version_key(latest);
    let mut local = version_key(current);
    let length = remote.len().max(local.len());
    remote.resize(length, 0);
    local.resize(length, 0);
    remote > local
}

/// Lee la versión de la última nightly sin descargarla: GitHub redirige
/// `/releases/latest/download/...` a `/releases/download/<tag>/...`.
async fn latest_ytdlp_version() -> Result<String, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(format!("ClipFetch/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("No se pudo crear el cliente HTTP: {e}"))?;

    let response = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        client.head(YTDLP_URL).send(),
    )
    .await
    .map_err(|_| "GitHub tardó demasiado en responder".to_string())?
    .map_err(|e| format!("No se pudo consultar la última versión de yt-dlp: {e}"))?;

    let location = response
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "GitHub no devolvió la ubicación de la última versión".to_string())?;

    location
        .trim_end_matches('/')
        .rsplit('/')
        .nth(1)
        .filter(|tag| !tag.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "No se pudo leer la versión desde la redirección de GitHub".to_string())
}

#[tauri::command]
pub async fn check_engine_update(app: AppHandle) -> Result<Option<EngineUpdate>, String> {
    let dir = engine_dir(&app)?;
    let Some(current) = version_of(&dir.join("yt-dlp.exe"), &["--version"]) else {
        return Ok(None);
    };

    let latest = latest_ytdlp_version().await?;
    Ok(Some(EngineUpdate {
        update_available: is_newer(&latest, &current),
        current,
        latest,
    }))
}
