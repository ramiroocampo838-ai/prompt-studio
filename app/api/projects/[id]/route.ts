import { NextResponse } from "next/server"
import { ApiError, route, safeId } from "../../../../lib/api.ts"
import { ProjectSchema } from "../../../../lib/schema.ts"
import { deleteProject, loadProject, saveProject } from "../../../../lib/store.ts"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export const GET = route(async (_req: Request, { params }: Ctx) => {
  return NextResponse.json(loadProject(safeId((await params).id)))
})

export const PUT = route(async (req: Request, { params }: Ctx) => {
  const id = safeId((await params).id)
  loadProject(id) // 404 if it does not exist
  const parsed = ProjectSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) throw new ApiError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "))
  if (parsed.data.id !== id) throw new ApiError("project id cannot change")
  saveProject(parsed.data)
  return NextResponse.json(parsed.data)
})

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const id = safeId((await params).id)
  loadProject(id)
  deleteProject(id)
  return new Response(null, { status: 204 })
})
