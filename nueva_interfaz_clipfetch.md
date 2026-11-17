# ClipFetch: nueva interfaz 1.2.0

> **Estado:** especificación cerrada; pendiente de ejecución cuando el autor lo indique.
>
> **Base:** `main` en `f55e165` (PR #5), versión `1.1.0`. Antes de empezar, confirma el
> HEAD con `git log -1` y que el árbol está limpio.
>
> **Para el agente:** esta tarea **reorganiza el layout y completa lo que falta**. No
> reescribas la app. La lógica de descarga, cola, historial, motor y recorte local se
> conserva. Las decisiones de la sección 12 están cerradas: si un bloqueo técnico obliga
> a cambiarlas, documenta el motivo y pregunta antes.

---

## 1. Estado actual del proyecto

### 1.1 Stack y restricciones técnicas

| Elemento | Versión / detalle |
|---|---|
| Shell | Tauri 2 (`tauri-plugin-dialog` es el único plugin extra) |
| UI | React 19.1, TypeScript ~6.0.3, Vite 8 |
| TypeScript | `strict: true`, `noUnusedLocals`, `noUnusedParameters`. Un prop o variable sin usar rompe el build. |
| Estado | Sin librerías de estado. `useState` en `src/App.tsx` (29 usos). No añadas Zustand ni similares. |
| Persistencia | `src/lib/persistence.ts` escribe en `state.json` vía comandos Rust (`load_state` / `save_state`). |
| Fuentes | `@fontsource-variable/bricolage-grotesque` e `@fontsource/ibm-plex-mono`. |
| Verificación frontend | `npm run build` (`tsc && vite build`). |
| Verificación Rust | `cargo check` en `src-tauri`; `cargo test` cuando se añadan pruebas. |
| Desarrollo | `npm install` y `npm run tauri dev`. |
| Tests | No hay tests automáticos. Se añaden pruebas unitarias de Rust en la fase 10. |

**Cambios de PR #5 que ya están en la base:**

- El corte de audio local usa `-ss` de salida para que el clip empiece exacto.
- Las duraciones se leen con `as_f64`.
- `tauri.conf.json` incluye `preview-local` en el scope de `assetProtocol`.
- Los tamaños de ventana siguen en `width: 1280`, `height: 840`, `minWidth: 1080`,
  `minHeight: 680`. La nueva interfaz sube `minWidth` a **1280** y deja `minHeight` en
  **680** (sección 3.2).

### 1.2 Componentes que ya existen

| Archivo | Qué hace hoy |
|---|---|
| `src/components/TopBar.tsx` | Marca «ClipFetch», pestañas **Vídeo / Audio** (`role="tablist"`), `EngineStatus` y botón **Ajustes**. Desaparece en la fase 3. |
| `src/components/QueueRail.tsx` | Raíl **izquierdo** con **Preparado** (arrastrar para reordenar, Alt+↑/↓, quitar) y **Descargas** (progreso, cancelar, reintentar, abrir carpeta, revelar archivo, limpiar completados). Pie con actividad y **Exportar**. Se convierte en `ClipsPanel` y se mueve a la derecha. |
| `src/components/ToolWorkspace.tsx` | Cabecera de herramienta, conmutador **Simple / Avanzado**, **Enlace / Archivo local**, URL, selector de calidad, carpeta de salida, botón de añadir a la cola, bloque de fuente, selector de playlist y el editor. Se reparte entre `ControlPanel` y `Workspace`. |
| `src/components/TimelineEditor.tsx` (1559 líneas) | Editor completo: monitor (`tl-monitor`, `tl-overlay`, `tl-audio-card`), transporte (`tl-transport`, `tl-play`, `tl-marks`, `tl-volume`), zoombar (`tl-scale`, `tl-zoombar-*`), pista (`tl-track-view`, `tl-ruler`, `tl-clip-block`, `tl-selection`, `tl-playhead`, tiradores), lista de tramos (`tl-list`) y acciones (`tl-actions`). **Es el dueño de `clips`, `start`, `end`, `current`, `zoom`, `snap`, `volume` y del manejador de atajos.** Se queda como componente central; se le añaden selección, herramienta e historial. |
| `src/components/SettingsDrawer.tsx` | Panel de ajustes: carpeta, concurrencia, límite de velocidad, cookies y argumentos extra. **No contiene calidad ni presets.** La calidad vive en `ToolWorkspace` y se guarda en `settings.preset` / `settings.audioPreset`. |
| `src/components/EngineStatus.tsx` | Indicador del motor, actualización de yt-dlp. `min-height: 38px`. |
| `src/components/SetupScreen.tsx`, `Notice.tsx`, `Icon.tsx` | Instalación, avisos e iconos SVG. |
| `src/lib/timeline.ts` | `clamp`, `buildRulerTicks`, `findSnap`, `formatRulerTime`, `isEditableTarget`. |
| `src/lib/history.ts`, `progress.ts`, `playlist.ts`, `logBuffer.ts`, `settings.ts`, `format.ts`, `local.ts` | Historial versionado, progreso agregado, selector de playlist, agrupación de logs, ajustes, formatos (`VIDEO_PRESETS`, `AUDIO_PRESETS`) y helpers de archivos locales (`LOCAL_EXTENSIONS`, `LOCAL_PRESET`). |

### 1.3 Comandos de Tauri disponibles

Úsalos tal cual. No inventes nombres nuevos sin necesidad.

| Comando | Archivo Rust | Uso |
|---|---|---|
| `engine_status`, `install_engine`, `update_ytdlp`, `check_engine_update` | `engine.rs` | Motor |
| `analyze_url` | `jobs.rs` | Análisis de URL con yt-dlp |
| `start_download`, `cancel_download` | `jobs.rs` | Cola de descargas |
| `preview_stream` | `jobs.rs` | Stream remoto de respaldo |
| `prepare_preview`, `cancel_preview` | `preview.rs` | Copia local 480p de una URL |
| `inspect_local` | `local.rs` | FFprobe: título, duración, códecs, miniatura |
| `prepare_local_preview`, `cancel_local_preview` | `local.rs` | Vista previa de archivo local (original, remux o proxy) |
| `start_local_cut` | `local.rs` | Corte rápido con FFmpeg |
| `load_state`, `save_state` | `store.rs` | `state.json` |
| `default_download_dir`, `open_folder`, `reveal_file` | `lib.rs` | Utilidades de carpetas |

**Tipos relevantes** (`src/types.ts`):

- `ToolKind = "video" | "audio"` y `SourceKind = "url" | "file"`.
- `StagedItem`: elemento de **Preparado**. Incluye `clip: { start, end } | null`.
- `DownloadRequest`: `clipStart` y `clipEnd` son `number | null`; en Rust son
  `Option<u32>`. Se documentan como segundos enteros.
- `LocalCutRequest` (`local.rs`): `clip_start` y `clip_end` son `u32`.
- `Clip { id, start, end }`: tramo de la línea de tiempo.
- `PreviewState`: `status` (`idle | loading | ready | error`), `url`, `progress`, `local`.
- `PreviewFile`: `path`, `kind`, `cached`. No incluye `fps`.
- `LocalMedia`: no incluye `fps`.
- `YtDlpFormat.fps?: number | null`: la frecuencia de fotogramas ya llega para URL.

### 1.4 Atajos que ya existen (no los rompas)

Del manejador global de `TimelineEditor` (solo activo en modo avanzado) y del README:

- `Espacio`: reproducir o pausar.
- `←` / `→`: ±1 s.
- `Mayús` + `←` / `→`: ±10 s.
- `Inicio` / `Fin`: ir al principio o al final.
- `I` / `O`: marcar entrada o salida.
- `S`: imán. `Alt` lo salta al arrastrar.
- `M`: silencio.
- `+` / `−`: escala. `0`: ver todo. `Ctrl`/`Alt` + rueda: zoom. `Mayús` + rueda: desplazar.
- En `Preparado`: `Alt+↑/↓` reordena.

**Precisiones importantes:**

- `↑` / `↓` **no** mueven la aguja globalmente. Solo funcionan sobre los tiradores
  `Entrada`/`Salida` cuando tienen el foco. El handler global solo trata `←`, `→`,
  `Inicio` y `Fin`.
- El handler global ignora eventos con `Ctrl`, `Meta` o `Alt`, ignora campos editables
  (`isEditableTarget`) y se desactiva si hay un `.drawer-layer` abierto.
- Los nuevos atajos con `Ctrl` necesitan un handler aparte (sección 5).

### 1.5 Propiedad del estado del editor

Esto condiciona las fases 4 a 8. **`TimelineEditor` sigue siendo la fuente de verdad**
de `clips`, `selectedClipIds`, historial, reproducción, zoom, herramienta y `snap`.
`App.tsx` guarda un **espejo de solo lectura** para el menú y la barra de clips:

- `clipSnapshot: Clip[]`
- `clipSelection: string[]`
- `history: { canUndo: boolean; canRedo: boolean }`
- `editorRef` con las acciones (sección 6).

Regla: `App.tsx` nunca modifica esos arrays. Toda mutación se hace con el ref y el editor
notifica el resultado. Si se permite que `ClipsPanel` o `MenuBar` muten el array
directamente, vuelven las dos fuentes de verdad.

El monitor **no se separa en otra área del grid**. La columna central es un único
`Workspace` y el monitor vive dentro de `TimelineEditor` (sección 4.3).

---

## 2. Lo que la captura pide frente a lo que hay hoy

| Zona de la captura | Estado | Equivalente en el código | Acción |
|---|---|---|---|
| **Menú superior** (Archivo, Edición, Selección, Vista, Ayuda) | **No existe** | `TopBar` solo tiene marca, pestañas, motor y ajustes | Crear `MenuBar.tsx`. Mover aquí marca, `EngineStatus` y **Ajustes**. |
| **Botonera principal** | **Parcial** | Pestañas en `TopBar`; conmutadores, URL, calidad y carpeta en `ToolWorkspace` | Crear `ControlPanel.tsx` (sección 4.2). |
| Modo vídeo / audio | **Existe** | Pestañas `tool-key` en `TopBar` | Mover a la botonera. |
| Calidad | **Existe** | `select` con `VIDEO_PRESETS` / `AUDIO_PRESETS` en `ToolWorkspace` | Mover a la botonera. |
| Precisión de frames | **No existe** | Solo corte por keyframe o segundos enteros | Añadir control deshabilitado hasta la fase 10 (sección 7). |
| Modo vídeo local o descarga | **Existe** | Conmutador `Enlace / Archivo local` | Mover a la botonera. |
| **Previsualización de vídeo** | **Existe** | Monitor de `TimelineEditor` (`tl-monitor`, `tl-overlay`) | Se queda dentro de `TimelineEditor`; no se extrae a otra área. |
| **Barra de clips** (a la derecha) | **Existe a la izquierda** | `QueueRail` (`.rail`) | Mover a la derecha y añadir la pestaña de tramos. |
| **Medios** (navegador de carpetas) | **No existe** | Solo `read_dir` interno en Rust, no expuesto | Crear `MediaBrowser.tsx` y `list_media_dir` (sección 4.7). |
| **Herramientas de previsualización** | **Parcial** | Play, Inicio/Fin por teclado, ±1 s, marcas, loop, volumen | Añadir botones de inicio/fin y paso de frame (fase 8). |
| **Herramientas de edición** | **No existe** | Solo imán y botones de marca | Crear `EditTools.tsx` (sección 4.4). |
| Franja verde clara | **Existe** | `tl-scale` (zoombar) | Reutilizar. |
| Franja verde oscura | **Existe** | `tl-ruler` + tiradores `Entrada`/`Salida`. Visualmente incluye la zona de `tl-selection`, `tl-min-gap` y `tl-snap-guide`, pero esos elementos están en `tl-track-view`, no en la regla. | Reutilizar; no cambiar el DOM por la correspondencia visual. |
| Franja verde brillante | **Existe** | `tl-track-view` con un `tl-clip-block` por tramo guardado, `tl-selection` y `tl-playhead` | Reutilizar. Solo hay una pista. |
| Espacio blanco inferior | **No existe** | — | Reservar espacio para pistas futuras; no funcional. |
| — | **Existe, no está en la captura** | `tl-list`, `tl-actions`, `tl-foot` | Conservar. La lista se mueve a `ClipsPanel`; las acciones se quedan. |
| — | **Existe, no está en la captura** | Ajustes (`SettingsDrawer`) | Conservar; abre desde el menú. |

**Conclusión:** de las zonas de la captura, la mitad ya existen con otro nombre o en otra
posición. Pero el trabajo nuevo real no son cuatro cosas: menú, medios, herramientas de
edición, navegación por frame, modo Exacto, deshacer/rehacer, selección y movimiento de
tramos, persistencia del layout y adaptación de la barra de clips. La sección 8 lo ordena.

---

## 3. Layout objetivo

### 3.1 Esquema de áreas (CSS Grid)

El layout exterior tiene **cinco áreas**: menú, botonera, workspace central, medios y
barra de clips. El monitor, el transporte y la línea de tiempo son filas internas del
workspace, no áreas del grid exterior.

```css
.app-shell {
  display: grid;
  height: 100vh;
  grid-template-columns: minmax(240px, 15%) minmax(0, 1fr) minmax(300px, 26%);
  grid-template-rows: 44px minmax(0, 1.6fr) minmax(0, 0.9fr);
  grid-template-areas:
    "menu     menu      menu"
    "botonera workspace clips"
    "medios   workspace clips";
  overflow: hidden;
}
```

- `menu`: 44 px. No 32: `EngineStatus` mide 38 px y necesita aire.
- `botonera`: ~15 % de ancho y ~64 % de la altura útil.
- `medios`: ~15 % de ancho y ~36 % de la altura útil.
- `workspace`: columna central; ocupa las filas 2 y 3.
- `clips`: columna derecha; ocupa las filas 2 y 3.

A 1280 px de ancho las columnas quedan aproximadamente en **240 / 707 / 333 px**.
A 1920 px, en **288 / 1133 / 499 px**.

**Workspace interno:**

```css
.workspace {
  grid-area: workspace;
  display: grid;
  grid-template-rows: auto minmax(0, 1.6fr) 6px auto minmax(0, 0.9fr);
  min-height: 0;
  overflow: hidden;
}
```

Filas: cabecera de fuente (`auto`), monitor (`1.6fr`), divisor (`6px`), transporte
(`auto`, unos 64-72 px) y línea de tiempo (`0.9fr`). El divisor reparte el espacio entre
monitor y línea de tiempo; el transporte no se redimensiona.

**Variantes del grid.** No uses `display: none` dejando un hueco: cambia la plantilla.

```css
/* Medios oculto desde Vista */
.app-shell.is-media-hidden {
  grid-template-rows: 44px minmax(0, 1fr);
  grid-template-areas:
    "menu     menu      menu"
    "botonera workspace clips";
}

/* Barra de clips oculta desde Vista */
.app-shell.is-clips-hidden {
  grid-template-columns: minmax(240px, 15%) minmax(0, 1fr);
  grid-template-areas:
    "menu     menu"
    "botonera workspace"
    "medios   workspace";
}

/* Ambas ocultas */
.app-shell.is-clips-hidden.is-media-hidden {
  grid-template-columns: minmax(240px, 15%) minmax(0, 1fr);
  grid-template-rows: 44px minmax(0, 1fr);
  grid-template-areas:
    "menu     menu"
    "botonera workspace";
}
```

Cuando la barra de clips está oculta, deja un botón **«Cola (N)»** en la derecha del menú
para volver a abrirla; si no, Exportar queda inaccesible.

### 3.2 Requisitos del layout

- **Ventana mínima: 1280 × 680.** Tamaño por defecto: 1280 × 840. Referencia de diseño:
  1280 × 720 y 1920 × 1080. No se sube el alto a 720: en portátiles de 1366 × 768, 720 px
  de cliente más la barra de título no caben con la barra de tareas visible.
- **Medios se muestra siempre** a partir del mínimo. No se oculta por ancho; solo se
  oculta desde **Vista** o cuando el usuario lo decide. No hay regla de «por debajo de
  1280 se oculta».
- La barra de clips a la derecha **reemplaza** al raíl izquierdo. `QueueRail` deja de
  ocupar la columna izquierda.
- El menú superior ocupa las tres columnas. `TopBar` desaparece como componente; su
  contenido se reparte entre `MenuBar` y `ControlPanel`.
- La botonera tiene scroll interno y un pie sticky con **Añadir a la cola** para que el
  botón no quede fuera de pantalla a 680 px de alto.
- Cada área contiene su propio `overflow`; no hay scroll en `.app-shell`.
- Usa `position: sticky` solo dentro de áreas con scroll.
- No añadas una librería de paneles. Los divisores son `onPointerDown` /
  `onPointerMove` / `onPointerUp` con captura de puntero.
- Divisores: dos verticales (botonera/workspace y workspace/clips) y dos horizontales
  (botonera/medios y monitor/línea de tiempo; este último va antes del transporte).
  Mínimos: 240 px para la columna izquierda, 280 px para clips, 420 px para workspace;
  120 px para monitor y 120 px para timeline.

### 3.3 Persistencia del layout

`store.rs` ya es genérico (`HashMap<String, Value>`), así que **no hay que tocar Rust**.
Solo hay que ampliar `src/lib/persistence.ts`:

- `Section = "settings" | "history" | "layout"`.
- Añadir `"layout"` a `SECTIONS` y `LOCAL_KEYS`.
- Guardar un objeto versionado con proporciones y visibilidad:

```ts
interface LayoutState {
  columns: { left: number; right: number }; // porcentajes
  rows: { top: number };                    // botonera frente a medios
  workspace: { monitor: number };           // monitor frente a timeline
  mediaVisible: boolean;
  clipsVisible: boolean;
}
```

- Guarda al soltar el puntero, no en cada `pointermove`.
- Al leer, valida y recorta a los mínimos; si falta o está corrupto, aplica los valores
  por defecto.
- **Restablecer disposición** del menú Vista vuelve a los valores por defecto.
- No uses `localStorage` directamente; `persistence.ts` ya hace el respaldo.

---

## 4. Descripción detallada de cada zona

### 4.1 Menú superior (`MenuBar.tsx`, área `menu`)

Barra de **44 px** con marca a la izquierda, menús desplegables en el centro-derecha,
`EngineStatus` y **Ajustes** a la derecha. Cada opción muestra su atajo a la derecha.

| Menú | Opciones | Comportamiento |
|---|---|---|
| **Archivo** | Abrir archivo local · Analizar URL · Exportar cola · Limpiar completados · Salir | «Abrir archivo local» cambia a origen Archivo y abre el diálogo; «Analizar URL» cambia a origen Enlace, enfoca la URL y analiza si hay texto; ambos confirman si hay tramos en el editor. «Exportar cola» solo procesa `staged`. «Salir» confirma si hay trabajos activos. |
| **Edición** | Deshacer · Rehacer · Cortar en la aguja (`C`) · Eliminar tramo (`Supr`) · Marcar entrada / salida | Deshacer/Rehacer usan `canUndo`/`canRedo` del editor. Cortar y Eliminar se deshabilitan si no hay tramo aplicable. |
| **Selección** | **Playlist:** Todos / Ninguno / Invertir · **Tramos:** Todos / Ninguno / Invertir | Dos grupos separados; se deshabilita el que no aplica. No mezcles la selección de playlist (`Set<number>`) con la de tramos (`Set<string>`). |
| **Vista** | Mostrar u ocultar barra de clips · Mostrar u ocultar medios · Ver toda la línea de tiempo (`0`) · Restablecer disposición | Los toggles cambian la plantilla del grid. «Ver todo» llama a `editorRef.fitView()`. |
| **Ayuda** | Atajos de teclado · Registro de actividad · Acerca de | Los atajos abren un diálogo con la sección 5. El registro muestra el `job.log` del trabajo seleccionado (selector); no hace falta un buffer global nuevo. «Acerca de» usa `__APP_VERSION__`. |

- `EngineStatus` y Ajustes siguen a la derecha; el botón de Ajustes se oculta si el motor
  no está instalado, como hoy.
- La marca «ClipFetch» (icono + nombre) va a la izquierda del menú.
- Accesibilidad: `role="menubar"`, `role="menu"`, `role="menuitem"`, foco móvil con
  flechas, `Escape` cierra y devuelve el foco, clic fuera cierra. No dejes menús abiertos
  mientras se disparan atajos globales.

### 4.2 Botonera principal (`ControlPanel.tsx`, área `botonera`)

Sustituye a la cabecera de `ToolWorkspace` y a las pestañas de `TopBar`. De arriba abajo:

1. **Modo**: conmutador Vídeo / Audio. Mantén `role="tablist"`, `aria-selected` y
   `aria-controls` apuntando al panel del workspace.
2. **Origen**: conmutador **Enlace / Archivo local** (`source-switch`). Con archivo local
   se entra siempre al editor.
3. **Campo de URL** (solo Enlace): `url-row` con botón **Analizar**. Al analizar se
   preselecciona la resolución máxima (`bestVideoPreset`).
4. **Calidad** (solo Enlace): `select` con `VIDEO_PRESETS` o `AUDIO_PRESETS`. Se guarda en
   `settings.preset` / `settings.audioPreset`. **No está en `SettingsDrawer`.**
5. **Precisión de corte**: **Rápido (keyframe)** por defecto; **Exacto** deshabilitado con
   «Próximamente» hasta la fase 10. No prometas cortes exactos en la fase 8.
6. **Carpeta de salida**: campo con botón de carpeta. Reutiliza `settings.outputDir` y
   `pickFolder`.
7. **Añadir a la cola**: **solo en modo simple**. En avanzado, el único camino es el botón
   «Añadir N tramos a la cola» del editor. En local no se muestra; se usan los tramos.

**Modo simple vs avanzado:** el conmutador vive en la botonera, bajo el origen. Con
archivo local se oculta (siempre avanzado). Con playlist se fuerza simple y se deshabilita
avanzado. El selector de playlist **no** va aquí: vive en el workspace (sección 4.3).

**Modo de vista previa:** se elimina el conmutador de «Copia local / Stream remoto» para
1.2.0. La app sigue eligiendo automáticamente: `prepare_preview` y, si falla,
`preview_stream`. El monitor muestra el badge resultante. No añadas una opción que hoy no
existe.

**Scroll:** la botonera puede superar la altura disponible a 680 px. Usa scroll interno y
un pie sticky con el botón de añadir. No comprimas los controles hasta hacerlos ilegibles.

### 4.3 Workspace central (`Workspace.tsx`, área `workspace`)

Es el único componente de la columna central. Contiene:

- **Cabecera de fuente**: título, uploader/canal, duración, badges de origen y formato.
  En simple puede mostrar la miniatura grande; en avanzado, una versión compacta.
- **Modo simple**: miniatura/póster, metadatos y selector de playlist si es una playlist.
  No se prepara copia local ni se muestra el editor; un texto indica «Cambia a Avanzado
  para editar».
- **Modo avanzado**: `TimelineEditor` completo (monitor, transporte, regla, pista).

**Monitor (dentro de `TimelineEditor`):**

- `<video>` o `<audio>` según la herramienta. En audio, tarjeta `tl-audio-card` con
  miniatura/icono y título.
- Superposición mínima: timecode actual `HH:MM:SS.FF` y duración total. Badge de modo con
  los textos actuales: **Copia local**, **Stream remoto**, **Archivo local**, **Audio
  local**, **Audio remoto**.
- Estado vacío: «Pega una URL o abre un archivo para empezar».
- Estado de carga: `tl-progress` sobre el monitor, sin bloquear la interfaz. Usa
  `describePreviewProgress` y los estados de `PreviewState`.
- Avisos existentes, con su texto actual:
  - «El navegador no pudo reproducir este archivo. Puedes marcar tramos igualmente o
    preparar una copia compatible (puede tardar).»
  - «El navegador no pudo reproducir esta vista previa. Los tramos se pueden marcar
    igual.»
  - «Se reproduce el archivo del disco. El vídeo se guarda sin recodificar; el audio se
    copia o pasa a AAC si no cabe.»
- El monitor **no** se extrae a otra área del grid. Si se crea `Monitor.tsx`, es un hijo
  presentacional de `TimelineEditor`; el `<video>`, `mediaRef`, `seek`, `togglePlay` y
  `mediaEvents` se quedan en el padre.
- La navegación por fotograma (fase 8) usa el `fps` del preview; si no hay dato, 30 fps y
  un aviso breve. Solo aplica a vídeo; en audio, `,` y `.` no hacen nada.

### 4.4 Transporte y herramientas de edición

**Transporte** (`tools`, franja sobre la línea de tiempo), de izquierda a derecha:

| Control | Estado | Acción |
|---|---|---|
| Ir al inicio | Existe por teclado (`Home`) | Añadir botón. |
| Frame anterior (`,`) | **Nuevo** | Fase 8; solo vídeo. |
| Reproducir / pausar (`tl-play`) | Existe | Reutilizar. |
| Frame siguiente (`.`) | **Nuevo** | Fase 8; solo vídeo. |
| Ir al final | Existe por teclado (`End`) | Añadir botón. |
| Marcar entrada `I` / salida `O` | Existe (`tl-marks`) | Reutilizar. |
| Repetir (`loop`) | Existe como «Loop» | Reutilizar; renombrar a «Repetir» para cumplir el español. |
| Volumen y silencio (`M`) | Existe (`tl-volume`) | Reutilizar. |
| Timecode | Existe (`tl-selection-readout`) | Reutilizar; añadir frames en fase 8. |

**Herramientas de edición** (`EditTools.tsx`, columna vertical a la izquierda de la pista):

1. **Seleccionar (`V`)**: modo por defecto. Clic en un tramo lo selecciona y lleva la
   aguja a su inicio; arrastrarlo lo mueve. Clic en zona vacía busca y limpia la selección.
2. **Cortar en la aguja (`C`)**: divide el tramo seleccionado que contiene la aguja; si no
   hay selección, el tramo bajo la aguja con inicio más tardío. Exige al menos 1 s a cada
   lado; si no, parpadea el aviso y no corta. Crea dos tramos nuevos y deja seleccionado el
   izquierdo.
3. **Imán (`S`)**: conmutador existente.
4. **Mover (`H`)**: arrastra la vista horizontal sin mover la aguja. El clic no busca.
5. **Zoom (`Z`)**: clic acerca en el punto pulsado; `Alt` + clic aleja. Equivale a `+` y
   `−`, pero centrado en el clic.

- El botón activo se resalta con el estilo de `tool-key` (LED y borde).
- El cursor de la pista cambia según la herramienta.
- Todos los botones tienen `aria-pressed` y nombre accesible.
- `V`, `H` y `Z` no se capturan al escribir en campos de texto (`isEditableTarget`).

### 4.5 Línea de tiempo (`timeline`, zona inferior central)

Tres franjas, de arriba abajo:

1. **Franja clara = zoombar** (`tl-scale`). La ventana sobre la barra representa la parte
   visible; arrastrar recorre, los bordes hacen zoom. Ya funciona.
2. **Franja oscura = regla y tiradores** (`tl-ruler`, `tl-selection`, `tl-min-gap`,
   `tl-snap-guide`). La correspondencia es visual: `tl-selection`, `tl-min-gap` y
   `tl-snap-guide` están en `tl-track-view`, no en el DOM de la regla.
3. **Franja brillante = pista** (`tl-clip-block`, `tl-playhead`). Un bloque por tramo
   guardado, más la selección de trabajo. Solo hay una pista.

**Cambios:**

- La herramienta activa modifica el clic: Seleccionar, Cortar, Mover o Zoom.
- La **lista de tramos** (`tl-list`) sale de aquí y pasa a `ClipsPanel`.
- El **pie** (`tl-foot`) con el aviso de imán se queda bajo la pista. Si no cabe, se oculta
  y la lista completa se ve en **Ayuda > Atajos**.
- Las **acciones** (`tl-actions`) se quedan: «Añadir tramo» y «Añadir N tramos a la cola»
  (esto último llama a `stageClips`). `Exportar` no está aquí; está en `ClipsPanel`.
- Reserva espacio vertical para pistas futuras, pero no implementes varias pistas.
- La selección de tramos es un `Set<string>`; clic selecciona, `Ctrl` alterna, `Mayús`
  selecciona rango. La pista y la lista de `ClipsPanel` comparten esa selección.

### 4.6 Barra de clips (`ClipsPanel.tsx`, columna derecha)

Evolución de `QueueRail`, movida a la derecha, con **tres pestañas**:

| Pestaña | Contenido | Origen |
|---|---|---|
| **Línea de tiempo** | Tramos del editor actual: inicio, fin, duración. Seleccionar resalta en la pista; eliminar borra el tramo. No añade tramos. | `tl-list` movido. |
| **Preparado** | Elementos listos para exportar, con reordenar (`Alt+↑/↓`), quitar y arrastrar. | `QueueRail` sección «Preparado». |
| **Descargas** | Trabajos en curso y terminados: progreso, cancelar, reintentar, abrir carpeta, revelar archivo y **Limpiar completados**. | `QueueRail` sección «Descargas». |

- **Pie:** actividad («N en curso») y botón **Exportar** (`rail-export`). **Solo exporta
  `staged`**; no incluye tramos del editor directamente. Para eso hay que pulsar antes
  «Añadir N tramos a la cola» en el editor. Corrige la idea de que Exportar ya lo hace
  hoy: hoy no lo hace.
- **Selección sincronizada:** el editor es la fuente de verdad. `ClipsPanel` recibe el
  espejo y llama a `editorRef.selectClip`, `deleteClip`, etc. Al seleccionar en la lista,
  haz `scrollIntoView` del tramo en la pista si es posible.
- **Modo simple:** la pestaña «Línea de tiempo» se oculta o se deshabilita con un aviso.
  Los tramos se conservan si el editor sigue montado; al volver a avanzado reaparecen.
- **Barra oculta:** botón «Cola (N)» en el menú para reabrirla; el pie de exportación no
  debe quedar inaccesible.
- Los logs de cada trabajo se ven en **Ayuda > Registro de actividad**; no añadas logs
  inline en la barra si no son necesarios.

### 4.7 Medios (`MediaBrowser.tsx`, área `medios`)

Navegador de carpetas del disco, en la columna izquierda inferior.

- **Raíz:** `settings.outputDir` al abrir. El botón **Elegir carpeta** cambia **solo la
  raíz del navegador**, no `settings.outputDir`; si el usuario quiere usar otra carpeta
  como salida, que la cambie en la botonera o en Ajustes. Cuando cambie `outputDir`, la
  raíz del navegador vuelve a él.
- **Navegación:** breadcrumb y botón **Subir**. Doble clic o `Enter` en una carpeta entra;
  `Backspace` o `Alt+←` sube. No hay recursión.
- **Contenido:** subcarpetas y archivos. Filtra en TypeScript con `LOCAL_EXTENSIONS`
  (`src/lib/local.ts`), que ya incluye `mp4, m4v, mkv, webm, mov, avi, flv, wmv, ts, m2ts,
  mts, mpg, mpeg, 3gp, ogv, mp3, m4a, aac, wav, flac, ogg, oga, opus, wma, aiff, aif,
  alac, ac3, eac3, dts`. No dupliques la lista en Rust.
- **Filas:** nombre, tamaño y fecha de modificación. **No prometas duración** en 1.2.0:
  `list_media_dir` no la devuelve y no se va a llamar a FFprobe por cada archivo. Si se
  quiere más adelante, se añade un comando ligero o se lee al seleccionar.
- **Abrir archivo:** doble clic o `Enter` cambia `source` a `file`, confirma si hay tramos
  y llama a `inspect_local`; el editor se abre en avanzado. No reutilices solo
  `inspectLocalFile`: esa función no cambia `source`.
- **Sin arrastre HTML5 desde Medios.** El drag & drop nativo de Tauri y el arrastre del
  raíl conviven mal; la hoja de ruta lo marca como pendiente de probar, no el README. Usa
  doble clic y `Enter`.
- **Comando nuevo:** `list_media_dir(path: String) -> Vec<MediaEntry>` en `browse.rs`.
  Devuelve `{ name, path, isDir, size, modified }` con `#[serde(rename_all =
  "camelCase")]`. Ordena carpetas primero y luego por nombre; ignora archivos ocultos
  (nombres que empiezan por `.`). Errores de permisos se muestran en un `Notice` y no
  rompen la navegación.
- **Permisos:** no hay plugin `fs`; el acceso va por comando Rust. No hace falta tocar
  `capabilities/default.json` (el diálogo ya tiene `dialog:default`).
- Las copias de caché (`preview`, `preview-local`) no se muestran: viven fuera de las
  carpetas del usuario.

---

## 5. Atajos de teclado

Los actuales se conservan. Esta tabla añade los nuevos.

| Atajo | Acción | Estado |
|---|---|---|
| `Espacio` | Reproducir / pausar | Existe |
| `←` / `→` | ±1 s | Existe |
| `Mayús` + `←` / `→` | ±10 s | Existe |
| `,` / `.` | Frame anterior / siguiente | **Nuevo**, fase 8, solo vídeo |
| `Inicio` / `Fin` | Ir al principio / al final | Existe |
| `I` / `O` | Marcar entrada / salida | Existe; no crean un tramo |
| `C` | Cortar en la aguja | **Nuevo** |
| `V` / `H` / `Z` | Herramienta Seleccionar / Mover / Zoom | **Nuevo** |
| `S` | Imán | Existe |
| `M` | Silencio | Existe |
| `+` / `−` / `0` | Escala y ver todo | Existe |
| `Supr` | Eliminar tramos seleccionados | **Nuevo** |
| `Ctrl+Z` / `Ctrl+Y` | Deshacer / rehacer | **Nuevo** |
| `Ctrl+A` | Seleccionar todo en el panel con foco | **Nuevo** |
| `Ctrl+Enter` | Añadir la selección a Preparado | **Nuevo** |

**Alcance de los atajos:**

- Los atajos actuales del editor siguen siendo globales mientras el editor esté visible
  en avanzado. Ignóralos si el editor está oculto en simple.
- Los nuevos `Ctrl+…` van en un **handler aparte**, porque el actual descarta
  `Ctrl`/`Meta`/`Alt`. Ese handler solo se activa con el editor visible y el foco dentro
  del editor o de la barra de clips.
- Ignora todos los atajos si hay un menú o un diálogo abierto, o si el foco está en un
  campo editable (`isEditableTarget`).
- `Ctrl+A` actúa sobre el panel con foco: la pista/lista de tramos si el foco está ahí, o
  la playlist si el foco está en el selector. Si no hay foco claro, actúa sobre los
  tramos en avanzado.
- No cambies `←` / `→`: siguen siendo ±1 s.

---

## 6. Estado del editor, selección y deshacer

### 6.1 Fuente de verdad

`TimelineEditor` posee:

- `clips: Clip[]`
- `selectedClipIds: Set<string>`
- historial de deshacer/rehacer de `clips`
- `start`, `end`, `current`, `playing`, `zoom`, `viewStart`, `snap`, `tool`, `volume`,
  `muted`, `loop`, `mediaFailed`

`App.tsx` guarda el espejo de solo lectura descrito en 1.5. No lo muta nunca.

### 6.2 Ref del editor

```ts
interface EditorHandle {
  cutAtPlayhead(): void;
  deleteSelectedClips(): void;
  deleteClip(id: string): void;
  selectClip(id: string, mode?: "replace" | "toggle" | "range"): void;
  selectAllClips(): void;
  clearClipSelection(): void;
  invertClipSelection(): void;
  undo(): void;
  redo(): void;
  fitView(): void;
  stageAllClips(): void;
  focus(): void;
}
```

Callbacks:

- `onClipsChange(clips: Clip[])`
- `onClipSelectionChange(ids: string[])`
- `onHistoryChange(state: { canUndo: boolean; canRedo: boolean })`

`onHistoryChange` es obligatorio para habilitar Deshacer/Rehacer en el menú. Emite también
`onClipsChange([])` y `onClipSelectionChange([])` cuando se cambia de fuente.

### 6.3 Selección

- `Set<string>`; clic selecciona uno, `Ctrl`/`Cmd` alterna, `Mayús` selecciona rango.
- Eliminar borra todos los seleccionados.
- Mover solo con una selección única; el arrastre se confirma al soltar.
- Cortar actúa sobre el tramo seleccionado que contiene la aguja; si no hay selección, el
  tramo bajo la aguja con inicio más tardío. Si no hay ninguno o queda menos de 1 s a cada
  lado, no corta.
- La selección no es undoable.

### 6.4 Historial

- Solo `clips`. No incluye herramienta, imán ni selección.
- Límite: 100 pasos.
- Cada arrastre cuenta como un cambio, al soltar el puntero.
- Añadir, cortar, eliminar y mover empujan un snapshot.
- Al cambiar de fuente se vacía. Si hay tramos, confirma antes de cambiar de fuente.
- `stageAllClips` añade a `Preparado`, limpia `clips` y **vacía el historial** para que
  deshacer no vuelva a añadir duplicados.
- Si el editor se desmonta (por ejemplo, una playlist), App limpia el espejo y el
  historial.

### 6.5 Modo simple

- El editor se queda **montado y oculto** para la misma fuente.
- Se pausa la reproducción y se desactivan los atajos (`active={mode === "advanced"}`).
- El workspace muestra la cabecera de fuente y el selector de playlist; no se prepara
  vista previa.
- `ClipsPanel` oculta la pestaña «Línea de tiempo».
- Al volver a avanzado, tramos, selección e historial siguen ahí.
- Cambiar de herramienta con la misma fuente conserva los tramos. Cambiar de fuente los
  borra.

---

## 7. Frames y precisión de corte

### 7.1 Fase 8: navegación por fotograma (sin cortes exactos)

Objetivo: moverse por frames y mostrar el timecode con frames, sin tocar todavía los
tiempos de corte.

- Añadir un comando Rust `probe_fps(path: String) -> Result<Option<f64>, String>` en
  `local.rs`. Usa FFprobe sobre el archivo de preview (proxy, remux u original) y lee
  `avg_frame_rate` o `r_frame_rate`. No toques `preview.rs`.
- `App.tsx` llama a `probe_fps` cuando `prepare_preview` / `prepare_local_preview`
  devuelven una ruta; guarda `fps` en `PreviewState` (campo opcional nuevo en `types.ts`)
  y lo pasa a `TimelineEditor`.
- Si no hay `fps` (stream remoto o audio), usa 30 fps y muestra un aviso breve. Para audio,
  deshabilita `,`/`.` y los botones de frame.
- Timecode `HH:MM:SS.FF` en el monitor y en la lectura de selección.
- `,` / `.` mueven `current` por `1 / fps`, con clamp a `[0, total]`.
- `I`/`O` y los tramos **siguen en segundos enteros** en esta fase. La fase 8 es
  navegación, no precisión. El control «Precisión de corte» sigue deshabilitado.

### 7.2 Fase 10: modo Exacto (backend incluido)

Esta fase es la única que cambia la lógica de recorte. No la conviertas en
predeterminada.

**Tipos y plumbing:**

- Añadir `precise: boolean` a `StagedItem`, `DownloadRequest` y `LocalCutRequest`.
- `DownloadRequest.clip_start` / `clip_end` pasan de `Option<u32>` a `Option<f64>`.
- `LocalCutRequest.clip_start` / `clip_end` pasan de `u32` a `f64`.
- `Clip.start` / `Clip.end` pueden ser fraccionarios.
- La detección de duplicados incluye `precise`.
- El historial persistido acepta `precise` como opcional (`false` por defecto).

**Editor:**

- Quitar `Math.round` de `resolveTime`, `markStart`, `markEnd` y `addWorkingClip`.
- Los tiradores y las marcas conservan la fracción.
- `stageClips` envía los rangos con precisión y el flag `precise`.

**Rust:**

- `jobs.rs`: `format_clock` y `clip_label` aceptan `f64`; `clip_range` valida `f64`.
  `--download-sections` usa `*HH:MM:SS.mmm-HH:MM:SS.mmm`; si `precise`, añade
  `--force-keyframes-at-cuts` (recodifica, más lento). El nombre del archivo puede seguir
  en segundos enteros; los milisegundos afectan al corte, no al nombre.
- `local.rs`: si `precise`, usa `-ss` después de `-i`, `-t` con la duración, `-c:v
  libx264`, `-preset veryfast`, `-crf 18`, audio copiado si cabe y AAC solo si no, y
  `-movflags +faststart`. Si no, conserva el corte rápido actual con `-c copy`. En audio,
  el seek de salida ya es exacto; no recodifiques por defecto.
- Documenta que el modo Exacto consume CPU, tarda más y puede cambiar la calidad de
  vídeo; no lo actives por defecto.

**Pruebas:**

- Unitarias de Rust para `format_clock` y `clip_label` con fracciones y límites.
- Manual: corte exacto de URL y local, audio, varios tramos, cancelación y reintento.

### 7.3 Verificación técnica de yt-dlp

- `--download-sections` acepta fracciones (`parse_duration` admite `.mmm`).
- `--force-keyframes-at-cuts` recodifica para obtener cortes precisos; es lento y no es
  el comportamiento por defecto.
- El modo Rápido sigue usando `--download-sections` sin recodificar y puede incluir
  pre-roll de keyframe.

---

## 8. Fases de trabajo

Cada fase debe compilar. Verifica `npm run build` siempre; en fases Rust añade
`cargo check` en `src-tauri`. No empieces la siguiente fase con errores.

| Fase | Contenido | Archivos principales |
|---|---|---|
| **0. Lectura y línea base** | Leer este documento, `App.tsx`, `ToolWorkspace.tsx`, `TimelineEditor.tsx`, `QueueRail.tsx`, `persistence.ts`, `lib.rs`, `jobs.rs`, `local.rs`. Ejecutar `npm run build` y `cargo check`. Entregar informe corto. **No cambies código.** | — |
| **1. Contrato del editor** | Implementar el ref, los callbacks, el espejo en App y el editor montado en simple. Sin cambios visuales. | `TimelineEditor.tsx`, `App.tsx`, `types.ts` |
| **2. Layout y persistencia** | Grid de cinco áreas, workspace central, raíl a la derecha, mínimo 1280×680, variantes, divisores y sección `layout`. | `App.tsx`, `App.css`, `persistence.ts`, `tauri.conf.json` |
| **3. Menú y botonera** | `MenuBar.tsx` y `ControlPanel.tsx`. Mover marca, pestañas, URL, calidad y carpeta. Eliminar `TopBar`. Acciones de origen y «Salir». | `MenuBar.tsx`, `ControlPanel.tsx`, `TopBar.tsx`, `App.tsx`, `App.css` |
| **4. Workspace y monitor** | Cabecera de fuente, selector de playlist en simple, monitor interno, transporte, modo simple. Extraer subcomponentes presentacionales si hace falta. | `Workspace.tsx`, `TimelineEditor.tsx`, `Monitor.tsx` (opcional), `App.css` |
| **5. Barra de clips** | Pestañas Línea de tiempo / Preparado / Descargas. Mover `tl-list`, sincronizar selección, ocultar en simple, botón «Cola (N)». | `ClipsPanel.tsx`, `QueueRail.tsx`, `TimelineEditor.tsx`, `App.tsx` |
| **6. Herramientas de edición y atajos** | `EditTools.tsx`, cortar, seleccionar, mover, zoom, `V/H/Z/C/Supr`, selección múltiple. | `EditTools.tsx`, `TimelineEditor.tsx`, `timeline.ts`, `App.css` |
| **7. Deshacer y menús** | Historial de clips, Deshacer/Rehacer, menús Edición/Selección/Vista, diálogo de atajos. | `TimelineEditor.tsx`, `MenuBar.tsx`, `App.tsx`, `App.css` |
| **8. Frames (A)** | Timecode con frames, `probe_fps`, `,`/`.`, botones de frame. Sin cambiar cortes. | `local.rs`, `types.ts`, `TimelineEditor.tsx`, `App.tsx` |
| **9. Medios** | `list_media_dir` y `MediaBrowser.tsx`. Filtro con `LOCAL_EXTENSIONS`, breadcrumb, apertura de archivos. | `browse.rs`, `lib.rs`, `MediaBrowser.tsx`, `App.tsx`, `App.css` |
| **10. Precisión (B)** | `f64`, `precise`, `--force-keyframes-at-cuts`, recodificación local, nombres, duplicados, historial y pruebas. | `jobs.rs`, `local.rs`, `types.ts`, `App.tsx`, `TimelineEditor.tsx` |
| **11. Limpieza y docs** | CSS muerto, README, roadmap, versión 1.2.0, prueba completa. | `App.css`, `README.md`, `docs/roadmap.md`, `package.json`, `Cargo.toml`, `tauri.conf.json` |

**Commits:** uno por fase, con Conventional Commits (`feat:`, `refactor:`, `fix:`,
`docs:`, `chore:`). Rama `feature/nueva-interfaz` desde `f55e165`. **Sin push sin
confirmación.** La limpieza de CSS va en su propio commit al final; no la mezcles con el
layout.

---

## 9. Reglas de implementación

- **No reescribas la app.** Reorganiza y completa.
- **No cambies la lógica de descarga, motor ni cola** (`engine.rs`, `jobs.rs`,
  `preview.rs`). `jobs.rs` y `local.rs` solo se tocan en la fase 10 para los tipos y
  argumentos del modo Exacto; explica el cambio en el resumen.
- **No elimines funciones.** Mueve cada una a su nuevo sitio: modo audio, cookies,
  argumentos extra, historial, aviso de actualización, logs, cancelación y reintento.
- **No recodifiques por defecto.** Rápido sigue siendo el predeterminado.
- **TypeScript estricto.** Tras cada movimiento de props, revisa que no quede nada sin
  usar. `noUnusedLocals` te avisará.
- **Componentes nuevos por zona**, en `src/components/`. Si un componente nuevo supera
  ~400 líneas, divídelo. `TimelineEditor` puede seguir siendo el contenedor de estado;
  extrae `Monitor`, `Transport`, `Track` y `Footer` como subcomponentes presentacionales.
- **Textos en español.** Renombra «Loop» a «Repetir».
- **Iconos:** usa `Icon.tsx`. Si falta uno, añádelo con el mismo estilo SVG.
- **Accesibilidad:** conserva `role`, `aria-label`, `aria-selected`, `aria-controls`,
  `aria-pressed`. Menú con foco móvil, flechas y `Escape`. Tramos de la pista como botones.
  Todo lo que funcione con ratón debe tener equivalente de teclado.
- **Tema:** conserva las variables CSS actuales (`--line`, `--surface`, `--muted`…). No
  introduzcas colores fuera del sistema.
- **Sin dependencias nuevas.**
- **Sin `localStorage` directo.** Usa `persistence.ts`, que ya hace el respaldo.
- **Layout:** mínimo 1280×680; medios visible; variantes de grid, no huecos.
- **Origen:** las acciones de menú y Medios cambian `source` explícitamente; no reutilices
  `pickLocalFile` a secas.
- **Medios:** filtra en TS con `LOCAL_EXTENSIONS`; no dupliques la lista en Rust.
- **Versión:** 1.2.0 en `package.json`, `Cargo.toml` y `tauri.conf.json`; actualiza los
  lockfiles y el README.

---

## 10. Criterios de aceptación

**Build y tipos**

- [ ] `npm run build` termina sin errores ni avisos de TypeScript.
- [ ] `cargo check` termina sin errores en todas las fases Rust.
- [ ] `cargo test` pasa las pruebas de tiempos y nombres de la fase 10.
- [ ] `npm run tauri dev` arranca y muestra la interfaz sin errores en consola.

**Layout**

- [ ] La disposición coincide con la sección 3 en 1920 × 1080 y 1280 × 720.
- [ ] A 1280 × 680 la interfaz sigue usable; medios visible; la botonera tiene scroll y
      el botón de añadir queda accesible.
- [ ] Los divisores funcionan y las proporciones se guardan al reiniciar.
- [ ] Ocultar medios o la barra de clips no deja huecos y conserva el acceso a Exportar.
- [ ] El menú mide 44 px y `EngineStatus` no se corta.

**Flujos existentes (regresión)**

- [ ] Analizar una URL de YouTube, elegir calidad y añadir a Preparado.
- [ ] Exportar Preparado; el progreso aparece en Descargas y el trabajo llega al historial.
- [ ] Cancelar un trabajo en curso y reintentar uno fallido.
- [ ] Modo audio: analizar, cortar un tramo y exportar.
- [ ] Varios tramos en un vídeo: cada uno se encola como trabajo independiente.
- [ ] Playlist: el selector de vídeos con casillas y rangos sigue funcionando.
- [ ] Archivo local: abrirlo con el botón, con arrastrar y soltar, y cortar un tramo.
- [ ] Reordenar Preparado con `Alt+↑/↓` y quitar un elemento.
- [ ] Al cerrar y reabrir, el historial persiste y los trabajos interrumpidos aparecen
      como tales.
- [ ] Ajustes: carpeta, concurrencia, cookies y argumentos extra se guardan. La calidad se
      guarda desde la botonera, no desde el drawer.
- [ ] Aviso de actualización de yt-dlp aparece cuando corresponde.

**Funciones nuevas**

- [ ] Menú superior: todas las opciones de 4.1 funcionan o están deshabilitadas con motivo.
- [ ] `I` y `O` solo marcan entrada y salida; el botón «Añadir tramo» es el que crea el
      tramo.
- [ ] `C` corta el tramo aplicable respetando el mínimo de 1 s a cada lado.
- [ ] `,` y `.` avanzan y retroceden un fotograma; la aguja no se sale de los límites.
- [ ] Deshacer y rehacer revierten añadir, cortar, mover y eliminar.
- [ ] El imán ajusta bordes con `S` activado y no lo hace desactivado.
- [ ] Medios: doble clic en un archivo lo abre en el editor; doble clic en una carpeta
      entra; «Subir» vuelve.
- [ ] La selección se sincroniza entre la pista y la barra de clips.
- [ ] Exportar solo procesa `staged`; los tramos del editor se añaden antes.
- [ ] El modo simple oculta la pista y la pestaña, pero conserva los tramos al volver.
- [ ] El modo Exacto sigue deshabilitado hasta la fase 10 y no es el predeterminado.

**Documentación**

- [ ] `README.md` describe la nueva interfaz (raíl derecho, menú, medios) y la versión 1.2.0.
- [ ] `docs/roadmap.md` tiene la sección «1.2 · Nueva interfaz» y marca lo pendiente.

---

## 11. Qué NO hacer

- No cambies el motor (yt-dlp, FFmpeg, Deno) ni su ubicación en `%LOCALAPPDATA%`.
- No añadas funciones de eliminación de DRM ni de evasión de restricciones.
- No toques el instalador, la firma de código ni el actualizador.
- No guardes la bandeja de Preparado al cerrar.
- No conviertas el modo Exacto en predeterminado.
- No introduzcas librerías de estado, de paneles ni de arrastre.
- No uses `localStorage` directamente para datos de la app.
- No subas el mínimo a 1280×720: el mínimo es 1280×680.
- No ocultes Medios por ancho. Solo por decisión del usuario o por falta de espacio real.
- No añadas el conmutador de modo de vista previa en 1.2.0.
- No exportes tramos del editor directamente desde Exportar.
- No prometas duración en Medios sin un comando que la devuelva.
- No dupliques `LOCAL_EXTENSIONS` en Rust.

---

## 12. Decisiones cerradas

No reabrir sin consultar. Si un bloqueo técnico impide una, documenta el motivo y pregunta.

1. **Estado:** `TimelineEditor` posee clips, selección e historial; App guarda un espejo de
   solo lectura; ref con acciones y callbacks (`onClipsChange`, `onClipSelectionChange`,
   `onHistoryChange`).
2. **Monitor:** no se separa en otra área del grid. La columna central es un único
   `Workspace`; el monitor vive dentro de `TimelineEditor`.
3. **Ventana mínima:** 1280 × 680. Medios visible siempre; sin ocultar por ancho.
4. **Frames:** fase 8 solo navegación (timecode con frames, `probe_fps`, `,`/`.`); fase 10
   precisión real con `f64` y recodificación opcional.
5. **Modo simple:** oculta el editor/pista y la pestaña «Línea de tiempo», pero conserva
   tramos e historial porque el editor sigue montado.
6. **Versión:** 1.2.0.
7. **Git:** rama `feature/nueva-interfaz`, sin push sin confirmación.
8. **Playlist:** selector en `Workspace`, en modo simple.
9. **Añadir a la cola:** solo en `ControlPanel` en simple; en avanzado, botón del editor.
   Exportar solo procesa `staged`.
10. **Vista previa:** sin conmutador; fallback automático y badge.
11. **Medios:** sin duración en 1.2.0; filtro con `LOCAL_EXTENSIONS` en TS; breadcrumb y
    Subir; abrir archivo cambia `source` a `file`.
12. **Selección:** `Set<string>` para tramos, separada de la playlist; clic, `Ctrl` y
    `Mayús`; cortar/eliminar/mover con las reglas de 6.3.
13. **Layout:** persistencia en `persistence.ts` con sección `layout`; dos divisores
    verticales y dos horizontales; variantes de grid al ocultar medios o clips.
14. **Atajos `Ctrl`:** handler aparte, solo con editor visible y foco dentro del editor o
    de la barra de clips; ignorar menús, diálogos y campos editables.
15. **Acciones de origen:** «Abrir archivo local» y «Analizar URL» cambian `source`
    explícitamente; confirman si hay tramos. «Salir» confirma con trabajos activos.
16. **Registro de actividad:** diálogo con selector de trabajo y `job.log`; no se añade un
    buffer global.
17. **Pruebas:** unitarias de Rust para tiempos/nombres en la fase 10; regresión manual de
    la sección 10 en cada fase.

---

## 13. Entregable final

1. Lista de archivos creados y modificados, con una línea por archivo.
2. Informe de la fase 0: qué existía, qué se reutilizó y qué se cambió de sitio.
3. Estado de cada criterio de la sección 10 (cumple, no cumple, no probado).
4. Confirmación de las decisiones de la sección 12 y cualquier desviación justificada.
5. Instrucciones para ejecutar y verificar:

```powershell
npm install
npm run build
cd src-tauri
cargo check
cargo test
cd ..
npm run tauri dev
```

No empieces la ejecución hasta que el autor lo indique.
