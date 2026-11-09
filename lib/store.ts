import fs from "node:fs"
import path from "node:path"
import { ProjectSchema, type Project } from "./schema.ts"

export const DATA_DIR = path.resolve(import.meta.dirname, "..", "data", "projects")

export const projectDir = (id: string) => path.join(DATA_DIR, id)

export function paths(id: string) {
  const root = projectDir(id)
  return {
    root,
    file: path.join(root, "project.json"),
    images: path.join(root, "images"),
    audio: path.join(root, "audio"),
    clips: path.join(root, "clips"),
    out: path.join(root, "out"),
  }
}

export function loadProject(id: string): Project {
  const file = paths(id).file
  if (!fs.existsSync(file)) throw new Error(`Project '${id}' not found at ${file}`)
  const parsed = ProjectSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")))
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ")
    throw new Error(`Invalid project '${id}':\n  ${issues}`)
  }
  return parsed.data
}

export function saveProject(project: Project): void {
  const p = paths(project.id)
  fs.mkdirSync(p.root, { recursive: true })
  const tmp = p.file + ".tmp"
  fs.writeFileSync(tmp, JSON.stringify(project, null, 2))
  fs.renameSync(tmp, p.file)
}

export function listProjects(): string[] {
  if (!fs.existsSync(DATA_DIR)) return []
  return fs
    .readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(DATA_DIR, d.name, "project.json")))
    .map((d) => d.name)
}
