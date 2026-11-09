import fs from "node:fs"
import { afterAll, describe, expect, it } from "vitest"
import { ProjectSchema } from "../lib/schema.ts"
import { loadProject, paths, saveProject } from "../lib/store.ts"
import { buildProject, type Deps } from "../lib/pipeline/build.ts"
import { mediaDuration, run } from "../lib/ffmpeg.ts"

// Real ffmpeg, fake providers: no network, no quota.
const id = `test-${process.pid}`
const calls = { images: 0, voices: 0 }
const deps: Deps = {
  log: () => {},
  image: {
    name: "fake",
    async generate({ file, width, height }) {
      calls.images++
      fs.mkdirSync(file.replace(/[^\\/]+$/, ""), { recursive: true })
      run("ffmpeg", ["-y", "-f", "lavfi", "-i", `testsrc=size=${width}x${height}:rate=1`, "-frames:v", "1", file])
    },
  },
  synthesize(jobs) {
    for (const j of jobs) {
      calls.voices++
      fs.mkdirSync(j.out.replace(/[^\\/]+$/, ""), { recursive: true })
      run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "libmp3lame", j.out])
    }
  },
}

afterAll(() => fs.rmSync(paths(id).root, { recursive: true, force: true }))

describe("buildProject", () => {
  it("builds, is idempotent, and only redoes what changed", async () => {
    saveProject(
      ProjectSchema.parse({
        id,
        title: "Test",
        scenes: [
          { id: "a", narration: "One.", imagePrompt: "x", seed: 1 },
          { id: "b", narration: "Two.", imagePrompt: "y", seed: 2, motion: "pan-left" },
        ],
      }),
    )
    const final = await buildProject(loadProject(id), deps)
    expect(mediaDuration(final)).toBeCloseTo(2 * (1 + 0.6), 0)
    expect(calls).toEqual({ images: 2, voices: 2 })

    await buildProject(loadProject(id), deps)
    expect(calls).toEqual({ images: 2, voices: 2 })

    const p = loadProject(id)
    p.scenes[1].narration = "Two, edited."
    saveProject(p)
    await buildProject(loadProject(id), deps)
    expect(calls).toEqual({ images: 2, voices: 3 })
  }, 120_000)
})
