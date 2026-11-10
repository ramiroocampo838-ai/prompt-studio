# Propuesta: generación de música desde un prompt

Estado: **borrador para decisión**. No se ha implementado nada.

## 1. Objetivo

Agregar a Prompt Studio la capacidad de crear música a partir de un prompt de texto, con dos usos:

1. **Música independiente** (`/music`): generar pistas, guardarlas en una biblioteca y descargarlas, igual que `/images`.
2. **Música de fondo para videos**: cada proyecto puede tener una pista (generada, de la biblioteca o ninguna) mezclada con la narración, con *ducking* (la música baja de volumen cuando hay voz).

Restricciones del proyecto que se mantienen: local, $0, sin cuentas, cada integración detrás de una interfaz de proveedor, caché por hash y render resumible.

## 2. Supuesto de hardware

Se supone que existe una **GPU NVIDIA con CUDA**. Nota: `PLAN.md` (2026-11-09) registra "Sin GPU NVIDIA" en el entorno. **Hay que confirmar la GPU real antes de empezar** (ver Fase 0); si no hay GPU, aplica la sección 9.

| VRAM | Experiencia esperada con el modelo recomendado |
| --- | --- |
| 4 a 6 GB | Funciona con configuración reducida; pistas cortas (hasta ~2 min), más lento |
| 8 a 12 GB | Cómodo; pistas de 2 a 4 min en pocos minutos |
| 16 GB o más | Pistas largas y modelos más grandes |

## 3. Opciones evaluadas

| Opción | Tipo | Licencia | Veredicto |
| --- | --- | --- | --- |
| **ACE-Step 1.5** | Local, GPU | Repo MIT. Pesos: **verificar** en la ficha de Hugging Face | **Recomendada.** 10 s a 10 min, servidor REST propio |
| MusicGen | Local | Pesos CC-BY-NC (no comercial) | Descartada: impide YouTube monetizado |
| Stable Audio Open Small | Local | Community License, requiere login en HF | Descartada: cuenta y licencia limitada |
| Pollinations | API | n/a | Descartada: exige clave y no se vio modelo de música |
| Jamendo / Freesound | Biblioteca vía API | No comercial, con clave | Solo opcional |
| Pistas CC0 en `data/music/` | Biblioteca local | Según cada pista | **Fallback** |

No evaluadas: YuE, DiffRhythm, Riffusion (se pueden revisar si ACE-Step no convence).

## 4. Diseño propuesto

### 4.1 Arquitectura

```
UI (/music y editor de proyecto)
        │
   API routes  /api/music, /api/music/[id], /api/projects/[id] (campo music)
        │
   lib/providers/music/
        ├─ acestep.ts   → HTTP a http://127.0.0.1:8001 (servidor ACE-Step local)
        └─ library.ts   → pistas CC0 locales en data/music-stock/ (fallback)
        │
   lib/pipeline/build.ts → paso nuevo "music" + mezcla en ffmpeg
```

Sigue el mismo patrón que `lib/providers/image/pollinations.ts` y `pexels.ts`: una interfaz común, selección automática del proveedor, y cambio al fallback si el principal falla.

### 4.2 Servidor ACE-Step

- Se instala **fuera** de `node_modules`, en una carpeta propia (por ejemplo `tools/acestep/`, ignorada por git) con Python 3.11 o 3.12 y `uv`.
- Se arranca con `uv run acestep-api` (REST en `localhost:8001`).
- Un script `pnpm music:server` lo inicia y espera a que responda. Node solo hace `fetch`; no carga el modelo.
- La primera ejecución descarga los pesos (varios GB). Después funciona **sin internet**.
- El servidor se enciende bajo demanda: si no está arriba, la app lo indica con un mensaje claro y ofrece el fallback.

### 4.3 Esquema de datos (`lib/schema.ts`)

Pista de biblioteca (`data/music/<id>/`):

```
{ id, prompt, lyrics?: string, instrumental: boolean,
  durationSec, seed, provider: "acestep" | "library",
  file: "track.mp3", createdAt }
```

En el proyecto (campo opcional, compatible con proyectos existentes):

```
music?: { trackId: string, volume: number (0 a 1, default 0.18),
          ducking: boolean (default true), fadeInSec, fadeOutSec }
```

### 4.4 Generación

- Entrada: prompt de estilo (género, ánimo, instrumentos, tempo), duración, instrumental sí o no, semilla.
- Por defecto **instrumental** (lo adecuado para fondo de narración). La letra queda como opción avanzada solo en `/music`.
- Caché por hash `(prompt, duración, seed, modelo)`, como el resto del pipeline: la misma entrada no se vuelve a generar.
- Botón 🎲 nueva semilla para variaciones.
- **Sugerencia automática del prompt musical** desde el storyboard: reutilizar el LLM de Pollinations para resumir tema y tono del video en un prompt de música (editable antes de generar).

### 4.5 Mezcla en ffmpeg (`lib/ffmpeg.ts`)

1. La pista se **recorta o se repite en bucle** (con crossfade corto) hasta la duración del video.
2. Se aplican fade in y fade out.
3. **Ducking** con `sidechaincompress` usando la narración como señal de control, o volumen fijo si se desactiva.
4. Normalización de volumen (`loudnorm`) a un nivel razonable para YouTube (aprox. -14 LUFS en la mezcla final).
5. El resultado se mezcla con `amix` junto con la pista de voz ya existente.

La música solo invalida el render final, no las imágenes ni la voz (granularidad ya soportada por la caché).

### 4.6 UI

- **`/music`**: formulario (prompt, duración, instrumental, letra opcional, semilla), lista de pistas con reproductor, descarga, borrar, "usar en un proyecto". Progreso en vivo con el mismo mecanismo SSE de `lib/jobs.ts`.
- **Editor de proyecto**: panel "Música" con selector (ninguna / de la biblioteca / generar nueva), volumen, ducking y vista previa.
- **CLI**: `pnpm studio music "<prompt>" [--seconds 90] [--instrumental] [--seed n]` y `--music <trackId>` en `create`/`build`.

## 5. Fases

| Fase | Contenido | Resultado verificable |
| --- | --- | --- |
| 0. Preparación | Confirmar GPU y VRAM, instalar Python 3.11/12 y `uv`, verificar la licencia de los pesos de ACE-Step | Informe de compatibilidad |
| 1. Prueba de concepto | Instalar ACE-Step, generar 3 pistas de prueba por CLI, medir tiempos y calidad | Tiempos reales por minuto de audio |
| 2. Proveedor y CLI | `lib/providers/music/acestep.ts`, esquema, caché, `pnpm studio music`, pruebas con servidor simulado | `pnpm test` y `pnpm typecheck` en verde |
| 3. Mezcla en video | Paso "music" en `build.ts`, bucle, fades, ducking, loudnorm | Video de demo con música y voz audibles |
| 4. UI | Página `/music`, panel en el editor, API routes, progreso SSE | Flujo completo desde el navegador |
| 5. Fallback y pulido | Biblioteca CC0 local, cambio automático, sugerencia de prompt por LLM, README y licencias | Funciona con el servidor apagado |

Cada fase termina en un commit propio, como las fases anteriores.

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| Licencia de los pesos no permite uso comercial | Verificarla en Fase 0 antes de invertir; si no sirve, pasar al fallback o evaluar YuE/DiffRhythm |
| Requisitos de VRAM mayores a los anunciados | Medir en Fase 1; limitar duración máxima y ofrecer generar por tramos |
| Instalación frágil (Python, CUDA, versiones) | Entorno aislado con `uv`, documentar en el README y la sección de problemas conocidos |
| Servidor apagado o con error | Detección con mensaje claro, arranque con un comando, fallback a biblioteca |
| Calidad variable de las pistas | Semilla, regeneración y prompts sugeridos; la selección final es del usuario |
| Competencia por VRAM con otras herramientas | Un solo trabajo de música a la vez usando la cola existente (`lib/queue.ts`) |
| Proxy corporativo con inspección TLS | Descarga inicial de pesos puede requerir variables de CA; se documenta |

## 7. Licencias y uso responsable

- Confirmar y registrar en el README la licencia de código y de pesos de ACE-Step.
- Para pistas CC0/royalty-free del fallback, guardar un archivo `LICENSES.md` con la fuente y licencia de cada pista.
- La música generada se trata como contenido propio, pero conviene revisar las políticas de YouTube sobre contenido generado por IA al publicar.

## 8. Estimación de esfuerzo

| Fase | Esfuerzo aproximado |
| --- | --- |
| 0 y 1 | Medio día, depende de la descarga de pesos y la instalación |
| 2 | Medio día |
| 3 | Medio día a un día (la mezcla con ducking requiere ajuste fino) |
| 4 | Un día |
| 5 | Medio día |

## 9. Si no hay GPU

- ACE-Step en CPU funciona pero con tiempos largos (no hay cifras publicadas; medir en Fase 1).
- Alternativa realista: usar **solo el fallback** (biblioteca CC0 por ánimo/etiqueta, selección automática por el LLM, misma mezcla y ducking). Las Fases 3, 4 y 5 aplican igual; se omite el proveedor generativo.

## 10. Decisiones que necesito de ti

1. ¿Confirmas la GPU (modelo y VRAM)? Puedo ejecutar el comando para verlo.
2. ¿Música solo instrumental o también con letra/voz cantada?
3. ¿Usarás los videos en YouTube monetizado? Eso condiciona la licencia aceptable.
4. ¿Duración máxima deseada por pista (por ejemplo 2, 4 o 10 minutos)?
5. ¿Incluyo el fallback de biblioteca CC0 desde el inicio o lo dejo para el final?
