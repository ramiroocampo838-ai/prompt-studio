import { z } from "zod"
import { languageOf } from "../languages.ts"
import { MOTIONS, ProjectSchema, type Format, type Project } from "../schema.ts"
import type { ChatMessage, LlmProvider } from "../providers/llm/pollinations.ts"

export interface StoryboardRequest {
  prompt: string
  language: string
  format: Format
  style: string
  durationSec: number
}

// Narration of about 12 s per scene keeps the image changing often enough.
export const SECONDS_PER_SCENE = 12
const WORDS_PER_SECOND = 2.4

export const sceneCount = (durationSec: number) => Math.min(40, Math.max(2, Math.round(durationSec / SECONDS_PER_SCENE)))
export const wordsPerScene = () => Math.round(SECONDS_PER_SCENE * WORDS_PER_SECOND)

const LlmStoryboardSchema = z.object({
  title: z.string().trim().min(1),
  scenes: z
    .array(
      z.object({
        narration: z.string().trim().min(1),
        imagePrompt: z.string().trim().min(1),
        motion: z.enum(MOTIONS).optional(),
      }),
    )
    .min(1),
})
export type LlmStoryboard = z.infer<typeof LlmStoryboardSchema>

export function buildMessages(req: StoryboardRequest): ChatMessage[] {
  const n = sceneCount(req.durationSec)
  const lang = languageOf(req.language)
  const system = [
    "You write storyboards for short narrated videos made of still images.",
    "Answer with one JSON object and nothing else, with this shape:",
    `{"title": string, "scenes": [{"narration": string, "imagePrompt": string, "motion": "${MOTIONS.join('" | "')}"}]}`,
    "Rules:",
    `- Exactly ${n} scenes, in narrative order, with a clear beginning, middle and end.`,
    `- "narration" is written in ${lang.name}, plain spoken sentences (no emojis, markdown, stage directions or scene labels), about ${wordsPerScene()} words each.`,
    '- "imagePrompt" is always in English: one concrete, visual description of a single image that matches the narration (subject, setting, lighting, composition). Do not mention text, captions, logos or watermarks.',
    "- Keep the characters and setting visually consistent across imagePrompts by repeating their key visual traits.",
    `- "title" is a short title in ${lang.name}.`,
  ].join("\n")
  const user = `Topic: ${req.prompt}\nTarget length: about ${Math.round(req.durationSec)} seconds.`
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

// Models often wrap JSON in code fences or add text around it.
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fenced ? fenced[1] : text).trim()
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  if (start < 0 || end <= start) throw new Error("no JSON object found in the model answer")
  return JSON.parse(body.slice(start, end + 1))
}

export function parseStoryboard(text: string): LlmStoryboard {
  const parsed = LlmStoryboardSchema.safeParse(extractJson(text))
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "))
  }
  return parsed.data
}

export const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "video"

// Asks the model for a storyboard; on invalid output it shows the error back to the model once more.
export async function generateStoryboard(llm: LlmProvider, req: StoryboardRequest, attempts = 3): Promise<LlmStoryboard> {
  const messages = buildMessages(req)
  let lastError = ""
  for (let i = 1; i <= attempts; i++) {
    const answer = await llm.chat(messages, { json: true })
    try {
      return parseStoryboard(answer)
    } catch (e) {
      lastError = (e as Error).message
      messages.push(
        { role: "assistant", content: answer },
        { role: "user", content: `That answer was invalid (${lastError}). Reply again with only the corrected JSON object.` },
      )
    }
  }
  throw new Error(`The model did not return a valid storyboard after ${attempts} attempts: ${lastError}`)
}

export function toProject(sb: LlmStoryboard, req: StoryboardRequest, id: string): Project {
  return ProjectSchema.parse({
    id,
    title: sb.title,
    prompt: req.prompt,
    language: req.language,
    voice: languageOf(req.language).voice,
    format: req.format,
    style: req.style,
    scenes: sb.scenes.map((s, i) => ({
      id: `s${i + 1}`,
      narration: s.narration,
      imagePrompt: s.imagePrompt,
      seed: 1000 + i,
      motion: s.motion ?? MOTIONS[i % MOTIONS.length],
    })),
  })
}
