import fs from "node:fs"
import path from "node:path"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Downloads one image for a prompt. Same prompt + seed returns the same image.
// Anonymous use is limited to 1 image per ~45 s per IP; the API answers 402 with Retry-After.
export async function generateImage({ prompt, width, height, seed, file, retries = 5 }) {
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=${width}&height=${height}&seed=${seed}&model=flux&nologo=true`
  let lastError
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
      const type = res.headers.get("content-type") ?? ""
      if (res.status === 402) {
        const wait = (parseInt(res.headers.get("retry-after") ?? "45", 10) + 2) * 1000
        console.log(`  rate limited, waiting ${wait / 1000}s`)
        await sleep(wait)
        throw new Error("rate limited (402)")
      }
      if (!res.ok || !type.startsWith("image/")) throw new Error(`HTTP ${res.status} ${type}`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 5_000) throw new Error(`image too small (${buf.length} bytes)`)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, buf)
      return file
    } catch (e) {
      lastError = e
      await sleep(2000 * attempt)
    }
  }
  throw new Error(`Pollinations failed for "${prompt.slice(0, 50)}": ${lastError?.message}`)
}
