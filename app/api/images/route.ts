import fs from "node:fs"
import { NextResponse } from "next/server"
import { z } from "zod"
import { ApiError, route, safeId } from "../../../lib/api.ts"
import { LIBRARY_DIR, addImage, imageFile, listImages, newImageId } from "../../../lib/library.ts"
import { imageSize } from "../../../lib/pipeline/build.ts"
import { pollinations } from "../../../lib/providers/image/pollinations.ts"
import { withRetry } from "../../../lib/queue.ts"
import { loadProject, paths } from "../../../lib/store.ts"
import path from "node:path"

export const dynamic = "force-dynamic"
export const maxDuration = 300

const Generate = z.object({
  prompt: z.string().trim().min(3),
  format: z.enum(["16:9", "9:16"]).default("16:9"),
  seed: z.number().int().optional(),
  tags: z.array(z.string()).default([]),
})
const Import = z.object({ fromProject: z.string(), sceneId: z.string(), tags: z.array(z.string()).default([]) })

export const GET = route(async () => NextResponse.json(listImages()))

// Generates one image per request (the free provider allows ~1 per 45 s), or imports a scene image.
export const POST = route(async (req: Request) => {
  const body = await req.json().catch(() => null)
  fs.mkdirSync(LIBRARY_DIR, { recursive: true })

  const imp = Import.safeParse(body)
  if (imp.success) {
    const project = loadProject(safeId(imp.data.fromProject))
    const scene = project.scenes.find((s) => s.id === imp.data.sceneId)
    const source = path.join(paths(project.id).images, `${imp.data.sceneId}.jpg`)
    if (!scene || !fs.existsSync(source)) throw new ApiError("that scene has no generated image yet", 404)
    const { width, height } = imageSize(project.format)
    const id = newImageId(scene.seed)
    fs.copyFileSync(source, imageFile(id))
    const prompt = project.style ? `${scene.imagePrompt}, ${project.style}` : scene.imagePrompt
    return NextResponse.json(addImage({ id, prompt, seed: scene.seed, width, height, tags: [...imp.data.tags, project.id] }), { status: 201 })
  }

  const gen = Generate.safeParse(body)
  if (!gen.success) throw new ApiError(gen.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "))
  const { prompt, format, tags } = gen.data
  const seed = gen.data.seed ?? Math.floor(Math.random() * 1e6)
  const { width, height } = imageSize(format)
  const id = newImageId(seed)
  await withRetry(() => pollinations.generate({ prompt, width, height, seed, file: imageFile(id) }), { retries: 3 })
  return NextResponse.json(addImage({ id, prompt, seed, width, height, tags }), { status: 201 })
})
