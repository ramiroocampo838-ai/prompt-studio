// CLI: pnpm studio <command>
//   studio new-demo [id] [16:9|9:16]   create the sample 3-scene project
//   studio build <id>                  build (or resume) a project, generating only stale artifacts
//   studio list                        list projects
import { ProjectSchema } from "../lib/schema.ts"
import { listProjects, loadProject, saveProject, paths } from "../lib/store.ts"
import { buildProject } from "../lib/pipeline/build.ts"
import fs from "node:fs"

const [cmd, a, b] = process.argv.slice(2)

if (cmd === "new-demo") {
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
  console.error("Usage: pnpm studio new-demo [id] [format] | build <id> | list")
  process.exit(1)
}
