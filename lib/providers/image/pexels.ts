import fs from "node:fs"
import path from "node:path"
import type { ImageProvider, ImageRequest } from "./pollinations.ts"

const STOP = new Set(
  ("a an the of in on at with and or to for from by into over under near as is are was were be its it this that his her their cinematic digital illustration soft light highly detailed style photo photograph image picture scene very " +
    "del los las una uno unos unas por que qué como cómo para con sin sobre muy más este esta ese esa explicado explicada sencilla sencillo forma " +
    "des les une pour dans que qui sur avec uma uns por para com sem sobre der die das und mit fur für della degli per con sul")
    .split(" "),
)

// Stock search works on plain keywords, so keep the first few meaningful words of the image prompt.
export function keywordsOf(prompt: string, max = 4): string {
  const words = prompt.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w))
  return [...new Set(words)].slice(0, max).join(" ")
}

interface Photo {
  src: { large2x: string }
  photographer: string
}

// Stock photos from Pexels (free key, no attribution required). Used when the generator is down.
export function makePexels(key: string, fetchFn: typeof fetch = fetch): ImageProvider {
  return {
    name: "pexels",
    async generate({ prompt, width, height, seed, file }: ImageRequest) {
      const query = keywordsOf(prompt)
      if (!query) throw new Error("Pexels: the prompt has no searchable keywords")
      const orientation = height > width ? "portrait" : "landscape"
      const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=8`
      const res = await fetchFn(url, { headers: { Authorization: key }, signal: AbortSignal.timeout(30_000) })
      if (!res.ok) throw new Error(`Pexels HTTP ${res.status}`)
      const { photos } = (await res.json()) as { photos: Photo[] }
      if (!photos?.length) throw new Error(`Pexels found nothing for "${query}"`)
      const photo = photos[Math.abs(seed) % photos.length]
      const img = await fetchFn(photo.src.large2x, { signal: AbortSignal.timeout(60_000) })
      if (!img.ok) throw new Error(`Pexels image HTTP ${img.status}`)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, Buffer.from(await img.arrayBuffer()))
    },
  }
}

export const pexelsFromEnv = (): ImageProvider | undefined => (process.env.PEXELS_API_KEY ? makePexels(process.env.PEXELS_API_KEY) : undefined)
