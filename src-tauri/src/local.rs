use crate::compat::{self, EditorProfile};
use crate::engine;
use crate::jobs::{clip_label, format_clock, hide_console_tokio, taskkill, AppState};
use serde::{Deserialize, Serialize};
use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{ChildStderr, ChildStdout, Command};

const CACHE_VERSION: &str = "v1";
const MAX_CACHE_DIRS: usize = 6;
const CACHE_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const PROBE_TIMEOUT: Duration = Duration::from_secs(45);
const THUMB_TIMEOUT: Duration = Duration::from_secs(30);
const PREVIEW_MAX_HEIGHT: u32 = 720;
const PREVIEW_MAX_HEIGHT_LONG: u32 = 480;
const LONG_VIDEO_SECONDS: f64 = 2.0 * 60.0 * 60.0;
/// Por encima de este tamaño no se duplica el archivo entero: se genera un proxy.
const MAX_REMUX_BYTES: u64 = 4 * 1024 * 1024 * 1024;

const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "m4v", "mkv", "webm", "mov", "avi", "flv", "wmv", "ts", "m2ts", "mts", "mpg", "mpeg",
    "3gp", "ogv",
];
const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus", "wma", "aiff", "aif", "alac", "ac3",
    "eac3", "dts",
];
const DIRECT_VIDEO_EXTENSIONS: &[&str] = &["mp4", "m4v", "mov", "webm"];
const DIRECT_VIDEO_CODECS: &[&str] = &["h264", "hevc", "vp8", "vp9", "av1"];
const DIRECT_AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus",
];
const MP4_VIDEO_CODECS: &[&str] = &["h264", "hevc", "av1", "mpeg4"];
const MP4_AUDIO_CODECS: &[&str] = &["aac", "mp3", "ac3", "eac3", "alac"];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMedia {
    pub path: String,
    pub title: String,
    pub duration: Option<f64>,
    pub size: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub container: String,
    pub has_video: bool,
    pub has_audio: bool,
    pub thumbnail: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPreviewFile {
    pub path: String,
    pub kind: String,
    pub cached: bool,
}

#[derive(Clone)]
struct ActivePreview {
    request_id: String,
    pid: u32,
}

#[derive(Default)]
pub struct LocalPreviewState {
    active: Arc<Mutex<Option<ActivePreview>>>,
    cancelled: Arc<Mutex<HashSet<String>>>,
}

#[derive(Debug, Clone)]
struct Probe {
    duration: f64,
    size: u64,
    width: Option<u32>,
    height: Option<u32>,
    video_codec: Option<String>,
    audio_codec: Option<String>,
    pix_fmt: Option<String>,
    color_transfer: Option<String>,
    has_video: bool,
    has_audio: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCutRequest {
    pub job_id: String,
    pub input_path: String,
    pub title: String,
    pub kind: String,
    pub output_dir: String,
    pub clip_start: f64,
    pub clip_end: f64,
    #[serde(default)]
    pub precise: bool,
    /// Perfil de la copia para editores.
    #[serde(default)]
    pub editor_profile: Option<String>,
    /// Se acepta por compatibilidad; en cortes locales el original nunca se borra.
    #[serde(default = "default_true")]
    pub keep_master: bool,
    /// Campo antiguo de la 1.3.
    #[serde(default = "default_true")]
    pub editor_ready: bool,
}

fn default_true() -> bool {
    true
}

fn ffmpeg_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let dir = engine::engine_dir(app)?;
    let ffmpeg = dir.join("ffmpeg.exe");
    let ffprobe = dir.join("ffprobe.exe");
    if !ffmpeg.exists() || !ffprobe.exists() {
        return Err(
            "Falta FFmpeg. Instala el motor desde la pantalla de inicio para editar archivos locales."
                .to_string(),
        );
    }
    Ok((ffmpeg, ffprobe))
}

fn lower_extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn title_of(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Clip")
        .to_string()
}

fn as_u32(value: Option<&serde_json::Value>) -> Option<u32> {
    value
        .and_then(serde_json::Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
}

fn as_f64(value: Option<&serde_json::Value>) -> Option<f64> {
    match value {
        Some(serde_json::Value::String(text)) => text.trim().parse::<f64>().ok(),
        Some(serde_json::Value::Number(number)) => number.as_f64(),
        _ => None,
    }
}

fn as_text(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty() && *text != "unknown")
        .map(str::to_string)
}

async fn probe_file(app: &AppHandle, path: &Path) -> Result<Probe, String> {
    let (_, ffprobe) = ffmpeg_paths(app)?;
    let mut cmd = Command::new(&ffprobe);
    cmd.arg("-v")
        .arg("error")
        .arg("-print_format")
        .arg("json")
        .arg("-show_format")
        .arg("-show_streams")
        .arg(path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    hide_console_tokio(&mut cmd);

    let output = tokio::time::timeout(PROBE_TIMEOUT, cmd.output())
        .await
        .map_err(|_| "FFprobe tardó demasiado en leer el archivo.".to_string())?
        .map_err(|e| format!("No se pudo ejecutar FFprobe: {e}"))?;

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
            "No se pudo leer el archivo. ¿Está dañado o usas un formato poco habitual?".to_string()
        } else {
            format!("No se pudo leer el archivo:\n{detail}")
        });
    }

    let value: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Respuesta inesperada de FFprobe: {e}"))?;

    let mut video_codec = None;
    let mut audio_codec = None;
    let mut pix_fmt = None;
    let mut color_transfer = None;
    let mut width = None;
    let mut height = None;
    let mut stream_duration = 0.0_f64;

    if let Some(streams) = value.get("streams").and_then(|item| item.as_array()) {
        for stream in streams {
            let kind = stream
                .get("codec_type")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            let attached = stream
                .get("disposition")
                .and_then(|item| item.get("attached_pic"))
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0)
                == 1;

            if kind == "video" && !attached && video_codec.is_none() {
                video_codec = as_text(stream.get("codec_name"));
                pix_fmt = as_text(stream.get("pix_fmt"));
                color_transfer = as_text(stream.get("color_transfer"));
                width = as_u32(stream.get("width"));
                height = as_u32(stream.get("height"));
                if let Some(duration) = as_f64(stream.get("duration")) {
                    stream_duration = stream_duration.max(duration);
                }
            }

            if kind == "audio" && audio_codec.is_none() {
                audio_codec = as_text(stream.get("codec_name"));
            }
        }
    }

    let format = value.get("format");
    let duration = format
        .and_then(|item| as_f64(item.get("duration")))
        .filter(|value| value.is_finite() && *value > 0.0)
        .or_else(|| (stream_duration > 0.0).then_some(stream_duration))
        .unwrap_or(0.0);

    let size = std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);

    Ok(Probe {
        duration,
        size,
        width,
        height,
        has_video: video_codec.is_some(),
        has_audio: audio_codec.is_some(),
        video_codec,
        audio_codec,
        pix_fmt,
        color_transfer,
    })
}

fn cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("No se pudo obtener la carpeta de datos: {e}"))?;
    Ok(base.join("preview-local"))
}

fn cache_key(path: &Path, mode: &str) -> String {
    let meta = std::fs::metadata(path).ok();
    let size = meta.as_ref().map(|item| item.len()).unwrap_or(0);
    let modified = meta
        .as_ref()
        .and_then(|item| item.modified().ok())
        .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);

    let payload = format!(
        "{CACHE_VERSION}|{mode}|{}|{size}|{modified}",
        path.to_string_lossy()
    );
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in payload.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
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

fn is_fresh(path: &Path) -> bool {
    path.metadata()
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(|modified| modified.elapsed().ok())
        .map(|age| age <= CACHE_MAX_AGE)
        .unwrap_or(false)
}

fn direct_video(container: &str, probe: &Probe) -> bool {
    if !probe.has_video {
        return false;
    }
    let codec = probe.video_codec.as_deref().unwrap_or("");
    DIRECT_VIDEO_EXTENSIONS.contains(&container) && DIRECT_VIDEO_CODECS.contains(&codec)
}

fn audio_codec_playable(codec: &str) -> bool {
    matches!(
        codec,
        "aac"
            | "mp3"
            | "opus"
            | "vorbis"
            | "flac"
            | "pcm_s16le"
            | "pcm_s24le"
            | "pcm_s32le"
            | "pcm_f32le"
            | "pcm_u8"
    )
}

fn direct_audio(container: &str, probe: &Probe) -> bool {
    if !probe.has_audio {
        return false;
    }
    let codec = probe.audio_codec.as_deref().unwrap_or("");
    if !audio_codec_playable(codec) {
        return false;
    }
    DIRECT_AUDIO_EXTENSIONS.contains(&container) || direct_video(container, probe)
}

fn can_remux_mp4(probe: &Probe) -> bool {
    probe
        .video_codec
        .as_deref()
        .map(|codec| MP4_VIDEO_CODECS.contains(&codec))
        .unwrap_or(false)
}

/// Contenedor para un corte sin recodificar (ajuste «Preparar para edición»
/// desactivado): MP4 si los códecs caben, WebM para VP8/VP9/AV1 con Opus o
/// Vorbis, y MKV como último recurso.
fn raw_cut_extension(probe: &Probe, container: &str) -> &'static str {
    if can_remux_mp4(probe) {
        return "mp4";
    }
    if container == "webm" {
        let video = probe.video_codec.as_deref().unwrap_or("");
        let audio = probe.audio_codec.as_deref().unwrap_or("");
        if matches!(video, "vp8" | "vp9" | "av1") && matches!(audio, "" | "vorbis" | "opus") {
            return "webm";
        }
    }
    "mkv"
}

fn video_editor_ready(probe: &Probe) -> bool {
    probe.video_codec.as_deref() == Some("h264")
        && probe
            .pix_fmt
            .as_deref()
            .map(|pix_fmt| matches!(pix_fmt, "yuv420p" | "yuvj420p"))
            .unwrap_or(true)
}

fn audio_editor_ready(codec: &str) -> bool {
    matches!(
        codec,
        "aac"
            | "mp3"
            | "flac"
            | "alac"
            | "pcm_s16le"
            | "pcm_s24le"
            | "pcm_s32le"
            | "pcm_f32le"
            | "pcm_u8"
    )
}

fn is_hdr(probe: &Probe) -> bool {
    matches!(
        probe.color_transfer.as_deref(),
        Some("smpte2084") | Some("arib-std-b67")
    )
}

fn mp4_audio_ok(probe: &Probe) -> bool {
    match probe.audio_codec.as_deref() {
        None => true,
        Some(codec) => MP4_AUDIO_CODECS.contains(&codec),
    }
}

/// Extensión y si hay que recodificar la pista de audio para reproducirla.
fn preview_audio_plan(probe: &Probe) -> (&'static str, bool) {
    match probe.audio_codec.as_deref() {
        Some("aac") => ("m4a", false),
        Some("mp3") => ("mp3", false),
        Some("flac") => ("flac", false),
        Some("opus") | Some("vorbis") => ("ogg", false),
        Some("pcm_s16le") | Some("pcm_s24le") | Some("pcm_s32le") | Some("pcm_f32le")
        | Some("pcm_u8") => ("wav", false),
        // ALAC, AC3, DTS… no se reproducen en WebView2: se recodifican solo para el editor.
        _ => ("m4a", true),
    }
}

fn preview_height(probe: &Probe) -> u32 {
    if probe.duration > LONG_VIDEO_SECONDS {
        PREVIEW_MAX_HEIGHT_LONG
    } else {
        PREVIEW_MAX_HEIGHT
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
    detail: Option<&str>,
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
            "detail": detail,
        }),
    );
}

async fn read_progress(
    app: AppHandle,
    request_id: String,
    stdout: ChildStdout,
    duration: f64,
) {
    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let some_micros = line
            .strip_prefix("out_time_us=")
            .or_else(|| line.strip_prefix("out_time_ms="))
            .and_then(|value| value.trim().parse::<i64>().ok());
        if let Some(micros) = some_micros {
            if duration > 0.0 {
                let done = (micros.max(0) as f64) / 1_000_000.0;
                let percent = (done / duration * 100.0).clamp(0.0, 100.0);
                emit_preview(
                    &app,
                    &request_id,
                    "processing",
                    Some(percent.min(99.0)),
                    None,
                    None,
                    None,
                    None,
                    Some("Preparando una copia compatible…"),
                );
            }
        }
    }
}

async fn read_tail(stderr: ChildStderr) -> Vec<String> {
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

async fn thumb_path(app: &AppHandle, path: &Path, probe: &Probe) -> Result<PathBuf, String> {
    let root = cache_root(app)?;
    let key = cache_key(path, "thumb");
    let dir = root.join(&key);
    let thumb = dir.join("thumb.jpg");
    if thumb.is_file() && is_fresh(&thumb) {
        cleanup_cache(&root, &key);
        return Ok(thumb);
    }
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("No se pudo crear la caché de miniaturas: {e}"))?;
    cleanup_cache(&root, &key);

    let (ffmpeg, _) = ffmpeg_paths(app)?;
    let mut cmd = Command::new(&ffmpeg);
    cmd.arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-nostdin");
    if probe.has_video && probe.duration > 0.0 {
        let cue = (probe.duration * 0.1).clamp(0.1, 300.0);
        cmd.arg("-ss").arg(format!("{cue:.3}"));
    }
    cmd.arg("-i")
        .arg(path)
        .arg("-map")
        .arg("0:v:0?")
        .arg("-frames:v")
        .arg("1")
        .arg("-vf")
        .arg("scale=480:-2")
        .arg("-q:v")
        .arg("4")
        .arg("-y")
        .arg(&thumb)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    hide_console_tokio(&mut cmd);

    let status = tokio::time::timeout(THUMB_TIMEOUT, cmd.status())
        .await
        .map_err(|_| "La miniatura tardó demasiado en generarse.".to_string())?
        .map_err(|e| format!("No se pudo generar la miniatura: {e}"))?;
    if !status.success() || !thumb.is_file() {
        return Err("No se pudo generar la miniatura.".to_string());
    }
    Ok(thumb)
}

#[tauri::command]
pub async fn inspect_local(app: AppHandle, path: String) -> Result<LocalMedia, String> {
    let path = PathBuf::from(path.trim());
    if path.as_os_str().is_empty() {
        return Err("Falta la ruta del archivo.".to_string());
    }
    if !path.is_file() {
        return Err(format!("El archivo no existe o no es accesible: {}", path.display()));
    }
    let extension = lower_extension(&path);
    if !VIDEO_EXTENSIONS.contains(&extension.as_str())
        && !AUDIO_EXTENSIONS.contains(&extension.as_str())
    {
        return Err("Ese formato no es de vídeo ni de audio.".to_string());
    }

    let probe = probe_file(&app, &path).await?;
    if !probe.has_video && !probe.has_audio {
        return Err("El archivo no tiene pistas de vídeo ni de audio.".to_string());
    }

    let _ = app.asset_protocol_scope().allow_file(&path);
    let thumbnail = thumb_path(&app, &path, &probe).await.ok();
    if let Some(thumb) = &thumbnail {
        let _ = app.asset_protocol_scope().allow_file(thumb);
    }

    Ok(LocalMedia {
        path: path.to_string_lossy().to_string(),
        title: title_of(&path),
        duration: (probe.duration > 0.0).then_some(probe.duration),
        size: probe.size,
        width: probe.width,
        height: probe.height,
        video_codec: probe.video_codec.clone(),
        audio_codec: probe.audio_codec.clone(),
        container: extension,
        has_video: probe.has_video,
        has_audio: probe.has_audio,
        thumbnail: thumbnail.map(|value| value.to_string_lossy().to_string()),
    })
}

#[tauri::command]
pub async fn prepare_local_preview(
    app: AppHandle,
    state: State<'_, LocalPreviewState>,
    path: String,
    mode: Option<String>,
    duration: Option<f64>,
    request_id: String,
    force: Option<bool>,
) -> Result<LocalPreviewFile, String> {
    let path = PathBuf::from(path.trim());
    if !path.is_file() {
        return Err(format!("El archivo ya no está en esa ruta: {}", path.display()));
    }
    if request_id.trim().is_empty() {
        return Err("Falta el identificador de la vista previa.".to_string());
    }
    let force = force.unwrap_or(false);
    let is_audio = mode.as_deref() == Some("audio");
    let kind = if is_audio { "audio" } else { "video" };

    if let Some(previous) = state.active.lock().ok().and_then(|mut guard| guard.take()) {
        taskkill(previous.pid);
    }
    if let Ok(mut set) = state.cancelled.lock() {
        set.remove(&request_id);
    }

    let probe = probe_file(&app, &path).await?;
    if is_audio && !probe.has_audio {
        return Err("El archivo no tiene pista de audio.".to_string());
    }
    if !is_audio && !probe.has_video {
        return Err("El archivo no tiene pista de vídeo.".to_string());
    }

    let container = lower_extension(&path);
    let direct = if is_audio {
        direct_audio(&container, &probe)
    } else {
        direct_video(&container, &probe)
    };
    if direct && !force {
        let _ = app.asset_protocol_scope().allow_file(&path);
        emit_preview(
            &app,
            &request_id,
            "ready",
            Some(100.0),
            None,
            None,
            None,
            None,
            Some("Reproduciendo el archivo original."),
        );
        return Ok(LocalPreviewFile {
            path: path.to_string_lossy().to_string(),
            kind: kind.to_string(),
            cached: false,
        });
    }

    let root = cache_root(&app)?;
    let key = cache_key(&path, kind);
    let dir = root.join(&key);

    let (output_name, audio_only, copy_audio, transcode_video, output_ext) = if is_audio {
        let (ext, transcode) = preview_audio_plan(&probe);
        (format!("preview.{ext}"), true, !transcode, false, ext)
    } else if can_remux_mp4(&probe) && probe.size <= MAX_REMUX_BYTES {
        let audio_copy = mp4_audio_ok(&probe);
        ("preview.mp4".to_string(), false, audio_copy, false, "mp4")
    } else {
        ("preview.mp4".to_string(), false, false, true, "mp4")
    };
    let output = dir.join(&output_name);

    if !force && output.is_file() && is_fresh(&output) {
        cleanup_cache(&root, &key);
        let _ = app.asset_protocol_scope().allow_file(&output);
        emit_preview(
            &app,
            &request_id,
            "ready",
            Some(100.0),
            None,
            None,
            None,
            None,
            Some("Copia compatible ya preparada."),
        );
        return Ok(LocalPreviewFile {
            path: output.to_string_lossy().to_string(),
            kind: kind.to_string(),
            cached: true,
        });
    }

    let _ = tokio::fs::remove_dir_all(&dir).await;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("No se pudo crear la caché de vista previa: {e}"))?;
    cleanup_cache(&root, &key);

    let (ffmpeg, _) = ffmpeg_paths(&app)?;
    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "warning".into(),
        "-nostdin".into(),
        "-y".into(),
        "-i".into(),
        path.to_string_lossy().to_string(),
    ];

    if audio_only {
        args.extend(["-vn".into(), "-map".into(), "0:a:0".into()]);
        if copy_audio {
            args.extend(["-c:a".into(), "copy".into()]);
        } else {
            args.extend([
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                "160k".into(),
            ]);
        }
    } else if transcode_video {
        let height = preview_height(&probe);
        let scale = format!("scale=-2:'min({height},ih)'");
        args.extend([
            "-map".into(),
            "0:v:0".into(),
            "-map".into(),
            "0:a:0?".into(),
            "-vf".into(),
            scale,
            "-c:v".into(),
            "libx264".into(),
            "-preset".into(),
            "veryfast".into(),
            "-crf".into(),
            "26".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
        ]);
        if probe.has_audio {
            args.extend([
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                "160k".into(),
            ]);
        }
    } else {
        args.extend(["-map".into(), "0:v:0".into()]);
        if probe.has_audio {
            args.push("-map".into());
            args.push("0:a:0".into());
        }
        args.extend(["-c:v".into(), "copy".into()]);
        if copy_audio {
            args.extend(["-c:a".into(), "copy".into()]);
        } else if probe.has_audio {
            args.extend([
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                "160k".into(),
            ]);
        }
    }

    if output_ext == "mp4" || output_ext == "m4a" {
        args.extend(["-movflags".into(), "+faststart".into()]);
    }
    args.extend([
        "-progress".into(),
        "pipe:1".into(),
        "-nostats".into(),
        output.to_string_lossy().to_string(),
    ]);

    let mut cmd = Command::new(&ffmpeg);
    cmd.args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    hide_console_tokio(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("No se pudo iniciar FFmpeg: {e}"))?;
    let pid = child
        .id()
        .ok_or_else(|| "No se pudo obtener el PID de FFmpeg".to_string())?;

    if let Ok(mut guard) = state.active.lock() {
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
        Some(if transcode_video {
            "Generando una copia ligera para editar con fluidez…"
        } else {
            "Preparando una copia compatible del archivo…"
        }),
    );

    let total_duration = if probe.duration > 0.0 {
        probe.duration
    } else {
        duration.unwrap_or(0.0)
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let out_task = stdout.map(|stdout| {
        tauri::async_runtime::spawn(read_progress(
            app.clone(),
            request_id.clone(),
            stdout,
            total_duration,
        ))
    });
    let err_task = stderr.map(|stderr| tauri::async_runtime::spawn(read_tail(stderr)));

    let status = child.wait().await;
    if let Some(task) = out_task {
        let _ = task.await;
    }
    let stderr_lines = match err_task {
        Some(task) => task.await.unwrap_or_default(),
        None => Vec::new(),
    };

    if let Ok(mut guard) = state.active.lock() {
        if guard
            .as_ref()
            .is_some_and(|active| active.request_id == request_id)
        {
            *guard = None;
        }
    }

    let was_cancelled = state
        .cancelled
        .lock()
        .map(|mut set| set.remove(&request_id))
        .unwrap_or(false);

    if was_cancelled {
        let _ = tokio::fs::remove_dir_all(&dir).await;
        return Err("Vista previa cancelada.".to_string());
    }

    match status {
        Ok(status) if status.success() => {
            let valid = output
                .metadata()
                .map(|meta| meta.len() > 0)
                .unwrap_or(false);
            if !valid {
                let detail = stderr_tail(&stderr_lines, 10);
                return Err(if detail.is_empty() {
                    "FFmpeg terminó pero no dejó una copia reproducible.".to_string()
                } else {
                    format!("FFmpeg terminó sin una copia reproducible:\n{detail}")
                });
            }
            cleanup_cache(&root, &key);
            let _ = app.asset_protocol_scope().allow_file(&output);
            emit_preview(
                &app,
                &request_id,
                "ready",
                Some(100.0),
                None,
                None,
                None,
                None,
                Some("Copia compatible lista."),
            );
            Ok(LocalPreviewFile {
                path: output.to_string_lossy().to_string(),
                kind: kind.to_string(),
                cached: false,
            })
        }
        Ok(status) => {
            let detail = stderr_tail(&stderr_lines, 10);
            Err(if detail.is_empty() {
                format!("FFmpeg terminó con código {status}")
            } else {
                format!("No se pudo preparar la vista previa:\n{detail}")
            })
        }
        Err(error) => Err(format!("FFmpeg se cerró inesperadamente: {error}")),
    }
}

#[tauri::command]
pub fn cancel_local_preview(
    state: State<'_, LocalPreviewState>,
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

fn sanitize_name(value: &str) -> String {
    let mut cleaned: String = value
        .chars()
        .map(|character| {
            if character.is_control() || matches!(character, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                ' '
            } else {
                character
            }
        })
        .collect();
    cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    cleaned = cleaned.trim_matches(|character| character == '.' || character == ' ').to_string();
    if cleaned.is_empty() {
        return "Clip".to_string();
    }
    let mut limited: String = cleaned.chars().take(90).collect();
    let upper = limited.to_ascii_uppercase();
    if [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ]
    .contains(&upper.as_str())
    {
        limited.insert(0, '_');
    }
    limited
}

fn unique_path(dir: &Path, stem: &str, extension: &str) -> PathBuf {
    let mut candidate = dir.join(format!("{stem}.{extension}"));
    let mut index = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem} ({index}).{extension}"));
        index += 1;
        if index > 999 {
            break;
        }
    }
    candidate
}

fn cut_audio_extension(probe: &Probe) -> &'static str {
    match probe.audio_codec.as_deref() {
        Some("aac") | Some("alac") => "m4a",
        Some("mp3") => "mp3",
        Some("flac") => "flac",
        Some("opus") | Some("vorbis") => "ogg",
        Some("pcm_s16le") | Some("pcm_s24le") | Some("pcm_s32le") | Some("pcm_f32le")
        | Some("pcm_u8") => "wav",
        Some("ac3") => "ac3",
        Some("eac3") => "eac3",
        Some("dts") => "dts",
        Some("wmav1") | Some("wmav2") => "wma",
        // Matroska admite casi cualquier pista de audio sin recodificar.
        _ => "mka",
    }
}

fn emit_job_log(app: &AppHandle, job_id: &str, line: &str) {
    let _ = app.emit(
        "job://log",
        serde_json::json!({ "jobId": job_id, "line": line }),
    );
}

fn emit_job_progress(app: &AppHandle, job_id: &str, percent: f64) {
    let _ = app.emit(
        "job://progress",
        serde_json::json!({
            "jobId": job_id,
            "status": "processing",
            "downloaded": serde_json::Value::Null,
            "total": serde_json::Value::Null,
            "speed": serde_json::Value::Null,
            "eta": serde_json::Value::Null,
            "percent": percent.clamp(0.0, 99.0),
        }),
    );
}

async fn read_cut_stdout(
    app: AppHandle,
    job_id: String,
    stdout: ChildStdout,
    clip_duration: f64,
) {
    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim();
        let micros = line
            .strip_prefix("out_time_us=")
            .or_else(|| line.strip_prefix("out_time_ms="))
            .and_then(|value| value.trim().parse::<i64>().ok());
        if let Some(micros) = micros {
            if clip_duration > 0.0 {
                let done = (micros.max(0) as f64) / 1_000_000.0;
                emit_job_progress(&app, &job_id, done / clip_duration * 100.0);
            }
        }
    }
}

async fn read_cut_stderr(
    app: AppHandle,
    job_id: String,
    stderr: ChildStderr,
) -> Vec<String> {
    let mut lines = BufReader::new(stderr).lines();
    let mut tail: VecDeque<String> = VecDeque::with_capacity(80);
    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        emit_job_log(&app, &job_id, line);
        if tail.len() == 80 {
            tail.pop_front();
        }
        tail.push_back(line.to_string());
    }
    tail.into_iter().collect()
}

fn parse_frame_rate(value: Option<&serde_json::Value>) -> Option<f64> {
    let text = value.and_then(serde_json::Value::as_str)?;
    let (numerator, denominator) = text.split_once('/')?;
    let numerator = numerator.parse::<f64>().ok()?;
    let denominator = denominator.parse::<f64>().ok()?;
    if numerator <= 0.0 || denominator <= 0.0 {
        return None;
    }
    let fps = numerator / denominator;
    if fps.is_finite() && fps > 0.0 && fps <= 240.0 {
        Some(fps)
    } else {
        None
    }
}

/// Lee la frecuencia de fotogramas del archivo de preview con FFprobe.
/// Es una lectura barata y no modifica el archivo.
#[tauri::command]
pub async fn probe_fps(app: AppHandle, path: String) -> Result<Option<f64>, String> {
    let input = PathBuf::from(path.trim());
    if !input.is_file() {
        return Err("El archivo de preview ya no está en esa ruta.".to_string());
    }
    let (_, ffprobe) = ffmpeg_paths(&app)?;
    let mut cmd = Command::new(&ffprobe);
    cmd.arg("-v")
        .arg("error")
        .arg("-select_streams")
        .arg("v:0")
        .arg("-show_entries")
        .arg("stream=avg_frame_rate,r_frame_rate")
        .arg("-of")
        .arg("json")
        .arg(&input)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    hide_console_tokio(&mut cmd);

    let output = tokio::time::timeout(Duration::from_secs(20), cmd.output())
        .await
        .map_err(|_| "FFprobe tardó demasiado en leer los fotogramas.".to_string())?
        .map_err(|e| format!("No se pudo ejecutar FFprobe: {e}"))?;

    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "No se pudo leer la frecuencia de fotogramas: {}",
            detail.trim()
        ));
    }

    let value: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Respuesta inesperada de FFprobe: {e}"))?;
    let stream = value
        .get("streams")
        .and_then(serde_json::Value::as_array)
        .and_then(|streams| streams.first());

    Ok(stream.and_then(|item| {
        parse_frame_rate(item.get("avg_frame_rate"))
            .or_else(|| parse_frame_rate(item.get("r_frame_rate")))
    }))
}

#[tauri::command]
pub async fn start_local_cut(
    app: AppHandle,
    state: State<'_, AppState>,
    req: LocalCutRequest,
) -> Result<String, String> {
    let input = PathBuf::from(req.input_path.trim());
    if !input.is_file() {
        return Err(format!(
            "El archivo original ya no está en esa ruta: {}",
            input.display()
        ));
    }
    if req.output_dir.trim().is_empty() {
        return Err("Elige una carpeta de salida.".to_string());
    }
    if req.clip_end <= req.clip_start {
        return Err("El tramo no es válido: el fin debe ser mayor que el inicio.".to_string());
    }

    let probe = probe_file(&app, &input).await?;
    let kind = if req.kind == "audio" { "audio" } else { "video" };
    if kind == "audio" && !probe.has_audio {
        return Err("El archivo no tiene pista de audio.".to_string());
    }
    if kind == "video" && !probe.has_video {
        return Err("El archivo no tiene pista de vídeo.".to_string());
    }

    let container = lower_extension(&input);
    let profile = EditorProfile::from_request(req.editor_profile.as_deref(), req.editor_ready);
    let extension = if kind == "audio" {
        if req.editor_ready
            && !audio_editor_ready(probe.audio_codec.as_deref().unwrap_or(""))
        {
            "m4a"
        } else {
            cut_audio_extension(&probe)
        }
    } else {
        match profile {
            EditorProfile::Original => raw_cut_extension(&probe, &container),
            EditorProfile::ProRes4k => "mov",
            _ => "mp4",
        }
    };
    let audio_recode = kind == "audio"
        && req.editor_ready
        && !audio_editor_ready(probe.audio_codec.as_deref().unwrap_or(""));
    let scale = if kind != "audio" && profile == EditorProfile::Premiere1080 {
        compat::scale_to_1080(probe.width, probe.height)
    } else {
        None
    };
    let recode_video = kind != "audio"
        && (req.precise
            || match profile {
                EditorProfile::Original => false,
                EditorProfile::Premiere1080 => !video_editor_ready(&probe) || scale.is_some(),
                EditorProfile::Premiere4k => !video_editor_ready(&probe),
                EditorProfile::ProRes4k => true,
            });
    let start = req.clip_start;
    let mut end = req.clip_end;
    if probe.duration > 1.0 {
        let max = probe.duration.ceil();
        if start >= max {
            return Err("El tramo empieza después del final del archivo.".to_string());
        }
        if end > max {
            end = max;
        }
    }
    if end <= start {
        return Err("El tramo no es válido: el fin debe ser mayor que el inicio.".to_string());
    }

    let title = if req.title.trim().is_empty() {
        title_of(&input)
    } else {
        req.title.trim().to_string()
    };
    let safe_title = compat::clean_stem(&sanitize_name(&title));
    let folder = Path::new(req.output_dir.trim()).join(&safe_title);
    tokio::fs::create_dir_all(&folder)
        .await
        .map_err(|e| format!("No se pudo crear la carpeta de salida: {e}"))?;

    let file_stem = format!("{} {}", clip_label(start, end), safe_title);
    let output = unique_path(&folder, &file_stem, extension);

    let (ffmpeg, _) = ffmpeg_paths(&app)?;
    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "warning".into(),
        "-nostdin".into(),
    ];
    if kind == "audio" {
        // En audio no hay keyframes: el seek de salida recorta exacto y evita
        // que el pre-roll del contenedor alargue el clip.
        args.extend([
            "-i".into(),
            input.to_string_lossy().to_string(),
            "-ss".into(),
            format_clock(start),
            "-t".into(),
            format_clock(end - start),
        ]);
        args.extend([
            "-map".into(),
            "0:a:0".into(),
            "-vn".into(),
        ]);
        if audio_recode {
            args.extend([
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                "256k".into(),
                "-ar".into(),
                "48000".into(),
                "-ac".into(),
                "2".into(),
            ]);
        } else {
            args.extend(["-c:a".into(), "copy".into()]);
        }
        if extension == "m4a" {
            args.extend([
                "-movflags".into(),
                "+faststart".into(),
            ]);
        }
    } else {
        let audio_copy = probe.audio_codec.as_deref() == Some("aac");
        let recode = recode_video;

        if req.precise {
            // -ss después de -i busca el fotograma exacto, a costa de decodificar
            // desde el principio. La recodificación es obligatoria en este modo.
            args.extend([
                "-i".into(),
                input.to_string_lossy().to_string(),
                "-ss".into(),
                format_clock(start),
                "-t".into(),
                format_clock(end - start),
                "-map".into(),
                "0:v:0".into(),
            ]);
        } else {
            // Al recodificar, el seek de entrada ya es exacto; al copiar puede
            // incluir el keyframe anterior al punto marcado.
            args.extend([
                "-ss".into(),
                format_clock(start),
                "-i".into(),
                input.to_string_lossy().to_string(),
                "-t".into(),
                format_clock(end - start),
                "-map".into(),
                "0:v:0".into(),
            ]);
        }
        if probe.has_audio {
            args.extend(["-map".into(), "0:a:0".into()]);
        }

        if recode {
            let mut filters: Vec<String> = Vec::new();
            if !profile.is_original() && is_hdr(&probe) {
                filters.push(compat::TONEMAP_FILTER.to_string());
            }
            if let Some(scale) = &scale {
                filters.push(scale.clone());
            }
            if !filters.is_empty() {
                args.extend(["-vf".into(), filters.join(",")]);
            }
            if profile.is_original() {
                args.extend([
                    "-c:v".into(),
                    "libx264".into(),
                    "-preset".into(),
                    "veryfast".into(),
                    "-crf".into(),
                    "18".into(),
                    "-profile:v".into(),
                    "high".into(),
                    "-pix_fmt".into(),
                    "yuv420p".into(),
                ]);
            } else {
                args.extend(compat::video_encode_args(profile));
            }
        } else {
            args.extend(["-c:v".into(), "copy".into()]);
        }

        if probe.has_audio {
            if profile.is_original() {
                if audio_copy {
                    args.extend(["-c:a".into(), "copy".into()]);
                } else {
                    args.extend([
                        "-c:a".into(),
                        "aac".into(),
                        "-b:a".into(),
                        "192k".into(),
                    ]);
                }
            } else {
                args.extend(compat::audio_encode_args(profile));
            }
        }

        if extension == "mp4" || extension == "mov" {
            args.extend([
                "-movflags".into(),
                "+faststart".into(),
            ]);
        }
    }
    args.extend([
        "-progress".into(),
        "pipe:1".into(),
        "-nostats".into(),
        output.to_string_lossy().to_string(),
    ]);

    // Un reintento reutiliza el jobId: limpia una cancelación anterior antes
    // de arrancar. A partir de aquí, si llega una cancelación se respeta.
    if let Ok(mut cancelled) = state.cancelled.lock() {
        cancelled.remove(&req.job_id);
    }
    let mut cmd = Command::new(&ffmpeg);
    cmd.args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    hide_console_tokio(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("No se pudo iniciar FFmpeg para el corte: {e}"))?;
    let pid = child
        .id()
        .ok_or_else(|| "No se pudo obtener el PID de FFmpeg".to_string())?;

    if let Ok(mut children) = state.children.lock() {
        children.insert(req.job_id.clone(), pid);
    }
    let cancelled_now = state
        .cancelled
        .lock()
        .map(|guard| guard.contains(&req.job_id))
        .unwrap_or(false);
    if cancelled_now {
        taskkill(pid);
    }

    let job_id = req.job_id.clone();
    let output_dir = folder.to_string_lossy().to_string();
    let job_title = title.clone();
    let children = state.children.clone();
    let cancelled = state.cancelled.clone();
    let app_handle = app.clone();
    let clip_duration = end - start;

    let _ = app.emit(
        "job://plan",
        serde_json::json!({ "jobId": job_id, "files": 1, "formatId": "local" }),
    );
    emit_job_log(
        &app,
        &job_id,
        &format!(
            "Cortando {} – {} con FFmpeg ({}).",
            format_clock(start),
            format_clock(end),
            if req.precise {
                "recodificando para corte exacto"
            } else if recode_video {
                "recodificando para edición"
            } else if audio_recode {
                "audio a AAC para edición"
            } else {
                "sin recodificar"
            }
        ),
    );

    tauri::async_runtime::spawn(async move {
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let out_task = stdout.map(|stdout| {
            tauri::async_runtime::spawn(read_cut_stdout(
                app_handle.clone(),
                job_id.clone(),
                stdout,
                clip_duration,
            ))
        });
        let err_task = stderr.map(|stderr| {
            tauri::async_runtime::spawn(read_cut_stderr(
                app_handle.clone(),
                job_id.clone(),
                stderr,
            ))
        });

        let status = child.wait().await;
        if let Some(task) = out_task {
            let _ = task.await;
        }
        let stderr_lines = match err_task {
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
            let _ = tokio::fs::remove_file(&output).await;
            let _ = app_handle.emit(
                "job://cancelled",
                serde_json::json!({ "jobId": job_id }),
            );
            return;
        }

        match status {
            Ok(status) if status.success() => {
                let valid = output
                    .metadata()
                    .map(|meta| meta.len() > 0)
                    .unwrap_or(false);
                if !valid {
                    let _ = tokio::fs::remove_file(&output).await;
                    let detail = stderr_tail(&stderr_lines, 12);
                    let _ = app_handle.emit(
                        "job://error",
                        serde_json::json!({
                            "jobId": job_id,
                            "message": if detail.is_empty() {
                                "FFmpeg terminó pero no creó el clip.".to_string()
                            } else {
                                format!("FFmpeg terminó sin crear el clip:\n{detail}")
                            },
                        }),
                    );
                    return;
                }
                let cancelled_at_end = cancelled
                    .lock()
                    .map(|mut guard| guard.remove(&job_id))
                    .unwrap_or(false);
                if cancelled_at_end {
                    let _ = tokio::fs::remove_file(&output).await;
                    let _ = app_handle.emit(
                        "job://cancelled",
                        serde_json::json!({ "jobId": job_id }),
                    );
                    return;
                }
                emit_job_log(
                    &app_handle,
                    &job_id,
                    &format!("Guardado: {}", output.display()),
                );
                let _ = app_handle.emit(
                    "job://done",
                    serde_json::json!({
                        "jobId": job_id,
                        "filepath": output.to_string_lossy().to_string(),
                        "outputDir": output_dir,
                        "title": job_title,
                    }),
                );
            }
            Ok(status) => {
                let _ = tokio::fs::remove_file(&output).await;
                let detail = stderr_tail(&stderr_lines, 12);
                let _ = app_handle.emit(
                    "job://error",
                    serde_json::json!({
                        "jobId": job_id,
                        "message": if detail.is_empty() {
                            format!("FFmpeg terminó con código {status}")
                        } else {
                            detail
                        },
                    }),
                );
            }
            Err(error) => {
                let _ = tokio::fs::remove_file(&output).await;
                let _ = app_handle.emit(
                    "job://error",
                    serde_json::json!({
                        "jobId": job_id,
                        "message": format!("FFmpeg se cerró inesperadamente: {error}"),
                    }),
                );
            }
        }
    });

    Ok(req.job_id)
}

pub fn kill_all(state: &LocalPreviewState) {
    let active = state.active.lock().ok().and_then(|mut guard| guard.take());
    if let Some(active) = active {
        taskkill(active.pid);
    }
}
