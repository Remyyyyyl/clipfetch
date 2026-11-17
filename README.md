# ClipFetch

Interfaz de escritorio sencilla para [yt-dlp](https://github.com/yt-dlp/yt-dlp) y FFmpeg en Windows. Pega una URL, elige calidad y descarga, o abre un vídeo local y recorta clips; todo sale en H.264/AAC listo para editar. Está pensada para YouTube, pero acepta cualquier sitio compatible con yt-dlp y casi cualquier archivo de vídeo o audio.

## Descargar e instalar

1. Entra en [Releases](https://github.com/Remyyyyyl/clipfetch/releases/latest) y descarga el instalador más reciente (`ClipFetch_1.4.0_x64-setup.exe` en la 1.4).
2. Ejecuta el instalador. Se instala por usuario y no pide permisos de administrador.
3. Abre ClipFetch y pulsa **Instalar motor**. La app descarga yt-dlp, FFmpeg y Deno (~250 MB de descarga; ~450 MB en disco).
4. Pega una URL, elige la calidad y la carpeta, y pulsa **Añadir a la cola**. Para recortar un archivo del disco, cambia a **Archivo local** y ábrelo (o suéltalo en la ventana).

**Requisitos:** Windows 10 u 11 de 64 bits y conexión a internet la primera vez. WebView2 suele estar incluido; si falta, el instalador lo descarga. El recorte local usa FFmpeg y FFprobe del motor; no necesita yt-dlp ni Deno.

**SmartScreen:** el instalador no está firmado. Si Windows muestra una advertencia, pulsa **Más información** y luego **Ejecutar de todas formas**.

**Desinstalar:** Configuración → Aplicaciones → ClipFetch. Los archivos descargados se conservan.

SHA-256: cada release publica el hash del instalador en su página de GitHub.

> Estado: versión 1.4 con la nueva interfaz de escritorio y copia de edición 1080p H.264 (máster en máxima calidad). Siguiente fase: firma de código, verificación de checksums y actualizador.

## Funciones

- **Menú superior**: Archivo, Edición, Selección, Vista y Ayuda; el estado del motor y los ajustes viven a la derecha.
- **Botonera**: modo Vídeo y Audio, origen Enlace o Archivo local, URL, calidad, precisión de corte y carpeta de salida.
- **Barra de clips a la derecha**: pestañas de línea de tiempo, Preparado y Descargas; se puede reordenar, quitar y **exportar de una vez**.
- **Medios**: navegador de la carpeta de salida con doble clic para abrir un vídeo o audio en el editor y botón **Editar** para crear una copia para Premiere sin volver a descargar.
- **Modo avanzado**: copia local de baja resolución (hasta 480p) con audio para editar con fluidez, imán de ajuste, regla descriptiva, zoombar tipo Kdenlive (arrastra la ventana para recorrer y sus bordes para hacer zoom), atajos globales, control de volumen, repetir, varios tramos, selección con deshacer/rehacer y paso de fotograma.
- **Archivos locales**: pestaña **Archivo local** o arrastrar y soltar un vídeo/audio en la ventana. FFprobe lee duración, resolución y códecs al instante, y el editor se abre directo en modo tramos. No se copia el archivo completo: el clip se corta con FFmpeg y se entrega en el perfil de edición elegido. El original nunca se modifica.
- **Audio local**: extrae y corta la pista original (AAC→M4A, MP3→MP3, FLAC→FLAC…) sin recodificar; los códecs que un editor no abre (Opus, Vorbis, AC3, DTS, WMA…) pasan a AAC 48 kHz estéreo.
- **Vídeo**: MP4 de 360p a 2160p. Al cargar un vídeo se preselecciona su máxima resolución disponible; la calidad se puede cambiar a mano. El máster se descarga en esa calidad y la copia de edición se genera aparte.
- **Copia para edición**: perfil configurable en Ajustes. Por defecto, **1080p H.264 High@4.2, CRF 18, AAC 48 kHz estéreo**, el formato que Premiere 24 y VLC abren sin problemas. También hay **ProRes 422 4K** (máxima calidad, archivos grandes) y **H.264 a resolución original** (experimental en Premiere). La opción «Conservar máster» guarda la descarga original.
- **Audio**: MP3 320/256/192/128, M4A 256/128, Opus 160, FLAC, WAV y audio original.
- **Playlists y canales**: selector de vídeos con casillas y rangos.
- **Cola con progreso**, cancelación, reintento, logs y «Limpiar completados».
- **Historial persistente** de los trabajos exportados, ajustes y disposición de la interfaz en `state.json`.
- **Aviso de actualización** cuando hay una nightly nueva de yt-dlp.
- Cookies desde Firefox o `cookies.txt` y argumentos extra de yt-dlp.
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
src-tauri/src/compat.rs  Máster y copia de edición (1080p H.264, ProRes 422)
src-tauri/src/engine.rs   Descarga, estado y actualización de yt-dlp/FFmpeg/Deno
src-tauri/src/jobs.rs     Análisis, cola, recortes y ejecución de yt-dlp
src-tauri/src/local.rs    Archivos locales: FFprobe, vista previa y corte con FFmpeg
src-tauri/src/preview.rs  Copia local de 480p para el editor, con caché y progreso
src-tauri/src/browse.rs   Navegador de medios (listado de carpetas)
src-tauri/src/store.rs    state.json (ajustes, historial y layout) con escritura atómica
src-tauri/src/lib.rs      Comandos de Tauri
```

El motor se guarda en `%LOCALAPPDATA%\app.clipfetch.desktop\engine`:

- `yt-dlp.exe` desde `yt-dlp/yt-dlp-nightly-builds`.
- `ffmpeg.exe` y `ffprobe.exe` desde `yt-dlp/FFmpeg-Builds`.
- `deno.exe`, necesario para los desafíos JavaScript de YouTube.

Los ajustes, el historial y la disposición de la interfaz se guardan en `%LOCALAPPDATA%\app.clipfetch.desktop\state.json`. Las copias locales del editor viven en `%LOCALAPPDATA%\app.clipfetch.desktop\preview`: se conservan las 3 más recientes y se borran las de más de 7 días al preparar la siguiente. Los archivos locales usan una caché aparte, `preview-local`, con las mismas reglas: si el archivo ya se reproduce en el navegador no se copia nada; si no, se guarda un remux o un proxy 480p para editar.

La app lanza `yt-dlp` como subproceso y lee eventos estructurados con `--progress-template` y `--print ...`. La única línea humana que interpreta es el aviso de archivo ya descargado («has already been downloaded»), para no dar por buena una descarga que no ocurrió.

Los tramos se descargan con `--download-sections "*HH:MM:SS.mmm-HH:MM:SS.mmm"` y se guardan en una carpeta con el nombre del vídeo, con el rango como prefijo del archivo. El **máster** se conserva en la máxima calidad elegida. Después, `compat.rs` lee el máster con FFprobe y crea una **copia de edición** con nombre limpio (sin `｜`, corchetes ni paréntesis): 1080p H.264 High@4.2 CRF 18 con AAC 48 kHz estéreo y `faststart` por defecto, ProRes 422 4K o H.264 a resolución original. Los HDR se pasan a SDR BT.709 con tonemap. La copia local del editor es solo un proxy de baja resolución (hasta 480p) para previsualizar: no se usa para el corte final.

En archivos locales, `local.rs` usa FFprobe para leer la cabecera y decide la vista previa en tres pasos: reproducir el original si es compatible, remuxar a MP4 si el contenedor no vale pero los códecs sí (solo hasta 4 GB), o generar un proxy 480p con progreso. El corte final solo escribe el tramo pedido, así que un archivo de 20 GB no se copia entero. El clip se entrega en el perfil de edición elegido: si el origen es H.264 8 bits y no hay que reescalar, se copia el vídeo; en el resto de casos se recodifica (y entonces el seek de entrada es exacto al fotograma). El audio se normaliza a AAC 48 kHz estéreo, o PCM en ProRes. Los cortes de audio conservan el códec si es AAC, MP3, FLAC, ALAC o PCM; el resto pasa a AAC (M4A). Si el tramo existe, se guarda con ` (2)`, ` (3)`… sin sobrescribir.

## Limitaciones conocidas

- **Vista previa:** el modo avanzado descarga una copia local de baja resolución (hasta 480p) con audio para que el montaje se comporte como un archivo local (scrub instantáneo y teclado). Las copias se cachean y se limpian automáticamente; si no se pueden preparar, se usa el stream remoto de yt-dlp (normalmente 360p). En sitios con DRM o directos en vivo la vista previa puede no estar disponible; la línea de tiempo sigue funcionando con la duración conocida.
- **Corte en keyframe:** al copiar un origen H.264 de 1080p o menos, el clip necesita el keyframe anterior. En MP4 ese pre-roll queda oculto con timestamps negativos y la reproducción empieza en el tiempo pedido. Cuando se reescala o se recodifica (AV1, VP9, HEVC, 4K→1080p…), el corte sí es exacto.
- **Archivos locales y códecs:** MP4/MOV/WebM con H.264, VP9 o AV1 se reproducen directamente. MKV y otros contenedores se remuxan a MP4 si los códecs lo permiten; si el códec no es compatible con WebView2 (HEVC sin extensión, ProRes, DNxHD…), se genera un proxy 480p, que tarda más y ocupa espacio en la caché.
- **Audio local:** se conserva el códec si es AAC, MP3, FLAC, ALAC o PCM; el resto (Opus, Vorbis, AC3, DTS, WMA…) pasa a AAC. Los formatos exóticos pueden no abrirse en todos los reproductores ni editores.
- **Más de 1080p:** el sitio suele servir VP9/AV1 dentro del MP4. El máster se conserva en esa calidad y la copia por defecto es 1080p H.264, que Premiere 24 abre sin problemas. La opción **H.264 a resolución original** puede fallar en algunas versiones de Premiere con MP4 4K; para editar en 4K es más fiable ProRes 422.
- **Bandeja de preparación:** no se guarda al cerrar la app. Los trabajos ya exportados sí quedan en el historial.
- **Chrome/Edge en Windows:** yt-dlp no puede descifrar las cookies v20 (App-Bound Encryption) y el archivo está bloqueado con el navegador abierto. Usa Firefox o exporta `cookies.txt` con una extensión.
- **Sin firma de código:** el instalador y los binarios no están firmados. Windows SmartScreen puede mostrar advertencias.
- **Sin actualizador de la app:** por ahora hay que descargar una versión nueva del instalador. El motor de yt-dlp sí se puede actualizar desde la app.
- **Sin verificación de hash del motor:** las descargas van por HTTPS desde GitHub, pero falta validar checksums. Está pendiente.
- **Solo Windows x64.**
- La app no elimina DRM ni garantiza la disponibilidad de ningún sitio.

Descarga solo contenido propio o con permiso. El uso de la app es responsabilidad del usuario.

## Licencia

El código de ClipFetch se publica bajo la licencia MIT. Los binarios que descarga la app tienen sus propias licencias; consulta [THIRD_PARTY.md](THIRD_PARTY.md).
