# Hoja de ruta

Notas de diseño de lo ya hecho y de lo que viene. Sirve para no rehacer trabajo.

## 0.3 · Nueva interfaz (publicada el 22/10/2026)

La app pasa de una pantalla única a una mesa de corte:

- **Barra superior** con dos herramientas (Vídeo y Audio). La herramienta activa se
  comporta como una tecla de deck: LED ámbar y borde inferior encendido.
- **Raíl izquierdo** como bandeja: lo añadido se apila en «Preparado» (se puede
  arrastrar para reordenar, Alt+↑/↓ con el teclado, o quitar) y lo exportado pasa a
  «Descargas» con progreso, cancelación, reintento y «Limpiar completados».
- **Exportar** al pie del raíl: crea todos los trabajos y arranca la cola con la
  concurrencia configurada. Los borradores no se guardan al cerrar; los trabajos sí.
- **Modo simple**: calidad/formato + carpeta → «Añadir a la cola».
- **Modo avanzado** (solo vídeo suelto): monitor 16:9 con la pista pegada debajo,
  transporte con tiempo, marcar inicio/fin, loop del tramo y varios cortes antes de
  pasarlos a la cola. En audio se usa un `<audio>` con tarjeta propia y la misma pista.
- **Vídeo**: resoluciones 360p a 2160p, contenedor MP4; hasta 1080p se prefiere
  H.264/AAC. Por encima, el sitio suele servir VP9/AV1 dentro de MP4.
- **Audio**: MP3 320/256/192/128, M4A 256/128, Opus 160, FLAC, WAV y original.
- **Vista previa** con `mode: "video" | "audio"` en `preview_stream`.

Pendiente tras la publicación:

- Probar una descarga real en la app instalada (motor + YouTube) y un tramo.
- Limpiar en `App.css` los bloques de la interfaz anterior que ya no se usan
  (`.deck-head`, `.intake`, `.source-grid`, `.queue-*`, `.reel-*`…).
- Valorar persistir la bandeja si se pierde trabajo al cerrar (ahora no se guarda).

Hecho para la 0.3.0: README, hoja de ruta y versión actualizados; instalador
publicado en la release `v0.3.0`.

## 1.0 · Editor local

Decisiones de la versión 1.0:

- La vista previa del modo avanzado usa una **copia local de baja resolución
  (hasta 480p) con audio** (`preview_stream` queda como respaldo remoto). Solo
  se prepara al entrar en avanzado; en simple no se descarga nada.
- La caché vive en `%LOCALAPPDATA%\app.clipfetch.desktop\preview`, conserva las
  3 copias más recientes y se limpia sola.
- El corte final sigue descargándose de la fuente con `--download-sections` en la
  calidad elegida; el proxy no se recodifica.
- El imán (activo por defecto, `S`, `Alt` para saltarlo) atrae a la aguja, a los
  bordes de tramos preparados y a las marcas de la regla.
- La pista tiene regla con tiempos reales, límites `Entrada`/`Salida`, mínimo de
  1 s y aviso visual cuando se intenta cruzar.
- **Zoombar tipo Kdenlive** sobre la pista: la ventana sobre la barra representa
  la parte visible del vídeo. Arrastrarla recorre la línea de tiempo y arrastrar
  sus bordes hace zoom; la regla recalcula sus marcas. `Ctrl`/`Alt` + rueda también
  hace zoom y `Mayús` + rueda desplaza.
- **Atajos globales en modo avanzado**: se capturan en cualquier parte (aunque haya
  un botón enfocado), salvo al escribir en campos de texto, en selectores o en el
  panel de ajustes. `Enter` sigue activando el control enfocado.
- Atajos: `Espacio`, flechas ±1 s, `Mayús` + flechas ±10 s, `I`/`O`, `S`, `M`,
  `+`/`−` para la escala y `0` para ver todo.

Publicada como `v1.0.0` con el instalador `ClipFetch_1.0.0_x64-setup.exe`.
SHA-256: `8e4135cdf1f816c0a69090176a39ee66e97a83cf7cf53bdfcbb6e786e97d643c`.
- Se elimina «Mejor calidad»: al cargar cada vídeo se preselecciona su resolución
  máxima real (hasta 2160p) y se puede cambiar a mano. En playlists se usa 1080p
  como base.

## 1.1 · Recorte local

Decisiones de la versión 1.1:

- **Dos orígenes en las mismas herramientas**: `Enlace` y `Archivo local`. Con
  archivo local la herramienta entra directo al editor; Simple/Avanzado y los
  presets de calidad quedan solo para URL.
- **Añadir archivos**: botón del diálogo y arrastrar y soltar nativo de Tauri.
  Si se sueltan varios, se abre el primero.
- **Inspección inmediata** con FFprobe: título, duración, tamaño, resolución,
  códecs y miniatura generada con FFmpeg (cacheada en `preview-local`).
- **Vista previa en escalera**: original si el contenedor y los códecs son
  compatibles con WebView2; remux a MP4 con `-c copy` si solo falla el
  contenedor (hasta 4 GB y con AAC solo si la pista de audio no cabe); proxy
  480p con progreso si el códec no se puede reproducir o el archivo es enorme.
  El botón «Reintentar» fuerza la copia.
- **Corte rápido**: `ffmpeg -ss START -i archivo -t DURACIÓN -c:v copy
  -movflags +faststart`, con MP4; el audio se copia si cabe y, si no, se
  convierte a AAC. En códecs de vídeo que no caben en MP4 (VP9, ProRes…) se usa
  MKV con copia. Audio local: pista original (AAC→M4A, MP3→MP3, FLAC→FLAC,
  PCM→WAV, AC3/EAC3/DTS nativos, MKA como respaldo). El pre-roll del keyframe
  anterior queda oculto en MP4; en MKV/WebM puede verse.
- **Carpeta de salida**: la carpeta de descargas global, con el mismo esquema
  `<Título>/HH-MM-SS_HH-MM-SS <Título>.<ext>`. Nunca se sobrescribe: se añade
  ` (2)`, ` (3)`…
- **Cola e historial**: mismo progreso por evento (`job://progress`), cancelación
  por PID, reintento y persistencia. Los trabajos locales muestran «Cortando».

Pendiente de probar antes de publicar:

- Un MP4 H.264 grande (>4 GB), un MKV H.264, un MKV HEVC y un audio FLAC/WAV.
- Cancelar a mitad de corte y comprobar que no queda archivo parcial.
- Confirmar que el arrastre del raíl sigue funcionando con el drag & drop nativo.
- Generar el instalador, publicar la release y anotar su SHA-256.

## 1.2 · Nueva interfaz

La app pasa de la mesa de corte apilada a una interfaz de escritorio con cinco
zonas y barra de clips a la derecha.

- **Menú superior**: Archivo, Edición, Selección, Vista y Ayuda. Incluye
  deshacer/rehacer, cortar en la aguja, eliminar tramos, toggles de medios y
  barra de clips, diálogo de atajos, registro de actividad y «Acerca de».
- **Botonera izquierda**: modo Vídeo/Audio, origen Enlace/Archivo local, URL,
  calidad, precisión de corte (Exacto deshabilitado hasta validarlo) y carpeta
  de salida. La calidad ya no se atribuye a Ajustes: vive aquí.
- **Workspace central**: cabecera de fuente, monitor, transporte, herramientas
  de edición y línea de tiempo. El editor sigue siendo el dueño de `clips`,
  `selection` e historial; App mantiene un espejo de solo lectura.
- **Barra de clips derecha**: pestañas Línea de tiempo, Preparado y Descargas.
  Exportar solo procesa Preparado; los tramos se añaden antes con el botón del
  editor. La lista de tramos se sincroniza con la pista.
- **Medios**: navegador de la carpeta de salida con `list_media_dir`, filtro
  con `LOCAL_EXTENSIONS` y apertura por doble clic o Enter.
- **Layout persistente**: proporciones y visibilidad en la sección `layout` de
  `state.json`; mínimo de ventana 1280×680; medios visible a partir del mínimo.
- **Edición**: seleccionar, cortar, mover y zoom; `V/H/Z/C`, `Supr`, deshacer y
  rehacer; paso de fotograma con `,`/`.` y timecode `HH:MM:SS.FF`.
- **Navegación de medios**: doble clic en carpeta entra; Subir vuelve; el botón
  Elegir cambia solo la raíz del navegador, no la carpeta de salida.

Publicada como `v1.2.0` con el instalador `ClipFetch_1.2.0_x64-setup.exe`.
La compilación de Windows y el instalador se generaron en CI.
SHA-256: `b50168372fa3cfe27f93a7595c14f162e70060571373841786fdeaa07b7ff265`.

Pendiente de probar en la app instalada:

- Un MP4 H.264 grande, un MKV H.264, un MKV HEVC y audio FLAC/WAV.
- El corte exacto (fase de precisión) antes de habilitar el control.
- Confirmar que el drag & drop nativo no rompe el arrastre de Preparado.


## Sprint 1 (hecho)

| Punto | Qué se hizo |
| --- | --- |
| A1 | Progreso agregado por vídeo. yt-dlp avisa con `before_dl:PLAN\|%(format_id)s` cuántos archivos componen la descarga; el frontend reparte el porcentaje y la barra ya no retrocede (`src/lib/progress.ts`, evento `job://plan`). |
| A2 | Historial persistente de los últimos 60 trabajos con versionado (`src/lib/history.ts`). Los trabajos en marcha al cerrar aparecen como interrumpidos y se pueden reintentar. |
| A3 | Selector de vídeos de playlist con casillas y rangos; se traduce a `yt-dlp -I` (`src/lib/playlist.ts`). |
| A4 | Se rechaza encolar dos veces el mismo enlace mientras el primero sigue activo. |
| A5 | El análisis espera hasta 300 s y muestra el tiempo transcurrido. |
| A6 | Si el archivo ya existía (`--no-overwrites`), el trabajo se marca como «Ya existía» y conserva la ruta detectada en el registro. |
| A7 | `reveal_file` pasa la ruta como argumento separado y valida que exista. |
| A8 | Lista negra de argumentos extra que pisan el flujo interno (`--exec`, `-o`, `-P`, `--print`, `--cookies`…). |
| A9 | Las líneas de registro se agrupan cada 150 ms antes de tocar el estado (`src/lib/logBuffer.ts`). |

## B5 · Aviso de actualización de yt-dlp (hecho)

- `check_engine_update` hace `HEAD` a `.../releases/latest/download/yt-dlp.exe` sin
  seguir redirecciones y lee el tag de la cabecera `location`. No usa la API de
  GitHub, así que no consume cuota.
- Compara la versión instalada (`yt-dlp --version`) con la remota por segmentos
  numéricos, no como cadena.
- La UI muestra un botón ámbar «Actualizar» en el indicador del motor cuando hay
  una nightly nueva; al actualizar, el aviso desaparece.
- La comprobación es silenciosa y con timeout de 15 s: si falla, no molesta.
- **Pendiente menor**: solo se comprueba al arrancar o al cambiar la versión del
  motor. Cachear el resultado 6 h en `state.json` si molesta el `HEAD` diario.

## C5 · Recorte por tiempo (hecho)

Decisiones tomadas con el usuario:

- **Vista previa**: `<video>` con la URL directa de `yt-dlp -g` en un formato MP4
  combinado (normalmente 360p). No es el archivo final; sirve para situarse. Si el
  sitio solo ofrece HLS o el navegador no lo reproduce, la línea de tiempo sigue
  funcionando con la duración del análisis.
- **Varios tramos por vídeo**: lista de tramos; cada uno se encola como un trabajo
  independiente (cancelar y reintentar por separado).
- **Corte rápido**: `--download-sections "*HH:MM:SS-HH:MM:SS"` sin
  `--force-keyframes-at-cuts` (sin recodificar; puede incluir algún segundo de más
  al principio).
- **Solo vídeos sueltos**: con una playlist el editor no aparece.
- **Salida**:

```
<Carpeta de descargas>/<Título del vídeo>/
   00-01-30_00-02-45 <Título> [<id>].mp4
```

  El prefijo del tramo evita chocar con la descarga completa (que con
  `--no-overwrites` se habría marcado como «Ya existía»).
- **Anti-duplicados** (A4) compara enlace + tramo, no solo el enlace.
- Se conserva el rango en `request`, así que el historial y el reintento lo
  mantienen.


## D4 · Ajustes e historial en Rust (hecho)

- `src-tauri/src/store.rs` guarda `%LOCALAPPDATA%\app.clipfetch.desktop\state.json`
  con `{ version, sections: { settings, history } }`.
- Escritura atómica (`state.json.part` + `sync_all` + `rename`) y estado corrupto
  apartado como `state.corrupt.json` sin bloquear el arranque.
- `src/lib/persistence.ts` elige el fichero con `useFileStorage()` y cae a
  `localStorage` si los comandos no existen (por ejemplo al abrir solo el
  frontend). Las escrituras se encadenan para que dos secciones no se pisen.
- Los datos antiguos de `clipfetch.settings.v1` se migran al leerlos.
- **Pendiente menor**: limitar el tamaño del historial en Rust si algún día se
  guardan muchos más de 60 trabajos.
