import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

export function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" })
  if (r.status !== 0) throw new Error(`${cmd} failed:\n${(r.stderr || r.stdout || "").slice(-1500)}`)
  return r.stdout
}

export const duration = (file) =>
  parseFloat(
    run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]),
  )

export const FORMATS = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
}

const ZOOM = 0.15

// zoompan expressions per motion type; N is the number of frames of the clip.
function motionFilter(motion, N) {
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

// One clip per scene: still image with camera motion + narration audio.
export function renderClip({ image, audio, out, format, motion, pad, fps = 25, crf = 23 }) {
  const { width, height } = FORMATS[format]
  const total = duration(audio) + pad
  const N = Math.ceil(total * fps)
  const m = motionFilter(motion, N)
  // Upscale 2x before zoompan to avoid the jitter caused by integer pixel rounding.
  const vf =
    `scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase,crop=${width * 2}:${height * 2},` +
    `zoompan=z='${m.z}':x='${m.x}':y='${m.y}':d=${N}:s=${width}x${height}:fps=${fps},format=yuv420p`
  fs.mkdirSync(path.dirname(out), { recursive: true })
  run("ffmpeg", [
    "-y", "-loop", "1", "-i", image, "-i", audio,
    "-vf", vf, "-af", `apad=pad_dur=${pad}`, "-t", total.toFixed(2),
    "-c:v", "libx264", "-preset", "medium", "-crf", String(crf), "-r", String(fps),
    "-c:a", "aac", "-ar", "44100", "-ac", "2", out,
  ])
  return total
}

export function concatClips(clips, out) {
  const list = out + ".txt"
  fs.writeFileSync(list, clips.map((c) => `file '${c.replace(/\\/g, "/")}'`).join("\n"))
  run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", out])
  fs.rmSync(list, { force: true })
}
