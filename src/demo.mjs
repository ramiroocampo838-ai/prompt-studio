// Phase 0 prototype: fixed 3-scene storyboard -> images -> voice -> mp4.
// Usage: node src/demo.mjs [16:9|9:16]
import fs from "node:fs"
import path from "node:path"
import { generateImage } from "./pollinations.mjs"
import { FORMATS, run, renderClip, concatClips, duration } from "./render.mjs"

const format = process.argv[2] ?? "16:9"
if (!FORMATS[format]) throw new Error(`Unknown format ${format}`)

const style = "cinematic digital illustration, soft light, highly detailed"
const project = {
  voice: "en-US-GuyNeural",
  scenes: [
    {
      id: "s1",
      narration: "Long before cities had lights, sailors learned to read the night sky to find their way home.",
      imagePrompt: "an old wooden sailing ship at night under a sky full of stars",
      motion: "zoom-in",
    },
    {
      id: "s2",
      narration: "A single star, the North Star, stayed still while all the others turned around it.",
      imagePrompt: "a sailor looking up at the North Star above a calm dark ocean",
      motion: "pan-right",
    },
    {
      id: "s3",
      narration: "Today we have satellites, but the sky is still the oldest map humans ever used.",
      imagePrompt: "a satellite orbiting earth with a starry sky and the milky way",
      motion: "zoom-out",
    },
  ],
}

const root = path.resolve(import.meta.dirname, "..", "data", "demo")
const imgDir = path.join(root, "images")
const audioDir = path.join(root, "audio")
const clipDir = path.join(root, "clips")
fs.mkdirSync(root, { recursive: true })

const t0 = Date.now()
const lap = (label) => console.log(`${label} (${((Date.now() - t0) / 1000).toFixed(1)}s)`)

// Generate at ~2/3 of the output size; render.mjs upscales before zoompan.
const { width, height } = FORMATS[format]
const imgW = Math.round((width * 0.67) / 8) * 8
const imgH = Math.round((height * 0.67) / 8) * 8

for (const [i, s] of project.scenes.entries()) {
  s.image = path.join(imgDir, `${s.id}.jpg`)
  await generateImage({ prompt: `${s.imagePrompt}, ${style}`, width: imgW, height: imgH, seed: 100 + i, file: s.image })
  lap(`image ${s.id}`)
}

const scriptFile = path.join(root, "scenes.json")
fs.writeFileSync(scriptFile, JSON.stringify(project, null, 2))
run("python", [path.join(import.meta.dirname, "..", "tools", "tts.py"), scriptFile, audioDir])
lap("tts")

const clips = []
for (const s of project.scenes) {
  const clip = path.join(clipDir, `${s.id}.mp4`)
  const total = renderClip({ image: s.image, audio: path.join(audioDir, `${s.id}.mp3`), out: clip, format, motion: s.motion, pad: 0.6 })
  clips.push(clip)
  lap(`clip ${s.id} (${total.toFixed(1)}s)`)
}

const final = path.join(root, `demo_${format.replace(":", "x")}.mp4`)
concatClips(clips, final)
console.log(`\nFinal: ${final} (${duration(final).toFixed(1)}s)`)
lap("total")
