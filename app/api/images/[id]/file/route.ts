import fs from "node:fs"
import { ApiError, route, safeId } from "../../../../../lib/api.ts"
import { imageFile } from "../../../../../lib/library.ts"

export const dynamic = "force-dynamic"

export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const file = imageFile(safeId((await params).id))
  if (!fs.existsSync(file)) throw new ApiError("image not found", 404)
  return new Response(fs.readFileSync(file), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" } })
})
