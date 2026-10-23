use crate::engine;
use crate::jobs::{cookie_args, hide_console_tokio, taskkill};
use serde::Serialize;
use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{ChildStderr, ChildStdout, Command};

const PROGRESS_PREFIX: &str = "CLIPFETCH_PREVIEW|";
const CACHE_VERSION: &str = "v1";
const MAX_CACHE_DIRS: usize = 3;
const CACHE_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const PROXY_HEIGHT: u32 = 480;
const PROXY_HEIGHT_LONG: u32 = 360;
const LONG_VIDEO_SECONDS: u32 = 2 * 60 * 60;

#[derive(Clone)]
struct ActivePreview {
    request_id: String,
    pid: u32,
}

#[derive(Default)]
pub struct PreviewState {
    active: Arc<Mutex<Option<ActivePreview>>>,
    cancelled: Arc<Mutex<HashSet<String>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFile {
    pub path: String,
    pub kind: String,
    pub cached: bool,
}

fn preview_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("No se pudo obtener la carpeta de datos: {e}"))?;
    Ok(base.join("preview"))
}

/// Hash estable y suficiente para separar la caché de cada enlace y modo.
fn cache_key(url: &str, is_audio: bool) -> String {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    let payload = format!(
        "{CACHE_VERSION}|{}|{url}",
        if is_audio { "audio" } else { "video" }
    );
    for byte in payload.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn media_file(dir: &Path) -> Option<PathBuf> {
    let mut best: Option<(u64, PathBuf)> = None;
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !matches!(
            extension.as_str(),
            "mp4" | "mkv" | "webm" | "m4a" | "opus" | "mp3" | "aac" | "flac" | "wav"
        ) {
            continue;
        }
        let size = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
        if size == 0 {
            continue;
        }
        if best
            .as_ref()
            .map_or(true, |(best_size, _)| size > *best_size)
        {
            best = Some((size, path));
        }
    }
    best.map(|(_, path)| path)
}

fn cleanup_cache(root: &Path, keep: &str) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    let mut dirs: Vec<(PathBuf, SystemTime)> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if path.file_name().and_then(|name| name.to_str()) == Some(keep) {
            continue;
        }
        let modified = entry
            .metadata()
            .ok()
            .and_then(|meta| meta.modified().ok())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        dirs.push((path, modified));
    }

    dirs.sort_by(|first, second| second.1.cmp(&first.1));
    for (index, (path, modified)) in dirs.iter().enumerate() {
        let stale = modified
            .elapsed()
            .map(|age| age > CACHE_MAX_AGE)
            .unwrap_or(false);
        if stale || index >= MAX_CACHE_DIRS.saturating_sub(1) {
            let _ = std::fs::remove_dir_all(path);
        }
    }
}

fn emit_preview(
    app: &AppHandle,
    request_id: &str,
    stage: &str,
    percent: Option<f64>,
    downloaded: Option<u64>,
    total: Option<u64>,
    speed: Option<f64>,
    eta: Option<u64>,
) {
    let _ = app.emit(
        "preview://progress",
        serde_json::json!({
            "requestId": request_id,
            "stage": stage,
            "percent": percent,
            "downloaded": downloaded,
            "total": total,
            "speed": speed,
            "eta": eta,
        }),
    );
}

fn emit_progress(app: &AppHandle, request_id: &str, rest: &str, last_percent: &mut f64) {
    let parts: Vec<&str> = rest.split('|').collect();
    if parts.len() < 5 {
        return;
    }

    let downloaded = parts[0].trim().parse::<u64>().ok();
    let total = parts[1]
        .trim()
        .parse::<u64>()
        .ok()
        .filter(|value| *value > 0)
        .or_else(|| {
            parts[2]
                .trim()
                .parse::<u64>()
                .ok()
                .filter(|value| *value > 0)
        });
    let speed = parts[3].trim().parse::<f64>().ok();
    let eta = parts[4].trim().parse::<u64>().ok();

    let percent = match (downloaded, total) {
        (Some(downloaded), Some(total)) if total > 0 => {
            Some((downloaded as f64 / total as f64 * 100.0).min(100.0))
        }
        _ => None,
    };

    if let Some(value) = percent {
        if value > *last_percent {
            *last_percent = value;
        }
    }
    // El vídeo y el audio se descargan por separado: no se muestra 100 % hasta
    // que yt-dlp termina y el archivo existe de verdad.
    let emitted = percent.map(|_| (*last_percent).min(99.0));

    emit_preview(
        app,
        request_id,
        "downloading",
        emitted,
        downloaded,
        total,
        speed,
        eta,
    );
}

async fn read_stdout(app: AppHandle, request_id: String, stdout: ChildStdout) {
    let mut lines = BufReader::new(stdout).lines();
    let mut last_percent = 0.0_f64;

    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        if let Some(rest) = line.strip_prefix(PROGRESS_PREFIX) {
            emit_progress(&app, &request_id, rest, &mut last_percent);
        } else if line.contains("[Merger]") || line.contains("[ExtractAudio]") {
            emit_preview(
                &app,
                &request_id,
                "processing",
                Some(100.0),
                None,
                None,
                None,
                None,
            );
        }
    }
}

async fn read_stderr(stderr: ChildStderr) -> Vec<String> {
    let mut lines = BufReader::new(stderr).lines();
    let mut tail: VecDeque<String> = VecDeque::with_capacity(80);
    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        if tail.len() == 80 {
            tail.pop_front();
        }
        tail.push_back(line);
    }
    tail.into_iter().collect()
}

fn stderr_tail(lines: &[String], count: usize) -> String {
    lines
        .iter()
        .rev()
        .take(count)
        .rev()
        .cloned()
        .collect::<Vec<_>>()
        .join("\n")
}

fn build_args(
    engine_dir: &Path,
    dir: &Path,
    is_audio: bool,
    height: u32,
    cookies_mode: &str,
    cookies_path: Option<&str>,
    rate_limit: Option<&str>,
) -> Result<Vec<String>, String> {
    let output = dir.join("preview.%(ext)s");
    let mut args = vec![
        "--ignore-config".to_string(),
        "--encoding".to_string(),
        "utf-8".to_string(),
        "--color".to_string(),
        "never".to_string(),
        "--no-warnings".to_string(),
        "--no-playlist".to_string(),
        "--newline".to_string(),
        "--progress".to_string(),
        "--progress-template".to_string(),
        format!(
            "{PROGRESS_PREFIX}%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s"
        ),
        "-o".to_string(),
        output.to_string_lossy().to_string(),
        "--ffmpeg-location".to_string(),
        engine_dir.to_string_lossy().to_string(),
        "--js-runtimes".to_string(),
        format!("deno:{}", engine_dir.to_string_lossy()),
    ];

    if is_audio {
        args.extend([
            "-f".to_string(),
            "ba[ext=m4a]/ba".to_string(),
            "-x".to_string(),
            "--audio-format".to_string(),
            "m4a".to_string(),
            "--audio-quality".to_string(),
            "0".to_string(),
        ]);
    } else {
        let filter = format!(
            "bv*[height<={height}][vcodec^=avc1]+ba[acodec^=mp4a]/bv*[height<={height}]+ba/b[height<={height}]/bv*+ba/b"
        );
        args.extend([
            "-f".to_string(),
            filter,
            "--merge-output-format".to_string(),
            "mp4".to_string(),
            "-S".to_string(),
            "vcodec:h264,acodec:aac".to_string(),
        ]);
    }

    args.extend(cookie_args(cookies_mode, cookies_path)?);

    if let Some(rate) = rate_limit.map(str::trim).filter(|rate| !rate.is_empty()) {
        args.push("--limit-rate".to_string());
        args.push(rate.to_string());
    }

    Ok(args)
}

#[tauri::command]
pub async fn prepare_preview(
    app: AppHandle,
    state: State<'_, PreviewState>,
    url: String,
    mode: Option<String>,
    cookies_mode: String,
    cookies_path: Option<String>,
    rate_limit: Option<String>,
    duration: Option<u32>,
    request_id: String,
    force: Option<bool>,
) -> Result<PreviewFile, String> {
    if url.trim().is_empty() {
        return Err("Falta la URL del vídeo.".to_string());
    }
    if request_id.trim().is_empty() {
        return Err("Falta el identificador de la vista previa.".to_string());
    }

    let active = state.active.clone();
    let cancelled = state.cancelled.clone();
    let is_audio = mode.as_deref() == Some("audio");
    let kind = if is_audio { "audio" } else { "video" };

    // Solo puede haber una preparación en marcha: la nueva sustituye a la anterior.
    if let Some(previous) = active.lock().ok().and_then(|mut guard| guard.take()) {
        taskkill(previous.pid);
    }
    if let Ok(mut set) = cancelled.lock() {
        set.remove(&request_id);
    }

    let root = preview_root(&app)?;
    let key = cache_key(url.trim(), is_audio);
    let dir = root.join(&key);

    if !force.unwrap_or(false) {
        if let Some(file) = media_file(&dir) {
            let fresh = file
                .metadata()
                .ok()
                .and_then(|meta| meta.modified().ok())
                .and_then(|modified| modified.elapsed().ok())
                .map(|age| age <= CACHE_MAX_AGE)
                .unwrap_or(false);
            if fresh {
                cleanup_cache(&root, &key);
                emit_preview(
                    &app,
                    &request_id,
                    "ready",
                    Some(100.0),
                    None,
                    None,
                    None,
                    None,
                );
                return Ok(PreviewFile {
                    path: file.to_string_lossy().to_string(),
                    kind: kind.to_string(),
                    cached: true,
                });
            }
            let _ = tokio::fs::remove_dir_all(&dir).await;
        }
    }

    if force.unwrap_or(false) {
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("No se pudo crear la caché de vista previa: {e}"))?;
    cleanup_cache(&root, &key);

    let engine_dir = engine::engine_dir(&app)?;
    let ytdlp = engine_dir.join("yt-dlp.exe");
    if !ytdlp.exists() {
        return Err(
            "El motor no está instalado. Instálalo desde la pantalla de inicio.".to_string(),
        );
    }

    let height = if duration.unwrap_or(0) > LONG_VIDEO_SECONDS {
        PROXY_HEIGHT_LONG
    } else {
        PROXY_HEIGHT
    };
    let mut args = build_args(
        &engine_dir,
        &dir,
        is_audio,
        height,
        &cookies_mode,
        cookies_path.as_deref(),
        rate_limit.as_deref(),
    )?;
    args.push("--".to_string());
    args.push(url.trim().to_string());

    let mut cmd = Command::new(&ytdlp);
    cmd.args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    hide_console_tokio(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("No se pudo iniciar yt-dlp para la vista previa: {e}"))?;
    let pid = child
        .id()
        .ok_or_else(|| "No se pudo obtener el PID de la vista previa".to_string())?;

    if let Ok(mut guard) = active.lock() {
        *guard = Some(ActivePreview {
            request_id: request_id.clone(),
            pid,
        });
    }

    emit_preview(
        &app,
        &request_id,
        "preparing",
        Some(0.0),
        None,
        None,
        None,
        None,
    );

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let app_stdout = app.clone();
    let request_stdout = request_id.clone();

    let out_task = stdout
        .map(|stdout| tauri::async_runtime::spawn(read_stdout(app_stdout, request_stdout, stdout)));
    let err_task = stderr.map(|stderr| tauri::async_runtime::spawn(read_stderr(stderr)));

    let status = child.wait().await;
    if let Some(task) = out_task {
        let _ = task.await;
    }
    let stderr_lines = match err_task {
        Some(task) => task.await.unwrap_or_default(),
        None => Vec::new(),
    };

    if let Ok(mut guard) = active.lock() {
        if guard
            .as_ref()
            .is_some_and(|active| active.request_id == request_id)
        {
            *guard = None;
        }
    }

    let was_cancelled = cancelled
        .lock()
        .map(|mut set| set.remove(&request_id))
        .unwrap_or(false);

    if was_cancelled {
        let _ = tokio::fs::remove_dir_all(&dir).await;
        return Err("Vista previa cancelada.".to_string());
    }

    match status {
        Ok(status) if status.success() => {
            let Some(file) = media_file(&dir) else {
                let detail = stderr_tail(&stderr_lines, 10);
                return Err(if detail.is_empty() {
                    "yt-dlp terminó pero no dejó un archivo reproducible.".to_string()
                } else {
                    format!("yt-dlp terminó sin un archivo reproducible:\n{detail}")
                });
            };
            cleanup_cache(&root, &key);
            emit_preview(
                &app,
                &request_id,
                "ready",
                Some(100.0),
                None,
                None,
                None,
                None,
            );
            Ok(PreviewFile {
                path: file.to_string_lossy().to_string(),
                kind: kind.to_string(),
                cached: false,
            })
        }
        Ok(status) => {
            let detail = stderr_tail(&stderr_lines, 10);
            Err(if detail.is_empty() {
                format!("yt-dlp terminó con código {status}")
            } else {
                format!("No se pudo preparar la vista previa:\n{detail}")
            })
        }
        Err(error) => Err(format!("La vista previa se cerró inesperadamente: {error}")),
    }
}

#[tauri::command]
pub fn cancel_preview(
    state: State<'_, PreviewState>,
    request_id: Option<String>,
) -> Result<(), String> {
    let mut guard = state
        .active
        .lock()
        .map_err(|_| "No se pudo cancelar la vista previa.".to_string())?;
    let matches = guard.as_ref().is_some_and(|active| {
        request_id
            .as_deref()
            .map_or(true, |request| active.request_id == request)
    });
    let active = if matches { guard.take() } else { None };
    drop(guard);

    if let Some(active) = active {
        if let Ok(mut set) = state.cancelled.lock() {
            set.insert(active.request_id);
        }
        taskkill(active.pid);
    }

    Ok(())
}

pub fn kill_all(state: &PreviewState) {
    let active = state.active.lock().ok().and_then(|mut guard| guard.take());
    if let Some(active) = active {
        taskkill(active.pid);
    }
}
