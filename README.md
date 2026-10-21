# ClipFetch

Interfaz de escritorio sencilla para [yt-dlp](https://github.com/yt-dlp/yt-dlp) en Windows. Pega una URL, elige calidad y descarga. Está pensada para YouTube, pero acepta cualquier sitio compatible con yt-dlp.

## Descargar e instalar

1. Entra en [Releases](https://github.com/Remyyyyyl/clipfetch/releases/latest) y descarga `ClipFetch_0.2.0_x64-setup.exe`.
2. Ejecuta el instalador. Se instala por usuario y no pide permisos de administrador.
3. Abre ClipFetch y pulsa **Instalar motor**. La app descarga yt-dlp, FFmpeg y Deno (~250 MB de descarga; ~450 MB en disco).
4. Pega una URL, elige la calidad y la carpeta, y pulsa **Descargar**.

**Requisitos:** Windows 10 u 11 de 64 bits y conexión a internet la primera vez. WebView2 suele estar incluido; si falta, el instalador lo descarga.

**SmartScreen:** el instalador no está firmado. Si Windows muestra una advertencia, pulsa **Más información** y luego **Ejecutar de todas formas**.

**Desinstalar:** Configuración → Aplicaciones → ClipFetch. Los archivos descargados se conservan.

SHA-256 del instalador 0.2.0:

```text
2fd1a9eaa52e5bf9e69f0ffc23a2729ea575c3b180c1389f3980536e61a0fa31
```

> Estado: MVP con editor de tramos, cola persistente y motor actualizable. Siguiente fase: firma de código, verificación de checksums y más opciones de descarga.

## Funciones

- Análisis de videos, playlists y canales con metadatos y miniatura.
- Presets de calidad: mejor calidad, MP4 1080p/720p/480p, MP3 y audio original.
- **Editor de tramos**: vista previa del vídeo, línea de tiempo con dos tiradores y varios recortes por vídeo, cada uno como trabajo independiente.
- Cola de descargas con progreso, velocidad, ETA, cancelación, reintento y logs.
- Historial persistente de la cola y los ajustes.
- Aviso cuando hay una nightly nueva de yt-dlp.
- Carpeta de destino configurable y descargas simultáneas.
- Selector de vídeos en playlists y canales.
- Cookies desde Firefox o un archivo `cookies.txt`.
- Argumentos extra de yt-dlp para usuarios avanzados.
- Motor descargado y actualizado por la app: yt-dlp nightly, FFmpeg y Deno.

## Requisitos de desarrollo

- Node.js 22 o superior.
- Rust estable con toolchain MSVC.
- Visual Studio Build Tools con el workload de C++ y Windows SDK.
- WebView2.

## Desarrollo

```powershell
npm install
npm run tauri dev
```

Compilar el instalador NSIS:

```powershell
npm run tauri build
```

El instalador queda en `src-tauri/target/release/bundle/nsis/`.

### Estructura

```text
src/                  Interfaz React + TypeScript
src-tauri/            Backend Rust y configuración de Tauri
src-tauri/src/engine.rs   Descarga, estado y actualización de yt-dlp/FFmpeg/Deno
src-tauri/src/jobs.rs     Análisis, cola, recortes y ejecución de yt-dlp
src-tauri/src/store.rs    state.json (ajustes e historial) con escritura atómica
src-tauri/src/lib.rs      Comandos de Tauri
```

El motor se guarda en `%LOCALAPPDATA%\app.clipfetch.desktop\engine`:

- `yt-dlp.exe` desde `yt-dlp/yt-dlp-nightly-builds`.
- `ffmpeg.exe` y `ffprobe.exe` desde `yt-dlp/FFmpeg-Builds`.
- `deno.exe`, necesario para los desafíos JavaScript de YouTube.

Los ajustes y el historial se guardan en `%LOCALAPPDATA%\app.clipfetch.desktop\state.json`.

La app lanza `yt-dlp` como subproceso y lee eventos estructurados con `--progress-template` y `--print ...`. La única línea humana que interpreta es el aviso de archivo ya descargado («has already been downloaded»), para no dar por buena una descarga que no ocurrió.

Los tramos se descargan con `--download-sections "*HH:MM:SS-HH:MM:SS"` (corte en keyframe, sin recodificar) y se guardan en una carpeta con el nombre del vídeo, con el rango como prefijo del archivo.

## Limitaciones conocidas

- **Vista previa de tramos:** usa el stream directo de yt-dlp (normalmente 360p, caduca en unas horas). En sitios que solo ofrecen HLS puede no reproducirse; la línea de tiempo sigue funcionando con la duración conocida.
- **Corte en keyframe:** al no recodificar, el clip puede incluir uno o dos segundos de más al principio.
- **Chrome/Edge en Windows:** yt-dlp no puede descifrar las cookies v20 (App-Bound Encryption) y el archivo está bloqueado con el navegador abierto. Usa Firefox o exporta `cookies.txt` con una extensión.
- **Sin firma de código:** el instalador y los binarios no están firmados. Windows SmartScreen puede mostrar advertencias.
- **Sin actualizador de la app:** por ahora hay que descargar una versión nueva del instalador. El motor de yt-dlp sí se puede actualizar desde la app.
- **Sin verificación de hash del motor:** las descargas van por HTTPS desde GitHub, pero falta validar checksums. Está pendiente.
- **Solo Windows x64.**
- La app no elimina DRM ni garantiza la disponibilidad de ningún sitio.

Descarga solo contenido propio o con permiso. El uso de la app es responsabilidad del usuario.

## Licencia

El código de ClipFetch se publica bajo la licencia MIT. Los binarios que descarga la app tienen sus propias licencias; consulta [THIRD_PARTY.md](THIRD_PARTY.md).
