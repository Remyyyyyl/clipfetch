# Hoja de ruta

Notas de diseño de lo ya hecho y de lo que viene. Sirve para no rehacer trabajo.

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
