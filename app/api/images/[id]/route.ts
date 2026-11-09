import { NextResponse } from "next/server"
import { z } from "zod"
import { ApiError, route, safeId } from "../../../../lib/api.ts"
import { removeImage, updateTags } from "../../../../lib/library.ts"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const body = z.object({ tags: z.array(z.string()) }).safeParse(await req.json().catch(() => null))
  if (!body.success) throw new ApiError("tags must be an array of strings")
  return NextResponse.json(updateTags(safeId((await params).id), body.data.tags))
})

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  removeImage(safeId((await params).id))
  return new Response(null, { status: 204 })
})
