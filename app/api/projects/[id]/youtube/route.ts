import { NextResponse } from "next/server"
import { route, safeId } from "../../../../../lib/api.ts"
import { loadProject } from "../../../../../lib/store.ts"
import { youtubeMetadata } from "../../../../../lib/youtube.ts"

export const dynamic = "force-dynamic"

export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  return NextResponse.json(youtubeMetadata(loadProject(safeId((await params).id))))
})
