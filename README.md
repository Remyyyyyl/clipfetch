# ClipFetch

Interfaz de escritorio sencilla para [yt-dlp](https://github.com/yt-dlp/yt-dlp) en Windows. Pega una URL, elige calidad y descarga. Está pensada para YouTube, pero acepta cualquier sitio compatible con yt-dlp.

> Estado: MVP funcional con una interfaz de escritorio propia. La siguiente fase es ampliar opciones y pulir detalles.

## Funciones

- Análisis de videos, playlists y canales con metadatos y miniatura.
- Presets de calidad: mejor calidad, MP4 1080p/720p/480p, MP3 y audio original.
- Cola de descargas con progreso, velocidad, ETA, cancelación, reintento y logs.
- Carpeta de destino configurable y descargas simultáneas.
- Cookies desde Firefox o un archivo `cookies.txt`.
- Argumentos extra de yt-dlp para usuarios avanzados.
- Motor descargado y actualizado por la app: yt-dlp nightly, FFmpeg y Deno.

## Requisitos

Para usar el instalador:

- Windows 10 u 11 de 64 bits.
- WebView2 (incluido en Windows 11 y en la mayoría de Windows 10; el instalador puede descargarlo).
- Conexión a internet la primera vez, para descargar el motor (~250 MB de descarga, ~450 MB en disco).

Para desarrollar:

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
src-tauri/src/engine.rs   Descarga y estado de yt-dlp/FFmpeg/Deno
src-tauri/src/jobs.rs     Análisis, cola y ejecución de yt-dlp
src-tauri/src/lib.rs      Comandos de Tauri
```

El motor se guarda en `%LOCALAPPDATA%\app.clipfetch.desktop\engine`:

- `yt-dlp.exe` desde `yt-dlp/yt-dlp-nightly-builds`.
- `ffmpeg.exe` y `ffprobe.exe` desde `yt-dlp/FFmpeg-Builds`.
- `deno.exe`, necesario para los desafíos JavaScript de YouTube.

La app lanza `yt-dlp` como subproceso y lee eventos estructurados con `--progress-template` y `--print after_move:...`. No parsea la salida humana de yt-dlp.

## Limitaciones conocidas

- **Chrome/Edge en Windows:** yt-dlp no puede descifrar las cookies v20 (App-Bound Encryption) y el archivo está bloqueado con el navegador abierto. Usa Firefox o exporta `cookies.txt` con una extensión.
- **Sin firma de código:** el instalador y los binarios no están firmados. Windows SmartScreen puede mostrar advertencias.
- **Sin actualizador de la app:** por ahora hay que descargar una versión nueva del instalador. El motor de yt-dlp sí se puede actualizar desde la app.
- **Sin verificación de hash del motor:** las descargas van por HTTPS desde GitHub, pero falta validar checksums. Está pendiente.
- **Solo Windows x64.**
- La app no elimina DRM ni garantiza la disponibilidad de ningún sitio.

Descarga solo contenido propio o con permiso. El uso de la app es responsabilidad del usuario.

## Licencia

El código de ClipFetch se publica bajo la licencia MIT. Los binarios que descarga la app tienen sus propias licencias; consulta [THIRD_PARTY.md](THIRD_PARTY.md).
