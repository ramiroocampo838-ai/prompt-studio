import fs from "node:fs"
import path from "node:path"
import { RateLimitError } from "../../queue.ts"

export interface ImageRequest {
  prompt: string
  width: number
  height: number
  seed: number
  file: string
}

export interface ImageProvider {
  name: string
  generate(req: ImageRequest): Promise<void>
}

// Anonymous use is limited to ~1 image per 45 s per IP; the API answers 402 with Retry-After.
export const pollinations: ImageProvider = {
  name: "pollinations",
  async generate({ prompt, width, height, seed, file }) {
    const url =
      `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
      `?width=${width}&height=${height}&seed=${seed}&model=flux&nologo=true`
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
    if (res.status === 402) {
      const seconds = parseInt(res.headers.get("retry-after") ?? "45", 10) + 2
      throw new RateLimitError("Pollinations free limit reached", seconds * 1000)
    }
    const type = res.headers.get("content-type") ?? ""
    if (!res.ok || !type.startsWith("image/")) throw new Error(`Pollinations HTTP ${res.status} ${type}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 5_000) throw new Error(`Pollinations returned a tiny image (${buf.length} bytes)`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, buf)
  },
}
