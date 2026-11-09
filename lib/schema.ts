import { z } from "zod"

export const FORMATS = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
} as const

export const MOTIONS = ["zoom-in", "zoom-out", "pan-left", "pan-right"] as const

export const SceneSchema = z.object({
  id: z.string().min(1),
  narration: z.string().trim().min(1, "narration is empty"),
  imagePrompt: z.string().trim().min(1, "imagePrompt is empty"),
  seed: z.number().int().default(1),
  motion: z.enum(MOTIONS).default("zoom-in"),
  // Id of a library image used instead of generating one.
  imageRef: z.string().optional(),
  // Cache keys of the last generated artifacts; a mismatch means the artifact is stale.
  imageHash: z.string().optional(),
  audioHash: z.string().optional(),
  clipHash: z.string().optional(),
  audioDurationSec: z.number().optional(),
})

export const ProjectSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-_]*$/i, "id must be a simple slug"),
    title: z.string().min(1),
    prompt: z.string().default(""),
    language: z.string().default("en"),
    voice: z.string().default("en-US-GuyNeural"),
    format: z.enum(["16:9", "9:16"]).default("16:9"),
    style: z.string().default(""),
    padSeconds: z.number().min(0).default(0.6),
    subtitles: z.boolean().default(true),
    scenes: z.array(SceneSchema).min(1),
  })
  .superRefine((p, ctx) => {
    const seen = new Set<string>()
    p.scenes.forEach((s, i) => {
      if (seen.has(s.id)) ctx.addIssue({ code: "custom", message: `duplicate scene id ${s.id}`, path: ["scenes", i, "id"] })
      seen.add(s.id)
    })
  })

export type Scene = z.infer<typeof SceneSchema>

export const LibraryImageSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-_]*$/i),
  prompt: z.string(),
  seed: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
  tags: z.array(z.string()).default([]),
  createdAt: z.string(),
})
export type LibraryImage = z.infer<typeof LibraryImageSchema>
export type Project = z.infer<typeof ProjectSchema>
export type Format = keyof typeof FORMATS
