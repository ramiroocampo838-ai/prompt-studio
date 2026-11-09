import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { FORMATS, type Format, type Scene } from "./schema.ts"

export function run(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: "utf8" })
  if (r.error) throw new Error(`${cmd} could not start: ${r.error.message}`)
  if (r.status !== 0) throw new Error(`${cmd} failed:\n${(r.stderr || r.stdout || "").slice(-1500)}`)
  return r.stdout
}

export const mediaDuration = (file: string): number =>
  parseFloat(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]))

export const FPS = 25
const ZOOM = 0.15

// zoompan expressions per motion type; N is the number of frames of the clip.
export function motionFilter(motion: Scene["motion"], N: number): { z: string; x: string; y: string } {
  const step = (ZOOM / N).toFixed(6)
  const center = { x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" }
  switch (motion) {
    case "zoom-out":
      return { z: `if(eq(on,0),${1 + ZOOM},max(zoom-${step},1))`, ...center }
    case "pan-left":
      return { z: String(1 + ZOOM), x: `(iw-iw/zoom)*(1-on/${N})`, y: center.y }
    case "pan-right":
      return { z: String(1 + ZOOM), x: `(iw-iw/zoom)*on/${N}`, y: center.y }
    default:
      return { z: `min(zoom+${step},${1 + ZOOM})`, ...center }
  }
}

export interface ClipSpec {
  image: string
  audio: string
  out: string
  format: Format
  motion: Scene["motion"]
  audioSec: number
  pad: number
  crf?: number
}

// Pure: builds the ffmpeg arguments of one scene clip (still image with camera motion + narration).
export function clipArgs(s: ClipSpec): { args: string[]; totalSec: number } {
  const { width, height } = FORMATS[s.format]
  const totalSec = s.audioSec + s.pad
  const N = Math.ceil(totalSec * FPS)
  const m = motionFilter(s.motion, N)
  // Upscale 2x before zoompan to avoid the jitter caused by integer pixel rounding.
  const vf =
    `scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase,crop=${width * 2}:${height * 2},` +
    `zoompan=z='${m.z}':x='${m.x}':y='${m.y}':d=${N}:s=${width}x${height}:fps=${FPS},format=yuv420p`
  const args = [
    "-y", "-loop", "1", "-i", s.image, "-i", s.audio,
    "-vf", vf, "-af", `apad=pad_dur=${s.pad}`, "-t", totalSec.toFixed(2),
    "-c:v", "libx264", "-preset", "medium", "-crf", String(s.crf ?? 23), "-r", String(FPS),
    "-c:a", "aac", "-ar", "44100", "-ac", "2", s.out,
  ]
  return { args, totalSec }
}

export function renderClip(spec: ClipSpec): number {
  const { args, totalSec } = clipArgs(spec)
  fs.mkdirSync(path.dirname(spec.out), { recursive: true })
  run("ffmpeg", args)
  return totalSec
}

export const concatList = (clips: string[]): string =>
  clips.map((c) => `file '${c.replace(/\\/g, "/")}'`).join("\n")

export function concatClips(clips: string[], out: string): void {
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const list = out + ".txt"
  fs.writeFileSync(list, concatList(clips))
  try {
    run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", out])
  } finally {
    fs.rmSync(list, { force: true })
  }
}
