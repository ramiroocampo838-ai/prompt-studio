import fs from "node:fs"
import type { Project } from "../schema.ts"
import { paths, saveProject } from "../store.ts"
import { withRetry } from "../queue.ts"
import type { LlmProvider } from "../providers/llm/pollinations.ts"
import { generateStoryboard, slugify, toProject, type StoryboardRequest } from "./storyboard.ts"

export interface CreateOptions {
  id?: string
  voice?: string
  subtitles?: boolean
  onRetry?: (e: Error, attempt: number) => void
}

// An explicit id must be free; a derived id gets a numeric suffix when taken.
export function pickId(base: string, explicit: boolean, taken: (id: string) => boolean): string {
  if (!taken(base)) return base
  if (explicit) throw new Error(`Project '${base}' already exists; choose another id`)
  for (let n = 2; ; n++) if (!taken(`${base}-${n}`)) return `${base}-${n}`
}

export async function createFromPrompt(llm: LlmProvider, req: StoryboardRequest, opts: CreateOptions = {}): Promise<Project> {
  const storyboard = await withRetry(() => generateStoryboard(llm, req), {
    retries: 2,
    onRetry: (e, n) => opts.onRetry?.(e, n),
  })
  const id = pickId(opts.id ?? slugify(storyboard.title), opts.id !== undefined, (x) => fs.existsSync(paths(x).file))
  const project = toProject(storyboard, req, id, { voice: opts.voice, subtitles: opts.subtitles })
  saveProject(project)
  return project
}
