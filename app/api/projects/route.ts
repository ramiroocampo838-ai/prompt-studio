import { NextResponse } from "next/server"
import { z } from "zod"
import { ApiError, route } from "../../../lib/api.ts"
import { listProjects, summarize } from "../../../lib/store.ts"
import { createFromPrompt } from "../../../lib/pipeline/create.ts"
import { pollinationsText } from "../../../lib/providers/llm/pollinations.ts"
import { languageOf } from "../../../lib/languages.ts"

export const dynamic = "force-dynamic"
export const maxDuration = 300

const CreateSchema = z.object({
  prompt: z.string().trim().min(3, "write a topic or idea").max(2000),
  seconds: z.number().min(10).max(600).default(60),
  language: z.string().default("en"),
  format: z.enum(["16:9", "9:16"]).default("16:9"),
  style: z.string().max(300).default("cinematic digital illustration, soft light, highly detailed"),
  voice: z.string().optional(),
  subtitles: z.boolean().default(true),
})

export const GET = route(async () => {
  const items = listProjects().map(summarize).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return NextResponse.json(items)
})

export const POST = route(async (req: Request) => {
  const parsed = CreateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) throw new ApiError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "))
  const b = parsed.data
  languageOf(b.language)
  const project = await createFromPrompt(
    pollinationsText,
    { prompt: b.prompt, language: b.language, format: b.format, style: b.style, durationSec: b.seconds },
    { voice: b.voice, subtitles: b.subtitles },
  )
  return NextResponse.json(project, { status: 201 })
})
