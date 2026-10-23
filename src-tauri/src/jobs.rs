use crate::engine;
use serde::Deserialize;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{ChildStderr, ChildStdout, Command};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const PROGRESS_TEMPLATE: &str = "download:PROGRESS|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s";

#[derive(Clone, Default)]
pub struct AppState {
    pub children: Arc<Mutex<HashMap<String, u32>>>,
    pub cancelled: Arc<Mutex<HashSet<String>>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub job_id: String,
    pub url: String,
    pub title: Option<String>,
    pub preset: String,
    pub output_dir: String,
    pub is_playlist: bool,
    pub cookies_mode: String,
    pub cookies_path: Option<String>,
    pub rate_limit: Option<String>,
    pub playlist_items: Option<String>,
    pub extra_args: Option<String>,
    pub clip_start: Option<u32>,
    pub clip_end: Option<u32>,
}

fn hide_console_std(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

pub(crate) fn hide_console_tokio(cmd: &mut tokio::process::Command) {
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
}

pub(crate) fn taskkill(pid: u32) {
    let mut cmd = std::process::Command::new("taskkill");
    cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
    hide_console_std(&mut cmd);
    let _ = cmd.output();
}

pub fn kill_all(state: &AppState) {
    let pids: Vec<u32> = state
        .children
        .lock()
        .map(|guard| guard.values().copied().collect())
        .unwrap_or_default();
    for pid in pids {
        taskkill(pid);
    }
}

pub(crate) fn cookie_args(mode: &str, path: Option<&str>) -> Result<Vec<String>, String> {
    match mode {
        "" | "none" => Ok(Vec::new()),
        "firefox" => Ok(vec![
            "--cookies-from-browser".to_string(),
            "firefox".to_string(),
        ]),
        "file" => {
            let path = path
                .filter(|p| !p.trim().is_empty())
                .ok_or_else(|| "Selecciona un archivo cookies.txt".to_string())?;
            if !Path::new(path).exists() {
                return Err(format!("No se encontró el archivo de cookies: {path}"));
            }
            Ok(vec!["--cookies".to_string(), path.to_string()])
        }
        other => Err(format!("Modo de cookies no válido: {other}")),
    }
}

fn video_args(height: Option<u32>) -> Vec<String> {
    let filter = match height {
        Some(height) => format!("bv*[height<={height}]+ba/b[height<={height}]/b"),
        None => "bv*+ba/b".to_string(),
    };
    let mut args = vec![
        "-f".to_string(),
        filter,
        "--merge-output-format".to_string(),
        "mp4".to_string(),
    ];
    // Hasta 1080p se prefiere H.264/AAC para que el MP4 se abra en cualquier sitio.
    if height.map(|value| value <= 1080).unwrap_or(true) {
        args.push("-S".to_string());
        args.push("vcodec:h264,acodec:aac".to_string());
    }
    args
}

fn audio_args(format: &str, quality: Option<&str>) -> Vec<String> {
    let mut args = vec![
        "-f".to_string(),
        "ba/b".to_string(),
        "-x".to_string(),
        "--audio-format".to_string(),
        format.to_string(),
    ];
    if let Some(quality) = quality {
        args.push("--audio-quality".to_string());
        args.push(quality.to_string());
    }
    args
}

fn preset_args(preset: &str) -> Result<Vec<String>, String> {
    let args = match preset {
        "best" => video_args(None),
        "2160" => video_args(Some(2160)),
        "1440" => video_args(Some(1440)),
        "1080" => video_args(Some(1080)),
        "720" => video_args(Some(720)),
        "480" => video_args(Some(480)),
        "360" => video_args(Some(360)),
        "mp3" | "mp3-320" => audio_args("mp3", Some("320K")),
        "mp3-256" => audio_args("mp3", Some("256K")),
        "mp3-192" => audio_args("mp3", Some("192K")),
        "mp3-128" => audio_args("mp3", Some("128K")),
        "m4a-256" => audio_args("m4a", Some("256K")),
        "m4a-128" => audio_args("m4a", Some("128K")),
        "opus-160" => audio_args("opus", Some("160K")),
        "flac" => audio_args("flac", None),
        "wav" => audio_args("wav", None),
        "audio" => vec!["-f".to_string(), "ba/b".to_string()],
        other => return Err(format!("Preset no válido: {other}")),
    };
    Ok(args)
}

fn format_clock(seconds: u32) -> String {
    format!(
        "{:02}:{:02}:{:02}",
        seconds / 3600,
        (seconds % 3600) / 60,
        seconds % 60
    )
}

/// Prefijo del archivo: `00-01-30_00-02-45`.
fn clip_label(start: u32, end: u32) -> String {
    let start = format_clock(start).replace(':', "-");
    let end = format_clock(end).replace(':', "-");
    format!("{start}_{end}")
}

fn clip_range(req: &DownloadRequest) -> Result<Option<(u32, u32)>, String> {
    match (req.clip_start, req.clip_end) {
        (None, None) => Ok(None),
        (Some(start), Some(end)) if end > start => Ok(Some((start, end))),
        _ => Err("El tramo no es válido: el fin debe ser mayor que el inicio.".to_string()),
    }
}

/// Argumentos que la app usa para construir su propio flujo: si el usuario los
/// repite en «argumentos extra» puede romper el parseo o escribir fuera de la
/// carpeta elegida.
const RESERVED_ARGS: &[&str] = &[
    "--exec",
    "--exec-before-download",
    "-o",
    "--output",
    "-P",
    "--paths",
    "--config-location",
    "--config-locations",
    "--download-archive",
    "-a",
    "--batch-file",
    "--load-info-json",
    "--cookies",
    "--cookies-from-browser",
    "--print",
    "--print-to-file",
    "-O",
    "--progress-template",
    "--newline",
    "-J",
    "--dump-json",
    "--dump-single-json",
    "--ffmpeg-location",
    "--js-runtimes",
];

fn reject_reserved_args(extra: &[String]) -> Result<(), String> {
    for arg in extra {
        let flag = arg.split('=').next().unwrap_or(arg.as_str());
        if RESERVED_ARGS.contains(&flag) {
            return Err(format!(
                "El argumento {flag} lo controla ClipFetch y no se puede cambiar desde aquí."
            ));
        }
        if flag.starts_with("--") {
            continue;
        }
        // Formas cortas pegadas al valor: -oRUTA, -Pruta, -aarchivo, -Oplantilla.
        if let Some(short) = ["-o", "-P", "-a", "-O"]
            .into_iter()
            .find(|short| flag.len() > short.len() && flag.starts_with(*short))
        {
            return Err(format!(
                "El argumento {short} lo controla ClipFetch y no se puede cambiar desde aquí."
            ));
        }
    }
    Ok(())
}

fn build_args(dir: &Path, req: &DownloadRequest) -> Result<Vec<String>, String> {
    if req.output_dir.trim().is_empty() {
        return Err("Selecciona una carpeta de descarga".to_string());
    }

    let clip = clip_range(req)?;
    // Con recorte, el vídeo va en su propia carpeta y cada archivo lleva el
    // tramo como prefijo para no chocar con la descarga completa.
    let output_template = match clip {
        Some((start, end)) => format!(
            "%(title)s/{} %(title)s [%(id)s].%(ext)s",
            clip_label(start, end)
        ),
        None => "%(title)s [%(id)s].%(ext)s".to_string(),
    };

    let mut args: Vec<String> = vec![
        "--ignore-config".into(),
        "--encoding".into(),
        "utf-8".into(),
        "--color".into(),
        "never".into(),
        "--newline".into(),
        "--progress".into(),
        "--progress-delta".into(),
        "0.5".into(),
        "--progress-template".into(),
        PROGRESS_TEMPLATE.into(),
        "--print".into(),
        "after_move:FILE|%(filepath)s".into(),
        "--no-simulate".into(),
        "--print".into(),
        "before_dl:PLAN|%(format_id)s".into(),
        "--no-overwrites".into(),
        "--windows-filenames".into(),
        "--trim-filenames".into(),
        "180".into(),
        "-N".into(),
        "4".into(),
        "--ffmpeg-location".into(),
        dir.to_string_lossy().to_string(),
        "--js-runtimes".into(),
        format!("deno:{}", dir.to_string_lossy()),
        "-P".into(),
        req.output_dir.clone(),
        "-o".into(),
        output_template,
    ];

    args.extend(preset_args(&req.preset)?);

    if let Some((start, end)) = clip {
        args.push("--download-sections".into());
        args.push(format!("*{}-{}", format_clock(start), format_clock(end)));
    }

    if req.is_playlist {
        args.push("--yes-playlist".into());
    } else {
        args.push("--no-playlist".into());
    }

    if let Some(items) = req
        .playlist_items
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        args.push("-I".into());
        args.push(items.to_string());
    }

    if let Some(rate) = req
        .rate_limit
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        args.push("-r".into());
        args.push(rate.to_string());
    }

    args.extend(cookie_args(
        &req.cookies_mode,
        req.cookies_path.as_deref(),
    )?);

    if let Some(extra) = req
        .extra_args
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        let extra = shell_words::split(extra)
            .map_err(|e| format!("No se pudieron leer los argumentos extra: {e}"))?;
        reject_reserved_args(&extra)?;
        args.extend(extra);
    }

    args.push("--".into());
    args.push(req.url.trim().to_string());
    Ok(args)
}

async fn run_json(
    app: &AppHandle,
    url: &str,
    cookies_mode: &str,
    cookies_path: Option<&str>,
    flat: bool,
) -> Result<serde_json::Value, String> {
    let dir = engine::engine_dir(app)?;
    let ytdlp = dir.join("yt-dlp.exe");
    if !ytdlp.exists() {
        return Err("El motor no está instalado. Instálalo desde la pantalla de inicio.".to_string());
    }

    let mut cmd = Command::new(&ytdlp);
    cmd.arg("--ignore-config")
        .arg("--encoding")
        .arg("utf-8")
        .arg("--color")
        .arg("never")
        .arg("--no-warnings")
        .arg("-J");
    if flat {
        cmd.arg("--flat-playlist");
    }
    cmd.arg("--ffmpeg-location")
        .arg(&dir)
        .arg("--js-runtimes")
        .arg(format!("deno:{}", dir.to_string_lossy()));
    for arg in cookie_args(cookies_mode, cookies_path)? {
        cmd.arg(arg);
    }
    cmd.arg("--").arg(url.trim());

    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    hide_console_tokio(&mut cmd);

    let output = tokio::time::timeout(Duration::from_secs(300), cmd.output())
        .await
        .map_err(|_| "yt-dlp tardó demasiado en responder. Prueba otra URL o revisa tu conexión.".to_string())?
        .map_err(|e| format!("No se pudo ejecutar yt-dlp: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = stderr
            .lines()
            .filter(|line| !line.trim().is_empty())
            .rev()
            .take(12)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        return Err(if detail.is_empty() {
            format!("yt-dlp no pudo analizar la URL (código {})", output.status)
        } else {
            format!("yt-dlp no pudo analizar la URL:\n{detail}")
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(stdout.trim())
        .map_err(|e| format!("Respuesta inesperada de yt-dlp: {e}"))
}

#[tauri::command]
pub async fn analyze_url(
    app: AppHandle,
    url: String,
    cookies_mode: String,
    cookies_path: Option<String>,
) -> Result<serde_json::Value, String> {
    if url.trim().is_empty() {
        return Err("Pega una URL primero".to_string());
    }

    let value = run_json(&app, &url, &cookies_mode, cookies_path.as_deref(), true).await?;

    let is_playlist = value
        .get("_type")
        .and_then(|v| v.as_str())
        .is_some_and(|t| t == "playlist");

    let has_formats = value
        .get("formats")
        .and_then(|v| v.as_array())
        .is_some_and(|a| !a.is_empty());

    if !is_playlist && !has_formats {
        return run_json(&app, &url, &cookies_mode, cookies_path.as_deref(), false).await;
    }

    Ok(value)
}

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    state: State<'_, AppState>,
    req: DownloadRequest,
) -> Result<String, String> {
    let dir = engine::engine_dir(&app)?;
    let ytdlp = dir.join("yt-dlp.exe");
    if !ytdlp.exists() {
        return Err("El motor no está instalado. Instálalo desde la pantalla de inicio.".to_string());
    }

    tokio::fs::create_dir_all(&req.output_dir)
        .await
        .map_err(|e| format!("No se pudo crear la carpeta de descarga: {e}"))?;

    let args = build_args(&dir, &req)?;
    let mut cmd = Command::new(&ytdlp);
    cmd.args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    hide_console_tokio(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("No se pudo iniciar yt-dlp: {e}"))?;
    let pid = child
        .id()
        .ok_or_else(|| "No se pudo obtener el PID de yt-dlp".to_string())?;

    if let Ok(mut children) = state.children.lock() {
        children.insert(req.job_id.clone(), pid);
    }
    if let Ok(mut cancelled) = state.cancelled.lock() {
        cancelled.remove(&req.job_id);
    }

    let job_id = req.job_id.clone();
    let output_dir = req.output_dir.clone();
    let title = req.title.clone().unwrap_or_default();
    let children = state.children.clone();
    let cancelled = state.cancelled.clone();
    let app_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let out_task = stdout.map(|stdout| {
            tauri::async_runtime::spawn(read_stdout(app_handle.clone(), job_id.clone(), stdout))
        });
        let err_task = stderr.map(|stderr| {
            tauri::async_runtime::spawn(read_stderr(app_handle.clone(), job_id.clone(), stderr))
        });

        let status = child.wait().await;
        let filepath = match out_task {
            Some(task) => task.await.ok().flatten(),
            None => None,
        };
        let stderr_tail = match err_task {
            Some(task) => task.await.unwrap_or_default(),
            None => Vec::new(),
        };

        if let Ok(mut guard) = children.lock() {
            guard.remove(&job_id);
        }

        let was_cancelled = cancelled
            .lock()
            .map(|mut guard| guard.remove(&job_id))
            .unwrap_or(false);

        if was_cancelled {
            let _ = app_handle.emit("job://cancelled", serde_json::json!({ "jobId": job_id }));
            return;
        }

        match status {
            Ok(status) if status.success() => {
                let _ = app_handle.emit(
                    "job://done",
                    serde_json::json!({
                        "jobId": job_id,
                        "filepath": filepath,
                        "outputDir": output_dir,
                        "title": title,
                    }),
                );
            }
            Ok(status) => {
                let detail = if stderr_tail.is_empty() {
                    format!("yt-dlp terminó con código {status}")
                } else {
                    stderr_tail
                        .into_iter()
                        .rev()
                        .take(12)
                        .collect::<Vec<_>>()
                        .into_iter()
                        .rev()
                        .collect::<Vec<_>>()
                        .join("\n")
                };
                let _ = app_handle.emit(
                    "job://error",
                    serde_json::json!({ "jobId": job_id, "message": detail }),
                );
            }
            Err(error) => {
                let _ = app_handle.emit(
                    "job://error",
                    serde_json::json!({ "jobId": job_id, "message": format!("yt-dlp se cerró inesperadamente: {error}") }),
                );
            }
        }
    });

    Ok(req.job_id)
}

#[tauri::command]
pub fn cancel_download(state: State<'_, AppState>, job_id: String) -> Result<(), String> {
    let pid = state
        .children
        .lock()
        .ok()
        .and_then(|guard| guard.get(&job_id).copied());

    if let Ok(mut cancelled) = state.cancelled.lock() {
        cancelled.insert(job_id);
    }

    if let Some(pid) = pid {
        taskkill(pid);
    }
    Ok(())
}

fn emit_progress(app: &AppHandle, job_id: &str, rest: &str) {
    let parts: Vec<&str> = rest.split('|').collect();
    if parts.len() < 6 {
        return;
    }

    let status = parts[0].trim();
    let downloaded = parts[1].trim().parse::<u64>().ok();
    let total = parts[2]
        .trim()
        .parse::<u64>()
        .ok()
        .filter(|value| *value > 0)
        .or_else(|| {
            parts[3]
                .trim()
                .parse::<u64>()
                .ok()
                .filter(|value| *value > 0)
        });
    let speed = parts[4].trim().parse::<f64>().ok();
    let eta = parts[5].trim().parse::<u64>().ok();

    let percent = match (downloaded, total) {
        (Some(downloaded), Some(total)) if total > 0 => {
            Some((downloaded as f64 / total as f64 * 100.0).min(100.0))
        }
        _ => None,
    };

    let _ = app.emit(
        "job://progress",
        serde_json::json!({
            "jobId": job_id,
            "status": status,
            "downloaded": downloaded,
            "total": total,
            "speed": speed,
            "eta": eta,
            "percent": percent,
        }),
    );
}

async fn read_stdout(app: AppHandle, job_id: String, stdout: ChildStdout) -> Option<String> {
    let mut lines = BufReader::new(stdout).lines();
    let mut filepath = None;

    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        if let Some(rest) = line.strip_prefix("PROGRESS|") {
            emit_progress(&app, &job_id, rest);
        } else if let Some(rest) = line.strip_prefix("PLAN|") {
            let format_id = rest.trim();
            let files = format_id
                .split('+')
                .filter(|part| !part.trim().is_empty())
                .count()
                .max(1);
            let _ = app.emit(
                "job://plan",
                serde_json::json!({ "jobId": job_id, "files": files, "formatId": format_id }),
            );
        } else if let Some(path) = line.strip_prefix("FILE|") {
            let path = path.trim().to_string();
            filepath = Some(path.clone());
            let _ = app.emit(
                "job://log",
                serde_json::json!({ "jobId": job_id, "line": format!("Guardado: {path}") }),
            );
        } else {
            let _ = app.emit(
                "job://log",
                serde_json::json!({ "jobId": job_id, "line": line }),
            );
        }
    }

    filepath
}

async fn read_stderr(app: AppHandle, job_id: String, stderr: ChildStderr) -> Vec<String> {
    let mut lines = BufReader::new(stderr).lines();
    let mut tail: VecDeque<String> = VecDeque::with_capacity(60);

    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }
        let _ = app.emit(
            "job://log",
            serde_json::json!({ "jobId": job_id, "line": line }),
        );
        if tail.len() >= 60 {
            tail.pop_front();
        }
        tail.push_back(line);
    }

    tail.into_iter().collect()
}

/// Formato único con audio y vídeo para poder reproducirlo en el `<video>`.
const PREVIEW_FORMAT: &str =
    "best[ext=mp4][vcodec!=none][acodec!=none]/best[acodec!=none][vcodec!=none]";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewStream {
    pub url: String,
}

/// Devuelve una URL directa y efímera para ver el vídeo sin descargarlo.
/// No es el archivo final: sirve para situarse en la línea de tiempo.
#[tauri::command]
pub async fn preview_stream(
    app: AppHandle,
    url: String,
    mode: Option<String>,
    cookies_mode: String,
    cookies_path: Option<String>,
) -> Result<PreviewStream, String> {
    if url.trim().is_empty() {
        return Err("Falta la URL del vídeo.".to_string());
    }

    let is_audio = mode.as_deref() == Some("audio");
    let format = if is_audio {
        "ba[ext=m4a]/ba"
    } else {
        PREVIEW_FORMAT
    };

    let dir = engine::engine_dir(&app)?;
    let ytdlp = dir.join("yt-dlp.exe");
    if !ytdlp.exists() {
        return Err("El motor no está instalado. Instálalo desde la pantalla de inicio.".to_string());
    }

    let mut cmd = Command::new(&ytdlp);
    cmd.arg("--ignore-config")
        .arg("--encoding")
        .arg("utf-8")
        .arg("--color")
        .arg("never")
        .arg("--no-warnings")
        .arg("--no-playlist")
        .arg("-g")
        .arg("-f")
        .arg(format)
        .arg("--ffmpeg-location")
        .arg(&dir)
        .arg("--js-runtimes")
        .arg(format!("deno:{}", dir.to_string_lossy()));
    for arg in cookie_args(&cookies_mode, cookies_path.as_deref())? {
        cmd.arg(arg);
    }
    cmd.arg("--")
        .arg(url.trim())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    hide_console_tokio(&mut cmd);

    let output = tokio::time::timeout(Duration::from_secs(60), cmd.output())
        .await
        .map_err(|_| "yt-dlp tardó demasiado en preparar la vista previa.".to_string())?
        .map_err(|e| format!("No se pudo ejecutar yt-dlp: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = stderr
            .lines()
            .filter(|line| !line.trim().is_empty())
            .rev()
            .take(8)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        return Err(if detail.is_empty() {
            "No se pudo preparar la vista previa.".to_string()
        } else {
            format!("No se pudo preparar la vista previa:\n{detail}")
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let link = stdout
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with("http"))
        .ok_or_else(|| "yt-dlp no devolvió una URL reproducible.".to_string())?;

    if link.contains(".m3u8") {
        return Err(
            "Este sitio solo ofrece HLS; la vista previa no está disponible aquí.".to_string(),
        );
    }

    Ok(PreviewStream {
        url: link.to_string(),
    })
}
