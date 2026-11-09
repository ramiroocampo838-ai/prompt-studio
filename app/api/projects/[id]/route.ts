import { NextResponse } from "next/server"
import { ApiError, route, safeId } from "../../../../lib/api.ts"
import { isRunning } from "../../../../lib/jobs.ts"
import { ProjectSchema } from "../../../../lib/schema.ts"
import { deleteProject, loadProject, saveProject } from "../../../../lib/store.ts"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export const GET = route(async (_req: Request, { params }: Ctx) => {
  return NextResponse.json(loadProject(safeId((await params).id)))
})

export const PUT = route(async (req: Request, { params }: Ctx) => {
  const id = safeId((await params).id)
  const current = loadProject(id) // 404 if it does not exist
  if (isRunning(id)) throw new ApiError("a render is running for this project", 409)
  const parsed = ProjectSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) throw new ApiError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "))
  if (parsed.data.id !== id) throw new ApiError("project id cannot change")
  // Cache keys belong to the server: a stale client copy must not erase them and force regeneration.
  const known = new Map(current.scenes.map((s) => [s.id, s]))
  parsed.data.scenes = parsed.data.scenes.map((s) => {
    const old = known.get(s.id)
    return { ...s, imageHash: old?.imageHash, audioHash: old?.audioHash, clipHash: old?.clipHash, audioDurationSec: old?.audioDurationSec }
  })
  saveProject(parsed.data)
  return NextResponse.json(parsed.data)
})

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const id = safeId((await params).id)
  loadProject(id)
  if (isRunning(id)) throw new ApiError("a render is running for this project", 409)
  deleteProject(id)
  return new Response(null, { status: 204 })
})
