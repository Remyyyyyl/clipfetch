use crate::engine;
use crate::jobs::hide_console_tokio;
use serde_json::Value;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{ChildStderr, ChildStdout, Command};

const PROBE_TIMEOUT: Duration = Duration::from_secs(60);
const TAIL_LINES: usize = 40;

/// Cadena de filtros para pasar HDR (PQ/HLG) a SDR BT.709 antes de codificar
/// en H.264 de 8 bits. Sin esto los colores salen lavados.
pub(crate) const TONEMAP_FILTER: &str = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p";

#[derive(Debug, Clone, Default)]
pub(crate) struct MediaProbe {
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub pix_fmt: Option<String>,
    pub color_transfer: Option<String>,
    pub duration: f64,
    pub has_video: bool,
    pub has_audio: bool,
}

/// Qué hay que hacer para que el archivo se abra en un editor como Premiere.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConversionPlan {
    /// Ya es H.264 de 8 bits con AAC (o sin audio): no se toca.
    None,
    /// El vídeo se copia; solo hay que remuxear a MP4 y/o pasar el audio a AAC.
    Remux { encode_audio: bool },
    /// El vídeo no es H.264 8 bits: recodificación completa.
    Full,
}

impl ConversionPlan {
    fn description(&self) -> &'static str {
        match self {
            Self::None => "sin cambios",
            Self::Remux { encode_audio: true } => "audio a AAC",
            Self::Remux { encode_audio: false } => "remuxeando a MP4",
            Self::Full => "recodificando a H.264",
        }
    }
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
                probe.pix_fmt = as_str(stream.get("pix_fmt"));
                probe.color_transfer = as_str(stream.get("color_transfer"));
                if let Some(duration) = as_f64(stream.get("duration")) {
                    stream_duration = stream_duration.max(duration);
                }
            }

            if kind == "audio" && !probe.has_audio {
                probe.has_audio = true;
                probe.audio_codec = as_str(stream.get("codec_name"));
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
        .map_err(|error| {
            EnsureError::Failed(format!("No se pudo ejecutar FFprobe: {error}"))
        })?;

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

    let value: Value = serde_json::from_slice(&output.stdout).map_err(|error| {
        EnsureError::Failed(format!("Respuesta inesperada de FFprobe: {error}"))
    })?;
    Ok(parse_probe(&value))
}

fn is_8bit_420(pix_fmt: &str) -> bool {
    matches!(pix_fmt, "yuv420p" | "yuvj420p")
}

/// Decide el trabajo mínimo necesario. La decisión es pura para poder probarla.
pub(crate) fn conversion_plan(probe: &MediaProbe) -> ConversionPlan {
    if !probe.has_video {
        return ConversionPlan::None;
    }

    let video_ready = probe.video_codec.as_deref() == Some("h264")
        && probe
            .pix_fmt
            .as_deref()
            .map(is_8bit_420)
            .unwrap_or(true);

    if !video_ready {
        return ConversionPlan::Full;
    }

    match probe.audio_codec.as_deref() {
        None | Some("aac") => ConversionPlan::None,
        _ => ConversionPlan::Remux { encode_audio: true },
    }
}

fn is_mp4(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("mp4"))
}

fn is_hdr(probe: &MediaProbe) -> bool {
    matches!(
        probe.color_transfer.as_deref(),
        Some("smpte2084") | Some("arib-std-b67")
    )
}

fn output_path(input: &Path) -> PathBuf {
    if is_mp4(input) {
        return input.to_path_buf();
    }
    let parent = input.parent().unwrap_or_else(|| Path::new("."));
    let stem = input
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("clip");
    let mut candidate = parent.join(format!("{stem}.mp4"));
    let mut index = 2;
    while candidate.exists() {
        candidate = parent.join(format!("{stem} ({index}).mp4"));
        index += 1;
    }
    candidate
}

fn temp_path(input: &Path) -> PathBuf {
    let parent = input.parent().unwrap_or_else(|| Path::new("."));
    let stem: String = input
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("clip")
        .chars()
        .take(60)
        .collect();
    parent.join(format!(".clipfetch-{stem}.tmp.mp4"))
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
    input: &Path,
    temp: &Path,
    plan: ConversionPlan,
    probe: &MediaProbe,
    tonemap: bool,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "warning".into(),
        "-nostdin".into(),
        "-y".into(),
        "-i".into(),
        input.to_string_lossy().to_string(),
        "-map".into(),
        "0:v:0".into(),
    ];
    if probe.has_audio {
        args.extend(["-map".into(), "0:a:0".into()]);
    }

    match plan {
        ConversionPlan::None => {}
        ConversionPlan::Remux { encode_audio } => {
            args.extend(["-c:v".into(), "copy".into()]);
            if probe.has_audio {
                if encode_audio {
                    args.extend(["-c:a".into(), "aac".into(), "-b:a".into(), "192k".into()]);
                } else {
                    args.extend(["-c:a".into(), "copy".into()]);
                }
            }
        }
        ConversionPlan::Full => {
            if tonemap {
                args.extend(["-vf".into(), TONEMAP_FILTER.to_string()]);
            }
            args.extend([
                "-c:v".into(),
                "libx264".into(),
                "-preset".into(),
                "veryfast".into(),
                "-crf".into(),
                "20".into(),
                "-profile:v".into(),
                "high".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
            ]);
            if probe.has_audio {
                if probe.audio_codec.as_deref() == Some("aac") {
                    args.extend(["-c:a".into(), "copy".into()]);
                } else {
                    args.extend(["-c:a".into(), "aac".into(), "-b:a".into(), "192k".into()]);
                }
            }
        }
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

    let mut child = cmd.spawn().map_err(|error| {
        EnsureError::Failed(format!("No se pudo iniciar FFmpeg: {error}"))
    })?;
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

async fn swap_into_place(temp: &Path, target: &Path) -> Result<(), String> {
    if temp == target {
        return Ok(());
    }

    if !target.exists() {
        return tokio::fs::rename(temp, target)
            .await
            .map_err(|error| format!("No se pudo guardar el clip convertido: {error}"));
    }

    let backup = target.with_file_name(format!(
        ".{}.clipfetch-old",
        target
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("clip")
    ));
    let _ = tokio::fs::remove_file(&backup).await;
    tokio::fs::rename(target, &backup)
        .await
        .map_err(|error| format!("No se pudo apartar el archivo original: {error}"))?;

    match tokio::fs::rename(temp, target).await {
        Ok(()) => {
            let _ = tokio::fs::remove_file(&backup).await;
            Ok(())
        }
        Err(error) => {
            let _ = tokio::fs::rename(&backup, target).await;
            Err(format!("No se pudo colocar el clip convertido: {error}"))
        }
    }
}

/// Comprueba el archivo recién descargado y, si hace falta, lo deja en
/// H.264/AAC dentro de MP4 (el formato que abren Premiere y compañía).
/// Devuelve la ruta final, que puede ser distinta si el contenedor no era MP4.
pub(crate) async fn ensure_editor_ready(
    app: &AppHandle,
    job_id: &str,
    children: &Arc<Mutex<HashMap<String, u32>>>,
    cancelled: &Arc<Mutex<HashSet<String>>>,
    input: &Path,
) -> Result<PathBuf, EnsureError> {
    if !input.is_file() {
        return Err(EnsureError::Failed(format!(
            "No se encontró el archivo descargado: {}",
            input.display()
        )));
    }
    if take_cancelled(cancelled, job_id) {
        return Err(EnsureError::Cancelled);
    }

    let probe = probe_media(app, input).await?;
    if !probe.has_video {
        return Ok(input.to_path_buf());
    }

    let mut plan = conversion_plan(&probe);
    if plan == ConversionPlan::None && !is_mp4(input) {
        plan = ConversionPlan::Remux {
            encode_audio: false,
        };
    }
    if plan == ConversionPlan::None {
        return Ok(input.to_path_buf());
    }

    let (ffmpeg, _) = tools(app).map_err(EnsureError::Failed)?;
    let target = output_path(input);
    let temp = temp_path(input);
    let mut tonemap = plan == ConversionPlan::Full && is_hdr(&probe);

    emit_log(
        app,
        job_id,
        &format!(
            "Preparando para edición ({}): {}",
            plan.description(),
            input.display()
        ),
    );

    let args = conversion_args(input, &temp, plan, &probe, tonemap);
    let mut result = match run_ffmpeg(
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

    if !result.success && tonemap {
        emit_log(
            app,
            job_id,
            "El filtro HDR no está disponible; se convierte sin tonemap.",
        );
        tonemap = false;
        let retry_args = conversion_args(input, &temp, plan, &probe, tonemap);
        result = match run_ffmpeg(
            app,
            job_id,
            children,
            cancelled,
            &ffmpeg,
            &retry_args,
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
    }

    if !result.success {
        let _ = tokio::fs::remove_file(&temp).await;
        let detail = tail_text(&result.stderr);
        return Err(EnsureError::Failed(if detail.is_empty() {
            "La descarga terminó, pero FFmpeg no pudo prepararla para edición.".to_string()
        } else {
            format!("La descarga terminó, pero no se pudo convertir a H.264/AAC:\n{detail}")
        }));
    }

    let size = temp.metadata().map(|meta| meta.len()).unwrap_or(0);
    if size == 0 {
        let _ = tokio::fs::remove_file(&temp).await;
        return Err(EnsureError::Failed(
            "FFmpeg terminó pero no creó el clip convertido.".to_string(),
        ));
    }

    swap_into_place(&temp, &target)
        .await
        .map_err(EnsureError::Failed)?;
    if target.as_path() != input {
        let _ = tokio::fs::remove_file(input).await;
    }

    emit_log(
        app,
        job_id,
        &format!("Clip listo para edición: {}", target.display()),
    );
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::{conversion_plan, ConversionPlan, MediaProbe};

    fn probe(video: &str, pix_fmt: &str, audio: Option<&str>) -> MediaProbe {
        MediaProbe {
            video_codec: Some(video.to_string()),
            audio_codec: audio.map(str::to_string),
            pix_fmt: Some(pix_fmt.to_string()),
            has_video: true,
            has_audio: audio.is_some(),
            ..MediaProbe::default()
        }
    }

    #[test]
    fn h264_aac_no_necesita_tocar_nada() {
        assert_eq!(
            conversion_plan(&probe("h264", "yuv420p", Some("aac"))),
            ConversionPlan::None
        );
    }

    #[test]
    fn av1_fuerza_recodificacion() {
        assert_eq!(
            conversion_plan(&probe("av1", "yuv420p10le", Some("opus"))),
            ConversionPlan::Full
        );
        assert_eq!(
            conversion_plan(&probe("vp9", "yuv420p", Some("opus"))),
            ConversionPlan::Full
        );
    }

    #[test]
    fn h264_10_bits_fuerza_recodificacion() {
        assert_eq!(
            conversion_plan(&probe("h264", "yuv420p10le", Some("aac"))),
            ConversionPlan::Full
        );
    }

    #[test]
    fn h264_con_audio_opus_solo_recodifica_audio() {
        assert_eq!(
            conversion_plan(&probe("h264", "yuv420p", Some("opus"))),
            ConversionPlan::Remux { encode_audio: true }
        );
    }

    #[test]
    fn h264_sin_audio_esta_listo() {
        assert_eq!(
            conversion_plan(&probe("h264", "yuv420p", None)),
            ConversionPlan::None
        );
    }
}
