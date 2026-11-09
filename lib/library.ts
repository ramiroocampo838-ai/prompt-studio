import fs from "node:fs"
import path from "node:path"
import { LibraryImageSchema, type LibraryImage } from "./schema.ts"

// Reusable images shared by every project.
export const LIBRARY_DIR = path.resolve(process.cwd(), "data", "images")
const INDEX = path.join(LIBRARY_DIR, "index.json")

export const imageFile = (id: string) => path.join(LIBRARY_DIR, `${id}.jpg`)

export function listImages(): LibraryImage[] {
  if (!fs.existsSync(INDEX)) return []
  const items = LibraryImageSchema.array().parse(JSON.parse(fs.readFileSync(INDEX, "utf8")))
  return items.filter((i) => fs.existsSync(imageFile(i.id))).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function writeIndex(items: LibraryImage[]) {
  fs.mkdirSync(LIBRARY_DIR, { recursive: true })
  fs.writeFileSync(INDEX + ".tmp", JSON.stringify(items, null, 2))
  fs.renameSync(INDEX + ".tmp", INDEX)
}

export const getImage = (id: string) => listImages().find((i) => i.id === id)

export const cleanTags = (tags: string[]) => [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 12)

// Registers a file already placed at imageFile(meta.id).
export function addImage(meta: Omit<LibraryImage, "createdAt" | "tags"> & { tags?: string[] }): LibraryImage {
  const item = LibraryImageSchema.parse({ ...meta, tags: cleanTags(meta.tags ?? []), createdAt: new Date().toISOString() })
  writeIndex([...listImages(), item])
  return item
}

export function updateTags(id: string, tags: string[]): LibraryImage {
  const items = listImages()
  const item = items.find((i) => i.id === id)
  if (!item) throw new Error(`Image '${id}' not found`)
  item.tags = cleanTags(tags)
  writeIndex(items)
  return item
}

export function removeImage(id: string): void {
  if (!getImage(id)) throw new Error(`Image '${id}' not found`)
  writeIndex(listImages().filter((i) => i.id !== id))
  fs.rmSync(imageFile(id), { force: true })
}

export const newImageId = (seed: number) => `img-${Date.now().toString(36)}-${seed}`
