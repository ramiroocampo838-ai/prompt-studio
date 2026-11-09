import fs from "node:fs"
import path from "node:path"
import { ApiError, route, safeId } from "../../../../../../../lib/api.ts"
import { paths } from "../../../../../../../lib/store.ts"

export const dynamic = "force-dynamic"

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
}
const KINDS = ["images", "audio", "out"] as const
const FILE_RE = /^[\w-]+\.[a-z0-9]+$/i

type Ctx = { params: Promise<{ id: string; kind: string; file: string }> }

// Serves generated media with Range support so the browser can seek inside videos.
export const GET = route(async (req: Request, { params }: Ctx) => {
  const { id, kind, file } = await params
  if (!(KINDS as readonly string[]).includes(kind) || !FILE_RE.test(file)) throw new ApiError("invalid media path")
  const full = path.join(paths(safeId(id))[kind as (typeof KINDS)[number]], file)
  const type = TYPES[path.extname(file).toLowerCase()]
  if (!type || !fs.existsSync(full)) throw new ApiError("media not found", 404)

  const size = fs.statSync(full).size
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "")
  const headers = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "no-store" }
  if (range && (range[1] || range[2])) {
    const start = range[1] ? parseInt(range[1], 10) : Math.max(0, size - parseInt(range[2], 10))
    const end = range[1] && range[2] ? Math.min(parseInt(range[2], 10), size - 1) : size - 1
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } })
    const chunk = fs.createReadStream(full, { start, end })
    return new Response(chunk as unknown as ReadableStream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    })
  }
  return new Response(fs.createReadStream(full) as unknown as ReadableStream, { headers: { ...headers, "Content-Length": String(size) } })
})
