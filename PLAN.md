# Prompt Studio: plan de implementación

Herramienta personal y local para crear **videos narrados** (storytelling/shorts) e **imágenes** a partir de un prompt, usando solo herramientas gratuitas y sin crear cuentas. Reutiliza el patrón del Video Kit de `aem-cert` (guion JSON editable → TTS → escenas → ffmpeg).

## 1. Decisiones ya tomadas

| Tema | Decisión |
| --- | --- |
| Usuario | Solo yo, local |
| Tipo de video | Narrado con imágenes generadas y movimiento (Ken Burns) |
| Duración | Variable, la define el usuario |
| Costo | $0, sin cuentas ni tarjeta |
| Idioma | Multilenguaje, elegible por proyecto |
| Imágenes | Generar, editar el prompt, regenerar y reusar dentro de los videos |
| Interfaz | Web app Next.js con editor de storyboard |
| Render | ffmpeg puro (sin Remotion) |
| Repo | Nuevo, independiente, en `IdeaProjects\aem-cert\prompt-studio` |

## 2. Alcance y límites

**Incluye**: prompt → storyboard editable → imágenes por escena → voz → mp4 (16:9 y 9:16) con zoom/paneo, transiciones y subtítulos; modo "solo imagen" y galería reutilizable.

**No incluye** (sin GPU ni pago): video generativo (Wan/LTX/Veo), edición de imágenes con referencias, personajes consistentes garantizados, multiusuario, cuentas.

**Riesgos conocidos**
- Pollinations (imágenes) agrega una marca de agua "pollinations.ai" y su política es inestable. Se acepta la marca en el prototipo; el stock gratuito es el respaldo. No se oculta la marca recortándola sin decisión explícita (puede ir contra sus términos).
- edge-tts no es oficial y puede dejar de funcionar. Respaldo: Piper (offline).
- Ollama en CPU es lento. Respaldo: endpoint de texto de Pollinations.
- Todas las integraciones van detrás de una interfaz de proveedor para poder cambiarlas.

## 3. Estado del entorno (verificado 2026-11-09)

- Node v24.10, pnpm 12.8, Python con `edge_tts` instalado, ffmpeg 9.0 con ffprobe, Edge instalado en `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`.
- **Ollama no está instalado**; hay que instalarlo (ver Fase 2).
- Sin GPU NVIDIA.
- Pollinations respondió sin llave (HTTP 200, imagen con marca de agua).

## 4. Arquitectura

```
UI (Next.js)  ──►  API routes  ──►  Pipeline (módulos Node)
 editor            /api/projects        storyboard → images → tts → render
 storyboard        /api/generate/*            │
 galería           /api/render                ▼
                                       Proveedores (interfaz común)
                                       llm: ollama | pollinations-text
                                       image: pollinations | pexels
                                       tts: edge-tts | piper
                                       render: ffmpeg
Almacenamiento: carpeta data/ (JSON + archivos), sin base de datos
```

### Estructura del repo

```
prompt-studio/
  PLAN.md
  package.json, tsconfig.json, next.config.mjs
  app/                       páginas y API routes
    page.tsx                 lista de proyectos
    projects/[id]/page.tsx   editor de storyboard
    images/page.tsx          generador y galería de imágenes
    api/...
  components/                UI (storyboard, escena, player, galería)
  lib/
    schema.ts                tipos y validación (zod)
    store.ts                 lectura/escritura de data/
    jobs.ts                  cola de trabajos y progreso
    providers/
      llm/{ollama,pollinations}.ts
      image/{pollinations,pexels}.ts
      tts/{edge,piper}.ts
    pipeline/
      storyboard.ts          prompt → escenas
      images.ts              generación y caché
      tts.ts                 narración por escena
      render.ts              ffmpeg: clips, concat, subtítulos
      subtitles.ts           ASS desde duraciones
  tools/
    tts.py                   edge-tts (portado del kit)
  config/studio.config.json  proveedores, voces, formatos, rutas
  data/                      (git-ignorado) proyectos, imágenes, audios, salidas
```

### Modelo de datos (`data/projects/<id>/project.json`)

```
Project { id, title, prompt, language, voice, format("16:9"|"9:16"),
          style, targetDurationSec, scenes[], createdAt, status }
Scene   { id, order, narration, imagePrompt, imageId?, motion
          ("zoom-in"|"zoom-out"|"pan-left"|"pan-right"), durationSec?,
          audioFile?, status }
Image   { id, prompt, seed, provider, width, height, file, createdAt, tags[] }
```

Las escenas se mantienen en JSON editable, igual que `video-script.json` del kit. Cada escena guarda su estado para regenerar solo lo que cambió.

## 5. Fases de implementación

### Fase 0: Prototipo mínimo (validar calidad)
Objetivo: prompt → 3 escenas → mp4, por CLI, antes de construir la UI.
1. Inicializar el proyecto (`pnpm`, TypeScript) y `git init`.
2. `providers/image/pollinations.ts`: descarga una imagen por prompt, con semilla y tamaño.
3. `tools/tts.py` portado del kit; `providers/tts/edge.ts` lo invoca.
4. `pipeline/render.ts`: por escena, imagen + audio → clip con zoom/paneo (`zoompan`), concat con crossfade.
5. Script `pnpm demo "tema"` con un guion fijo de 3 escenas.
6. **Criterio de salida**: mp4 reproducible de ~30 s, calidad de imagen y voz aceptables, y tiempo de render medido.

### Fase 1: Núcleo del pipeline
1. `schema.ts` con zod y `store.ts` sobre `data/`.
2. Pipeline por etapas e idempotente: reusa lo ya generado si no cambió el prompt (hash).
3. Duración de cada escena = duración del audio + pausa, medida con `ffprobe`.
4. Formatos 16:9 (1920×1080) y 9:16 (1080×1920); fps 25, CRF 23. Con zoompan se necesitan más fps que en el kit; no usar 5 fps.
5. Reintentos con backoff y límite de concurrencia por proveedor (Pollinations tiene rate limit).
6. Pruebas con vitest de `schema`, hashing de caché y generación de comandos ffmpeg.

### Fase 2: Storyboard con LLM
1. Instalar Ollama y bajar un modelo pequeño (por ejemplo `qwen2.5:3b` o `llama3.2:3b`) y medir velocidad en CPU.
2. `providers/llm/ollama.ts` con salida JSON estructurada validada por zod; un reintento si el JSON es inválido.
3. `providers/llm/pollinations.ts` como alternativa sin instalación.
4. Prompt de sistema: dado tema, duración, idioma y estilo, devolver N escenas con `narration` (≈150 palabras por minuto) e `imagePrompt` (en inglés, descriptivo, con estilo consistente).
5. Un "estilo global" se antepone a cada `imagePrompt` para mantener coherencia visual.

### Fase 3: Voz multilenguaje
1. Selector de idioma y voz (lista de `edge-tts --list-voices`, caché local).
2. `providers/tts/piper.ts` como respaldo offline (modelos por idioma).
3. Subtítulos: generar ASS con tiempos por escena (por frase, proporcional a la duración del audio) y quemarlos con ffmpeg. Tipografía y tamaño según formato.

### Fase 4: UI web
1. Lista de proyectos y botón "Nuevo" (prompt, idioma, formato, duración, estilo).
2. Editor de storyboard: tarjetas de escena con narración y prompt de imagen editables, reordenar, borrar, duplicar, regenerar imagen o voz por escena.
3. Vista previa de escena (imagen con movimiento CSS y audio) sin renderizar todo.
4. Botón "Renderizar" con progreso en vivo (SSE) y descarga del mp4.
5. Página de imágenes: generar desde prompt (varias variantes por semilla), galería con etiquetas, y "usar en escena".
6. Indicador de límites/estado del proveedor (último error, reintentos).

### Fase 5: Respaldo y robustez
1. Proveedor `pexels` (llave gratuita opcional por variable de entorno) y búsqueda por palabras clave a partir del `imagePrompt`.
2. Detección de fallo de Pollinations (HTTP distinto de 200, imagen vacía) y cambio automático al respaldo.
3. Limpieza de `data/work` tras renderizar; opción de conservar intermedios.
4. Exportar metadata para YouTube (título, descripción, capítulos), reutilizando la lógica del kit.

### Fase 6: Documentación y cierre
1. `README.md` con instalación (Node, pnpm, Python + edge-tts, ffmpeg, Ollama) y uso.
2. Sección de solución de problemas (rate limit, marca de agua, Ollama lento).
3. Revisión de licencias de cada proveedor y nota sobre la marca de agua.

## 6. Detalles técnicos de render (ffmpeg)

- Clip por escena: imagen escalada y recortada al formato, `zoompan` con duración = audio + pausa, audio mezclado; fade in/out entre escenas mediante `xfade`/`acrossfade` o concat simple si hay problemas de sincronía.
- Zoom suave (de 1.0 a 1.15) o paneo con límites para no salir de la imagen; generar imágenes a mayor resolución que la de salida para evitar pixelado.
- Subtítulos ASS con `-vf "ass=..."`; verificar rutas de Windows (escapar `:` y `\`).
- Un comando por escena, con caché por hash, y luego un concat final con `-c copy` solo si los códecs coinciden.
- Validar que cada escena tenga narración no vacía e ids únicos (como el kit).

## 7. Pruebas y verificación

- Unitarias (vitest): validación de esquemas, hashes de caché, generación de comandos ffmpeg y de ASS.
- Integración: pipeline con proveedores simulados (mock) para no gastar red ni cuota.
- Manual: Fase 0 y un video completo de 1 min en cada formato; revisar sincronía de audio y subtítulos.
- Comprobar `pnpm lint`, `pnpm build` y el flujo completo de la UI antes de cerrar cada fase.

## 8. Orden recomendado y estimación

| Fase | Resultado | Esfuerzo aprox. |
| --- | --- | --- |
| 0 | Prototipo por CLI | 0.5–1 día |
| 1 | Pipeline y almacenamiento | 1–2 días |
| 2 | Storyboard con LLM | 1 día |
| 3 | Voces y subtítulos | 1 día |
| 4 | UI completa | 2–3 días |
| 5 | Respaldos y robustez | 1 día |
| 6 | Documentación | 0.5 día |

## 9. Resultado de la Fase 2 (2026-11-09) ✅

Storyboard con LLM **sin instalar nada y sin cuenta**, usando el endpoint de texto de Pollinations (compatible con OpenAI, modelo `gpt-oss-20b`). Se descartó Ollama a petición del usuario.

- `lib/providers/llm/pollinations.ts`: proveedor intercambiable (`LlmProvider.chat`), modo JSON, `RateLimitError` ante 402/429.
- `lib/pipeline/storyboard.ts`: prompt de sistema (N escenas según duración, narración en el idioma elegido, `imagePrompt` siempre en inglés y visualmente consistente), extracción de JSON tolerante (code fences, texto alrededor), validación con zod y **reintento mostrando el error al modelo**. Escenas de ~12 s (~29 palabras).
- `lib/languages.ts`: idioma → voz de edge-tts (en, es, pt, fr, de, it).
- CLI: `pnpm studio create "<prompt>" [--seconds 60] [--lang es] [--format 9:16] [--style "..."] [--id x] [--build]`. Sin `--build` guarda el storyboard para revisarlo/editarlo antes de gastar cuota de imágenes.
- Verificado de extremo a extremo: prompt en español → 3 escenas → video vertical de 27.7 s con voz en español e imágenes coherentes. 25 tests en verde.

Hallazgos:
- **El texto tiene el mismo límite que las imágenes: 1 respuesta cada 45 s por IP** (HTTP 402 con `Retry-After`); los reintentos lo respetan.
- `gpt-oss-20b` es un modelo de razonamiento y con el límite por defecto devolvía HTTP 400 (`output_token_limit_exceeded`). Solución: `max_tokens: 8000` y `reasoning_effort: "low"`.
- Los errores HTTP ahora incluyen el cuerpo de la respuesta para poder diagnosticar.
- Tiempo realista: un video de N escenas tarda ≈ 45 s × (N + 1) en total por los límites gratuitos (3 escenas ≈ 3 min).

## 10. Resultado de la Fase 1 (2026-11-09) ✅

Pipeline en TypeScript (Node 24 ejecuta `.ts` sin compilar; `tsc` solo verifica tipos). Reemplaza al prototipo `src/`.

- `lib/schema.ts` (zod): proyecto y escenas, ids únicos, narración no vacía, ids de proyecto como slug seguro.
- `lib/store.ts`: `data/projects/<id>/` con escritura atómica de `project.json`.
- `lib/pipeline/build.ts`: caché por hash (`imageHash`, `audioHash`, `clipHash`). Solo se regeneran las escenas cuyo hash cambió o cuyo archivo falta; el progreso se guarda tras cada imagen, así que se puede reanudar. Cambiar el estilo invalida imágenes y clips; cambiar una narración solo afecta esa escena.
- `lib/queue.ts`: `withRetry` (backoff y respeto de `Retry-After`) y `mapLimit`. Imágenes en serie por el límite de Pollinations; clips con concurrencia 2.
- `lib/ffmpeg.ts`: comandos puros y testeables; 25 fps, CRF 23, duración de cada escena = audio medido con ffprobe + pausa.
- Proveedores intercambiables: `lib/providers/image/pollinations.ts`, `lib/providers/tts/edge.ts` (con pista si falla con 403).
- CLI: `pnpm studio new-demo [id] [formato]`, `pnpm studio build <id>`, `pnpm studio list`. Además `pnpm typecheck` y `pnpm test`.
- 16 tests (vitest): esquemas, hash, reintentos, concurrencia, comandos ffmpeg, `planStale` y un test de integración con ffmpeg real y proveedores falsos (verifica idempotencia y reconstrucción parcial).
- Verificado de extremo a extremo con proveedores reales: 17.8 s; la segunda ejecución no hizo nada (0 imágenes, 0 voces, 0 clips).

## 11. Resultado de la Fase 0 (2026-11-09) ✅


Prototipo en `src/` (`pnpm demo [16:9|9:16]`): 3 escenas → imágenes → voz → mp4 de 17.8 s, 1920×1080, 25 fps, 2.3 MB, generado en ~21 s. Calidad de imagen y voz aceptable, zoom/paneo fluido.

Hallazgos que cambian el plan:
- **Proxy corporativo con inspección TLS**: Node falla con `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`. Solución: ejecutar Node con `--use-system-ca` (ya en `pnpm demo`; usarlo en todos los scripts y en `next dev`).
- **Pollinations sin llave: 1 imagen cada 45 s por IP** (HTTP 402 `FREE_LIMIT` con `Retry-After`). El cliente lo respeta y espera. En la práctica una ráfaga inicial pasó rápido, pero hay que **planificar ~45 s por imagen** en uso sostenido (un video de 10 escenas ≈ 8 min). Esto hace más importante la caché por hash, la cola secuencial y el proveedor de respaldo (Pexels).
- **edge-tts 7.2.8 devolvía 403**; actualizar a 7.3.1 (`pip install -U edge-tts`) lo resolvió. Documentar en el README y manejar el error con un mensaje claro.
- La **marca de agua "pollinations.ai"** aparece en la esquina inferior derecha incluso con `nologo=true`.

9:16 también probado (1080×1920, 17.8 s); tardó 120 s por el límite de imágenes de Pollinations.

## 12. Pendientes por decidir

1. Qué hacer con la marca de agua de Pollinations en el resultado final (aceptarla, usar stock, o volver a evaluar proveedores).
2. Cómo tratar el límite de 1 imagen/45 s (aceptar la espera, o buscar un proveedor alternativo sin cuenta).
3. Modelo de Ollama a usar tras medir velocidad en CPU.
4. Si el nuevo repo se publica en GitHub o queda solo local.
