import fs from "node:fs"
import path from "node:path"
import { hashOf } from "../hash.ts"
import { FORMATS, type Project, type Scene } from "../schema.ts"
import { paths, saveProject } from "../store.ts"
import { withRetry, mapLimit } from "../queue.ts"
import { concatClips, mediaDuration, renderClip } from "../ffmpeg.ts"
import { pollinations, type ImageProvider } from "../providers/image/pollinations.ts"
import { synthesizeEdge, type TtsJob } from "../providers/tts/edge.ts"

export interface Deps {
  image: ImageProvider
  synthesize: (jobs: TtsJob[]) => void
  log: (msg: string) => void
}

export const defaultDeps: Deps = { image: pollinations, synthesize: synthesizeEdge, log: console.log }

// Images are generated at ~2/3 of the output size; ffmpeg upscales before the camera motion.
export function imageSize(format: Project["format"]): { width: number; height: number } {
  const { width, height } = FORMATS[format]
  return { width: Math.round((width * 0.67) / 8) * 8, height: Math.round((height * 0.67) / 8) * 8 }
}

export const fullImagePrompt = (p: Project, s: Scene) => (p.style ? `${s.imagePrompt}, ${p.style}` : s.imagePrompt)

export const imageHashOf = (p: Project, s: Scene, provider: string) => {
  const { width, height } = imageSize(p.format)
  return hashOf(provider, fullImagePrompt(p, s), s.seed, width, height)
}
export const audioHashOf = (p: Project, s: Scene) => hashOf(p.voice, s.narration)
export const clipHashOf = (p: Project, s: Scene, imageHash: string, audioHash: string) =>
  hashOf(imageHash, audioHash, s.motion, p.format, p.padSeconds)

export interface Stale {
  images: string[]
  audio: string[]
  clips: string[]
}

// Which scenes need work: the stored hash differs from the current one, or the file is missing.
export function planStale(p: Project, provider: string, exists: (file: string) => boolean = fs.existsSync): Stale {
  const dir = paths(p.id)
  const stale: Stale = { images: [], audio: [], clips: [] }
  for (const s of p.scenes) {
    const ih = imageHashOf(p, s, provider)
    const ah = audioHashOf(p, s)
    const imageFresh = s.imageHash === ih && exists(path.join(dir.images, `${s.id}.jpg`))
    const audioFresh = s.audioHash === ah && exists(path.join(dir.audio, `${s.id}.mp3`)) && s.audioDurationSec !== undefined
    if (!imageFresh) stale.images.push(s.id)
    if (!audioFresh) stale.audio.push(s.id)
    const clipFresh =
      imageFresh && audioFresh && s.clipHash === clipHashOf(p, s, ih, ah) && exists(path.join(dir.clips, `${s.id}.mp4`))
    if (!clipFresh) stale.clips.push(s.id)
  }
  return stale
}

export async function buildProject(project: Project, deps: Deps = defaultDeps): Promise<string> {
  const dir = paths(project.id)
  const stale = planStale(project, deps.image.name)
  const byId = new Map(project.scenes.map((s) => [s.id, s]))
  deps.log(`${project.scenes.length} scenes; to do: ${stale.images.length} images, ${stale.audio.length} voices, ${stale.clips.length} clips`)

  // Images one at a time: the free provider rate-limits per IP. Progress is saved after each one.
  for (const id of stale.images) {
    const s = byId.get(id)!
    const { width, height } = imageSize(project.format)
    await withRetry(
      () => deps.image.generate({ prompt: fullImagePrompt(project, s), width, height, seed: s.seed, file: path.join(dir.images, `${s.id}.jpg`) }),
      { onRetry: (e, n, ms) => deps.log(`  image ${s.id}: ${e.message}; retry ${n} in ${Math.round(ms / 1000)}s`) },
    )
    s.imageHash = imageHashOf(project, s, deps.image.name)
    saveProject(project)
    deps.log(`image ${s.id}`)
  }

  if (stale.audio.length) {
    deps.synthesize(
      stale.audio.map((id) => ({ text: byId.get(id)!.narration, voice: project.voice, out: path.join(dir.audio, `${id}.mp3`) })),
    )
    for (const id of stale.audio) {
      const s = byId.get(id)!
      s.audioDurationSec = mediaDuration(path.join(dir.audio, `${id}.mp3`))
      s.audioHash = audioHashOf(project, s)
    }
    saveProject(project)
    deps.log(`voice ${stale.audio.length} scenes`)
  }

  await mapLimit(
    stale.clips.map((id) => byId.get(id)!),
    2,
    async (s) => {
      const out = path.join(dir.clips, `${s.id}.mp4`)
      const sec = renderClip({
        image: path.join(dir.images, `${s.id}.jpg`),
        audio: path.join(dir.audio, `${s.id}.mp3`),
        out,
        format: project.format,
        motion: s.motion,
        audioSec: s.audioDurationSec!,
        pad: project.padSeconds,
      })
      s.clipHash = clipHashOf(project, s, s.imageHash!, s.audioHash!)
      deps.log(`clip ${s.id} (${sec.toFixed(1)}s)`)
    },
  )
  if (stale.clips.length) saveProject(project)

  const final = path.join(dir.out, `${project.id}.mp4`)
  if (stale.clips.length || !fs.existsSync(final)) {
    concatClips(project.scenes.map((s) => path.join(dir.clips, `${s.id}.mp4`)), final)
  }
  deps.log(`Final: ${final} (${mediaDuration(final).toFixed(1)}s)`)
  return final
}
