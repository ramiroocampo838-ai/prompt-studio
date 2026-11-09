import { NextResponse } from "next/server"
import { ApiError, route, safeId } from "../../../../../lib/api.ts"
import { isRunning } from "../../../../../lib/jobs.ts"
import { cleanIntermediates, loadProject } from "../../../../../lib/store.ts"

export const dynamic = "force-dynamic"

export const POST = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = safeId((await params).id)
  loadProject(id)
  if (isRunning(id)) throw new ApiError("a render is running for this project", 409)
  return NextResponse.json({ freedBytes: cleanIntermediates(id) })
})
