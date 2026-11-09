// CLI: pnpm studio <command>
//   studio create "<prompt>" [--seconds 60] [--lang en] [--format 16:9|9:16] [--style "..."] [--id x] [--build]
//                                      generate an editable storyboard with the LLM
//   studio new-demo [id] [16:9|9:16]   create the sample 3-scene project
//   studio build <id>                  build (or resume) a project, generating only stale artifacts
//   studio list                        list projects
import { parseArgs } from "node:util"
import { ProjectSchema } from "../lib/schema.ts"
import { listProjects, loadProject, saveProject, paths } from "../lib/store.ts"
import { buildProject } from "../lib/pipeline/build.ts"
import { generateStoryboard, slugify, toProject } from "../lib/pipeline/storyboard.ts"
import { pollinationsText } from "../lib/providers/llm/pollinations.ts"
import { withRetry } from "../lib/queue.ts"
import fs from "node:fs"

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    seconds: { type: "string", default: "60" },
    lang: { type: "string", default: "en" },
    format: { type: "string", default: "16:9" },
    style: { type: "string", default: "cinematic digital illustration, soft light, highly detailed" },
    id: { type: "string" },
    build: { type: "boolean", default: false },
  },
})
const [cmd, a, b] = positionals

if (cmd === "create" && a) {
  const format = values.format
  if (format !== "16:9" && format !== "9:16") throw new Error(`Unknown format '${format}'`)
  const durationSec = Number(values.seconds)
  if (!(durationSec >= 10 && durationSec <= 600)) throw new Error("--seconds must be between 10 and 600")
  const req = { prompt: a, language: values.lang, format, style: values.style, durationSec } as const
  console.log("Asking the model for a storyboard...")
  const storyboard = await withRetry(() => generateStoryboard(pollinationsText, req), {
    retries: 2,
    onRetry: (e, n) => console.log(`  ${e.message}; retry ${n}`),
  })
  const id = values.id ?? slugify(storyboard.title)
  if (fs.existsSync(paths(id).file)) throw new Error(`Project '${id}' already exists; pass --id to choose another name`)
  const project = toProject(storyboard, req, id)
  saveProject(project)
  console.log(`\n"${project.title}" (${project.scenes.length} scenes) saved to ${paths(id).file}`)
  for (const s of project.scenes) console.log(`  ${s.id}: ${s.narration}`)
  if (values.build) await buildProject(project)
  else console.log(`\nReview or edit the file, then run: pnpm studio build ${id}`)
} else if (cmd === "new-demo") {
  const id = a ?? "demo"
  if (fs.existsSync(paths(id).file)) throw new Error(`Project '${id}' already exists`)
  saveProject(
    ProjectSchema.parse({
      id,
      title: "The oldest map",
      prompt: "How sailors used the night sky",
      format: b ?? "16:9",
      style: "cinematic digital illustration, soft light, highly detailed",
      scenes: [
        { id: "s1", narration: "Long before cities had lights, sailors learned to read the night sky to find their way home.", imagePrompt: "an old wooden sailing ship at night under a sky full of stars", seed: 100, motion: "zoom-in" },
        { id: "s2", narration: "A single star, the North Star, stayed still while all the others turned around it.", imagePrompt: "a sailor looking up at the North Star above a calm dark ocean", seed: 101, motion: "pan-right" },
        { id: "s3", narration: "Today we have satellites, but the sky is still the oldest map humans ever used.", imagePrompt: "a satellite orbiting earth with a starry sky and the milky way", seed: 102, motion: "zoom-out" },
      ],
    }),
  )
  console.log(`Created ${paths(id).file}`)
} else if (cmd === "build" && a) {
  await buildProject(loadProject(a))
} else if (cmd === "list") {
  for (const id of listProjects()) console.log(id)
} else {
  console.error('Usage: pnpm studio create "<prompt>" [options] | new-demo [id] [format] | build <id> | list')
  process.exit(1)
}
