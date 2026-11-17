use crate::engine;
use crate::jobs::{hide_console_tokio, AppState};
use serde::Deserialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{ChildStderr, ChildStdout, Command};

const PROBE_TIMEOUT: Duration = Duration::from_secs(60);
const TAIL_LINES: usize = 40;

/// Cadena de filtros para pasar HDR (PQ/HLG) a SDR BT.709 antes de codificar.
/// Sin esto los colores salen lavados.
pub(crate) const TONEMAP_FILTER: &str = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p";

/// Perfil de la copia que se entrega al editor. El máster descargado no se
/// toca salvo que se pida no conservarlo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EditorProfile {
    /// Sin copia: se deja el archivo descargado tal cual (AV1/VP9 incluidos).
    Original,
    /// Copia 1080p H.264 High@4.2, AAC 48 kHz estéreo. La opción recomendada.
    Premiere1080,
    /// Copia a la misma resolución en H.264. Útil, pero algunas versiones de
    /// Premiere tienen problemas con MP4 H.264 4K.
    Premiere4k,
    /// Copia ProRes 422 10 bits + PCM 48 kHz estéreo en MOV.
    ProRes4k,
}

impl EditorProfile {
    pub(crate) fn from_request(profile: Option<&str>, legacy_editor_ready: bool) -> Self {
        match profile {
            Some("original") => Self::Original,
            Some("premiere-4k") => Self::Premiere4k,
            Some("prores-4k") => Self::ProRes4k,
            Some("premiere-1080") => Self::Premiere1080,
            // Compatibilidad con trabajos guardados por la 1.3, que solo
            // tenían el booleano `editorReady`.
            None if !legacy_editor_ready => Self::Original,
            _ => Self::Premiere1080,
        }
    }

    pub(crate) fn is_original(self) -> bool {
        matches!(self, Self::Original)
    }

    fn is_prores(self) -> bool {
        matches!(self, Self::ProRes4k)
    }

    pub(crate) fn extension(self) -> &'static str {
        if self.is_prores() { "mov" } else { "mp4" }
    }

    fn suffix(self) -> &'static str {
        match self {
            Self::Premiere1080 => "_1080p",
            Self::Premiere4k => "_4k",
            Self::ProRes4k => "_prores422",
            Self::Original => "",
        }
    }

    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Premiere1080 => "1080p H.264",
            Self::Premiere4k => "H.264 a resolución original",
            Self::ProRes4k => "ProRes 422",
            Self::Original => "original",
        }
    }

    fn x264_level(self) -> Option<&'static str> {
        match self {
            Self::Premiere1080 => Some("4.2"),
            Self::Premiere4k => Some("5.2"),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub(crate) struct MediaProbe {
    pub video_codec: Option<String>,
    pub profile: Option<String>,
    pub audio_codec: Option<String>,
    pub pix_fmt: Option<String>,
    pub color_transfer: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u32>,
    pub duration: f64,
    pub has_video: bool,
    pub has_audio: bool,
}

pub(crate) struct EditorOutput {
    pub edit: PathBuf,
    pub master: Option<PathBuf>,
}

#[derive(Debug)]
pub(crate) enum EnsureError {
    Cancelled,
    Failed(String),
}

impl EnsureError {
    pub(crate) fn message(&self) -> String {
        match self {
            Self::Cancelled => "Conversión cancelada.".to_string(),
            Self::Failed(detail) => detail.clone(),
        }
    }
}

struct RunOutput {
    success: bool,
    stderr: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ConvertPlan {
    transcode_video: bool,
    scale: Option<String>,
    tonemap: bool,
}

fn tools(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let dir = engine::engine_dir(app)?;
    let ffmpeg = dir.join("ffmpeg.exe");
    let ffprobe = dir.join("ffprobe.exe");
    if !ffmpeg.exists() || !ffprobe.exists() {
        return Err(
            "Falta FFmpeg. Instala el motor desde la pantalla de inicio para preparar los clips."
                .to_string(),
        );
    }
    Ok((ffmpeg, ffprobe))
}

fn as_f64(value: Option<&Value>) -> Option<f64> {
    match value {
        Some(Value::String(text)) => text.trim().parse::<f64>().ok(),
        Some(Value::Number(number)) => number.as_f64(),
        _ => None,
    }
}

fn as_u32(value: Option<&Value>) -> Option<u32> {
    value
        .and_then(Value::as_u64)
        .and_then(|number| u32::try_from(number).ok())
}

fn as_str(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty() && *text != "unknown")
        .map(str::to_string)
}

fn parse_probe(value: &Value) -> MediaProbe {
    let mut probe = MediaProbe::default();
    let mut stream_duration = 0.0_f64;

    if let Some(streams) = value.get("streams").and_then(Value::as_array) {
        for stream in streams {
            let kind = stream.get("codec_type").and_then(Value::as_str).unwrap_or("");
            let attached = stream
                .get("disposition")
                .and_then(|item| item.get("attached_pic"))
                .and_then(Value::as_u64)
                .unwrap_or(0)
                == 1;

            if kind == "video" && !attached && !probe.has_video {
                probe.has_video = true;
                probe.video_codec = as_str(stream.get("codec_name"));
                probe.profile = as_str(stream.get("profile"));
                probe.pix_fmt = as_str(stream.get("pix_fmt"));
                probe.color_transfer = as_str(stream.get("color_transfer"));
                probe.width = as_u32(stream.get("width"));
                probe.height = as_u32(stream.get("height"));
                if let Some(duration) = as_f64(stream.get("duration")) {
                    stream_duration = stream_duration.max(duration);
                }
            }

            if kind == "audio" && !probe.has_audio {
                probe.has_audio = true;
                probe.audio_codec = as_str(stream.get("codec_name"));
                probe.sample_rate = as_f64(stream.get("sample_rate")).map(|value| value as u32);
                probe.channels = as_u32(stream.get("channels"));
            }
        }
    }

    probe.duration = value
        .get("format")
        .and_then(|format| as_f64(format.get("duration")))
        .filter(|duration| duration.is_finite() && *duration > 0.0)
        .or_else(|| (stream_duration > 0.0).then_some(stream_duration))
        .unwrap_or(0.0);

    probe
}

async fn probe_media(app: &AppHandle, path: &Path) -> Result<MediaProbe, EnsureError> {
    let (_, ffprobe) = tools(app).map_err(EnsureError::Failed)?;
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
        .map_err(|_| {
            EnsureError::Failed("FFprobe tardó demasiado en leer el archivo.".to_string())
        })?
        .map_err(|error| EnsureError::Failed(format!("No se pudo ejecutar FFprobe: {error}")))?;

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
        return Err(EnsureError::Failed(if detail.is_empty() {
            "No se pudo leer el vídeo descargado.".to_string()
        } else {
            format!("No se pudo leer el vídeo descargado:\n{detail}")
        }));
    }

    let value: Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| EnsureError::Failed(format!("Respuesta inesperada de FFprobe: {error}")))?;
    Ok(parse_probe(&value))
}

fn is_8bit_420(pix_fmt: &str) -> bool {
    matches!(pix_fmt, "yuv420p" | "yuvj420p")
}

fn video_is_h264_8bit(probe: &MediaProbe) -> bool {
    probe.video_codec.as_deref() == Some("h264")
        && probe
            .pix_fmt
            .as_deref()
            .map(is_8bit_420)
            .unwrap_or(true)
}

fn is_hdr(probe: &MediaProbe) -> bool {
    matches!(
        probe.color_transfer.as_deref(),
        Some("smpte2084") | Some("arib-std-b67")
    )
}

/// Filtro para dejar un vídeo en un máximo de 1920×1080 sin deformarlo ni
/// ampliarlo. Se usa tanto en descargas como en cortes locales.
pub(crate) fn scale_to_1080(width: Option<u32>, height: Option<u32>) -> Option<String> {
    match (width, height) {
        (Some(_), Some(height)) if height > 1080 => {
            Some("scale=-2:1080:flags=lanczos".to_string())
        }
        (Some(width), Some(_)) if width > 1920 => {
            Some("scale=1920:-2:flags=lanczos".to_string())
        }
        _ => None,
    }
}

fn convert_plan(profile: EditorProfile, probe: &MediaProbe) -> ConvertPlan {
    let scale = if profile == EditorProfile::Premiere1080 {
        scale_to_1080(probe.width, probe.height)
    } else {
        None
    };
    let transcode_video = match profile {
        EditorProfile::Original => false,
        EditorProfile::ProRes4k => true,
        EditorProfile::Premiere1080 => !video_is_h264_8bit(probe) || scale.is_some(),
        EditorProfile::Premiere4k => !video_is_h264_8bit(probe),
    };
    ConvertPlan {
        transcode_video,
        scale,
        tonemap: transcode_video && is_hdr(probe),
    }
}

/// Argumentos de codificación de vídeo para un perfil de editor.
pub(crate) fn video_encode_args(profile: EditorProfile) -> Vec<String> {
    if profile.is_prores() {
        return ["-c:v", "prores_ks", "-profile:v", "2", "-pix_fmt", "yuv422p10le"]
            .into_iter()
            .map(str::to_string)
            .collect();
    }
    let Some(level) = profile.x264_level() else {
        return Vec::new();
    };
    [
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "18",
        "-profile:v",
        "high",
        "-level",
        level,
        "-pix_fmt",
        "yuv420p",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

/// Argumentos de audio para un perfil de editor: AAC 48k estéreo o PCM 48k.
pub(crate) fn audio_encode_args(profile: EditorProfile) -> Vec<String> {
    if profile.is_prores() {
        return ["-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2"]
            .into_iter()
            .map(str::to_string)
            .collect();
    }
    [
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

/// Limpia un nombre para que no lleve barras verticales, corchetes ni
/// paréntesis, y para que no sea demasiado largo. Conserva acentos y espacios.
pub(crate) fn clean_stem(stem: &str) -> String {
    let mut cleaned = String::new();
    let mut last_space = false;

    for character in stem.chars() {
        if character.is_alphanumeric() || matches!(character, '-' | '_' | '.') {
            cleaned.push(character);
            last_space = false;
        } else if !last_space {
            cleaned.push(' ');
            last_space = true;
        }
    }

    let mut cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");

    if cleaned.is_empty() {
        cleaned = "clip".to_string();
    }

    let mut limited: String = cleaned.chars().take(120).collect();
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

fn edit_path(master: &Path, profile: EditorProfile) -> PathBuf {
    let parent = master.parent().unwrap_or_else(|| Path::new("."));
    let stem = master
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("clip");
    let clean = clean_stem(stem);
    let suffix = profile.suffix();
    let extension = profile.extension();
    let mut candidate = parent.join(format!("{clean}{suffix}.{extension}"));
    let mut index = 2;
    while candidate.exists() {
        candidate = parent.join(format!("{clean}{suffix} ({index}).{extension}"));
        index += 1;
    }
    candidate
}

fn temp_path(target: &Path) -> PathBuf {
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let stem = target
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("clip")
        .chars()
        .take(60)
        .collect::<String>();
    parent.join(format!(".clipfetch-{stem}.tmp.{}", target.extension().and_then(|value| value.to_str()).unwrap_or("mp4")))
}

fn emit_log(app: &AppHandle, job_id: &str, line: &str) {
    let _ = app.emit(
        "job://log",
        serde_json::json!({ "jobId": job_id, "line": line }),
    );
}

fn emit_postprocess(app: &AppHandle, job_id: &str, percent: f64) {
    let _ = app.emit(
        "job://postprocess",
        serde_json::json!({
            "jobId": job_id,
            "percent": percent.clamp(0.0, 100.0),
        }),
    );
}

fn take_cancelled(cancelled: &Arc<Mutex<HashSet<String>>>, job_id: &str) -> bool {
    cancelled
        .lock()
        .map(|mut guard| guard.remove(job_id))
        .unwrap_or(false)
}

fn conversion_args(
    master: &Path,
    temp: &Path,
    profile: EditorProfile,
    probe: &MediaProbe,
    plan: &ConvertPlan,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "warning".into(),
        "-nostdin".into(),
        "-y".into(),
        "-i".into(),
        master.to_string_lossy().to_string(),
        "-map".into(),
        "0:v:0".into(),
    ];
    if probe.has_audio {
        args.extend(["-map".into(), "0:a:0".into()]);
    }

    if plan.transcode_video {
        let mut filters: Vec<String> = Vec::new();
        if plan.tonemap {
            filters.push(TONEMAP_FILTER.to_string());
        }
        if let Some(scale) = &plan.scale {
            filters.push(scale.clone());
        }
        if !filters.is_empty() {
            args.extend(["-vf".into(), filters.join(",")]);
        }
        args.extend(video_encode_args(profile));
    } else {
        args.extend(["-c:v".into(), "copy".into()]);
    }

    if probe.has_audio {
        args.extend(audio_encode_args(profile));
    }

    args.extend([
        "-map_metadata".into(),
        "0".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-progress".into(),
        "pipe:1".into(),
        "-nostats".into(),
        temp.to_string_lossy().to_string(),
    ]);
    args
}

async fn read_convert_progress(
    app: AppHandle,
    job_id: String,
    stdout: ChildStdout,
    duration: f64,
) {
    let mut lines = BufReader::new(stdout).lines();
    let mut last = 0.0_f64;

    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim();
        let seconds = if let Some(value) = line.strip_prefix("out_time_us=") {
            value.trim().parse::<f64>().ok().map(|value| value / 1_000_000.0)
        } else if let Some(value) = line.strip_prefix("out_time_ms=") {
            // A pesar del nombre, FFmpeg lo expresa en microsegundos.
            value.trim().parse::<f64>().ok().map(|value| value / 1_000_000.0)
        } else {
            None
        };

        if let Some(seconds) = seconds {
            if duration > 0.5 && seconds.is_finite() && seconds >= 0.0 {
                let percent = (seconds / duration * 100.0).clamp(last, 100.0);
                last = percent;
                emit_postprocess(&app, &job_id, percent);
            }
        } else if line == "progress=end" {
            emit_postprocess(&app, &job_id, 100.0);
        }
    }
}

async fn read_tail(stderr: ChildStderr) -> Vec<String> {
    let mut lines = BufReader::new(stderr).lines();
    let mut tail: VecDeque<String> = VecDeque::with_capacity(TAIL_LINES);

    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }
        if tail.len() >= TAIL_LINES {
            tail.pop_front();
        }
        tail.push_back(line);
    }

    tail.into_iter().collect()
}

fn tail_text(lines: &[String]) -> String {
    lines
        .iter()
        .rev()
        .take(12)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .cloned()
        .collect::<Vec<_>>()
        .join("\n")
}

async fn run_ffmpeg(
    app: &AppHandle,
    job_id: &str,
    children: &Arc<Mutex<HashMap<String, u32>>>,
    cancelled: &Arc<Mutex<HashSet<String>>>,
    ffmpeg: &Path,
    args: &[String],
    duration: f64,
) -> Result<RunOutput, EnsureError> {
    if take_cancelled(cancelled, job_id) {
        return Err(EnsureError::Cancelled);
    }

    let mut cmd = Command::new(ffmpeg);
    cmd.args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    hide_console_tokio(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|error| EnsureError::Failed(format!("No se pudo iniciar FFmpeg: {error}")))?;
    let pid = child
        .id()
        .ok_or_else(|| EnsureError::Failed("No se pudo obtener el PID de FFmpeg.".to_string()))?;

    if let Ok(mut guard) = children.lock() {
        guard.insert(job_id.to_string(), pid);
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    emit_postprocess(app, job_id, 0.0);

    let progress_task = stdout.map(|stdout| {
        tauri::async_runtime::spawn(read_convert_progress(
            app.clone(),
            job_id.to_string(),
            stdout,
            duration,
        ))
    });
    let err_task = stderr.map(|stderr| tauri::async_runtime::spawn(read_tail(stderr)));

    let status = child.wait().await;

    if let Ok(mut guard) = children.lock() {
        guard.remove(job_id);
    }
    if let Some(task) = progress_task {
        let _ = task.await;
    }
    let stderr_lines = match err_task {
        Some(task) => task.await.unwrap_or_default(),
        None => Vec::new(),
    };

    if take_cancelled(cancelled, job_id) {
        return Err(EnsureError::Cancelled);
    }

    match status {
        Ok(status) => Ok(RunOutput {
            success: status.success(),
            stderr: stderr_lines,
        }),
        Err(error) => Err(EnsureError::Failed(format!(
            "FFmpeg se cerró inesperadamente: {error}"
        ))),
    }
}

fn validate_edit(probe: &MediaProbe, profile: EditorProfile) -> Result<(), String> {
    match profile {
        EditorProfile::Original => Ok(()),
        EditorProfile::Premiere1080 => {
            if probe.video_codec.as_deref() != Some("h264") {
                return Err("La copia no salió en H.264.".to_string());
            }
            if !probe.pix_fmt.as_deref().map(is_8bit_420).unwrap_or(false) {
                return Err(format!(
                    "La copia no salió en 8 bits 4:2:0 ({}).",
                    probe.pix_fmt.as_deref().unwrap_or("desconocido")
                ));
            }
            if probe.height.unwrap_or(0) > 1080 || probe.width.unwrap_or(0) > 1920 {
                return Err(format!(
                    "La copia no se redujo a 1080p ({}×{}).",
                    probe.width.unwrap_or(0),
                    probe.height.unwrap_or(0)
                ));
            }
            if probe.has_audio
                && (probe.audio_codec.as_deref() != Some("aac")
                    || probe.sample_rate != Some(48000)
                    || probe.channels != Some(2))
            {
                return Err("El audio de la copia no es AAC 48 kHz estéreo.".to_string());
            }
            Ok(())
        }
        EditorProfile::Premiere4k => {
            if probe.video_codec.as_deref() != Some("h264")
                || !probe.pix_fmt.as_deref().map(is_8bit_420).unwrap_or(false)
            {
                return Err("La copia 4K no salió en H.264 de 8 bits.".to_string());
            }
            if probe.has_audio
                && (probe.audio_codec.as_deref() != Some("aac")
                    || probe.sample_rate != Some(48000)
                    || probe.channels != Some(2))
            {
                return Err("El audio de la copia no es AAC 48 kHz estéreo.".to_string());
            }
            Ok(())
        }
        EditorProfile::ProRes4k => {
            if probe.video_codec.as_deref() != Some("prores") {
                return Err("La copia no salió en ProRes.".to_string());
            }
            if probe.has_audio
                && (probe.audio_codec.as_deref() != Some("pcm_s16le")
                    || probe.sample_rate != Some(48000)
                    || probe.channels != Some(2))
            {
                return Err("El audio de la copia no es PCM 48 kHz estéreo.".to_string());
            }
            Ok(())
        }
    }
}

/// Crea la copia de edición a partir del máster descargado. Devuelve la copia
/// y, si se conserva, el máster original.
pub(crate) async fn prepare_for_editor(
    app: &AppHandle,
    job_id: &str,
    children: &Arc<Mutex<HashMap<String, u32>>>,
    cancelled: &Arc<Mutex<HashSet<String>>>,
    master: &Path,
    profile: EditorProfile,
    keep_master: bool,
) -> Result<EditorOutput, EnsureError> {
    if !master.is_file() {
        return Err(EnsureError::Failed(format!(
            "No se encontró el archivo: {}",
            master.display()
        )));
    }
    if take_cancelled(cancelled, job_id) {
        return Err(EnsureError::Cancelled);
    }

    let probe = probe_media(app, master).await?;
    if !probe.has_video || profile.is_original() {
        return Ok(EditorOutput {
            edit: master.to_path_buf(),
            master: None,
        });
    }

    let (ffmpeg, _) = tools(app).map_err(EnsureError::Failed)?;
    let target = edit_path(master, profile);
    let temp = temp_path(&target);
    let plan = convert_plan(profile, &probe);
    let scalenote = if plan.scale.is_some() { ", reescalando a 1080p" } else { "" };
    emit_log(
        app,
        job_id,
        &format!(
            "Creando copia para edición ({}): {}{}",
            profile.label(),
            master.display(),
            scalenote
        ),
    );

    let args = conversion_args(master, &temp, profile, &probe, &plan);
    let result = match run_ffmpeg(
        app,
        job_id,
        children,
        cancelled,
        &ffmpeg,
        &args,
        probe.duration,
    )
    .await
    {
        Ok(result) => result,
        Err(error) => {
            let _ = tokio::fs::remove_file(&temp).await;
            return Err(error);
        }
    };

    if !result.success {
        let _ = tokio::fs::remove_file(&temp).await;
        let detail = tail_text(&result.stderr);
        return Err(EnsureError::Failed(if detail.is_empty() {
            "FFmpeg no pudo crear la copia de edición.".to_string()
        } else {
            format!("No se pudo crear la copia de edición:\n{detail}")
        }));
    }

    let size = temp.metadata().map(|meta| meta.len()).unwrap_or(0);
    if size == 0 {
        let _ = tokio::fs::remove_file(&temp).await;
        return Err(EnsureError::Failed(
            "FFmpeg terminó pero no creó la copia de edición.".to_string(),
        ));
    }

    let edit_probe = match probe_media(app, &temp).await {
        Ok(probe) => probe,
        Err(error) => {
            let _ = tokio::fs::remove_file(&temp).await;
            return Err(error);
        }
    };
    if let Err(detail) = validate_edit(&edit_probe, profile) {
        let _ = tokio::fs::remove_file(&temp).await;
        return Err(EnsureError::Failed(detail));
    }

    if let Err(error) = tokio::fs::rename(&temp, &target).await {
        let _ = tokio::fs::remove_file(&temp).await;
        return Err(EnsureError::Failed(format!(
            "No se pudo guardar la copia de edición: {error}"
        )));
    }

    let mut kept_master = Some(master.to_path_buf());
    if !keep_master {
        if tokio::fs::remove_file(master).await.is_err() {
            emit_log(
                app,
                job_id,
                "No se pudo borrar el máster; se conserva junto a la copia.",
            );
        } else {
            kept_master = None;
        }
    }

    emit_log(
        app,
        job_id,
        &format!(
            "Copia lista para edición: {}{}",
            target.display(),
            if let Some(master) = &kept_master {
                format!(" (máster: {})", master.display())
            } else {
                String::new()
            }
        ),
    );

    Ok(EditorOutput {
        edit: target,
        master: kept_master,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareRequest {
    pub id: String,
    pub path: String,
    pub profile: String,
    pub keep_master: bool,
}

#[tauri::command]
pub async fn start_prepare(
    app: AppHandle,
    state: State<'_, AppState>,
    req: PrepareRequest,
) -> Result<String, String> {
    let master = PathBuf::from(req.path.trim());
    if !master.is_file() {
        return Err(format!("El archivo no existe: {}", master.display()));
    }
    let profile = EditorProfile::from_request(Some(req.profile.as_str()), true);
    if profile.is_original() {
        return Err("Elige un perfil de edición en Ajustes antes de preparar el archivo.".to_string());
    }

    let children = state.children.clone();
    let cancelled = state.cancelled.clone();
    let id = req.id.clone();
    // Preparar un archivo existente nunca borra el original: el ajuste de
    // «conservar máster» solo se aplica a las descargas de esta app.
    let keep_master = true;

    tauri::async_runtime::spawn(async move {
        match prepare_for_editor(&app, &id, &children, &cancelled, &master, profile, keep_master)
            .await
        {
            Ok(output) => {
                let master = output
                    .master
                    .as_ref()
                    .map(|path| path.to_string_lossy().to_string());
                let _ = app.emit(
                    "prepare://done",
                    serde_json::json!({
                        "id": id,
                        "edit": output.edit.to_string_lossy(),
                        "master": master,
                    }),
                );
            }
            Err(EnsureError::Cancelled) => {
                let _ = app.emit("prepare://cancelled", serde_json::json!({ "id": id }));
            }
            Err(error) => {
                let _ = app.emit(
                    "prepare://error",
                    serde_json::json!({ "id": id, "message": error.message() }),
                );
            }
        }
    });

    Ok(req.id)
}

#[cfg(test)]
mod tests {
    use super::{
        clean_stem, convert_plan, scale_to_1080, EditorProfile, MediaProbe,
    };

    fn probe(
        video: &str,
        pix_fmt: &str,
        width: u32,
        height: u32,
        audio: Option<&str>,
    ) -> MediaProbe {
        MediaProbe {
            video_codec: Some(video.to_string()),
            audio_codec: audio.map(str::to_string),
            pix_fmt: Some(pix_fmt.to_string()),
            width: Some(width),
            height: Some(height),
            has_video: true,
            has_audio: audio.is_some(),
            ..MediaProbe::default()
        }
    }

    #[test]
    fn limpia_barras_corchetes_y_parentesis() {
        assert_eq!(
            clean_stem("00-00-00.000 85 Iconic MCU Moments ｜ Marvel (4K) [-65VtGmPoi0]"),
            "00-00-00.000 85 Iconic MCU Moments Marvel 4K -65VtGmPoi0"
        );
    }

    #[test]
    fn escala_4k_a_1080_sin_ampliar_720() {
        assert_eq!(
            scale_to_1080(Some(3840), Some(2160)),
            Some("scale=-2:1080:flags=lanczos".to_string())
        );
        assert_eq!(scale_to_1080(Some(1920), Some(1080)), None);
        assert_eq!(
            scale_to_1080(Some(2560), Some(1080)),
            Some("scale=1920:-2:flags=lanczos".to_string())
        );
    }

    #[test]
    fn h264_1080_no_se_recodifica_pero_av1_4k_si() {
        let h264 = probe("h264", "yuv420p", 1920, 1080, Some("aac"));
        assert!(!convert_plan(EditorProfile::Premiere1080, &h264).transcode_video);

        let av1 = probe("av1", "yuv420p10le", 3840, 2160, Some("aac"));
        let plan = convert_plan(EditorProfile::Premiere1080, &av1);
        assert!(plan.transcode_video);
        assert!(plan.scale.is_some());
    }

    #[test]
    fn h264_4k_baja_a_1080_y_prores_siempre_recodifica() {
        let h264 = probe("h264", "yuv420p", 3840, 2160, Some("aac"));
        assert!(convert_plan(EditorProfile::Premiere1080, &h264).transcode_video);
        assert!(convert_plan(EditorProfile::ProRes4k, &h264).transcode_video);
    }

    #[test]
    fn perfil_legacy_se_migra() {
        assert_eq!(
            EditorProfile::from_request(None, false),
            EditorProfile::Original
        );
        assert_eq!(
            EditorProfile::from_request(None, true),
            EditorProfile::Premiere1080
        );
        assert_eq!(
            EditorProfile::from_request(Some("prores-4k"), true),
            EditorProfile::ProRes4k
        );
    }
}
