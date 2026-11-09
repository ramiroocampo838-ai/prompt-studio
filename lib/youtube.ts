import type { Project } from "./schema.ts"
import { keywordsOf } from "./providers/image/pexels.ts"

export interface YoutubeMetadata {
  title: string
  description: string
  tags: string[]
  chapters: { time: string; label: string }[]
}

export const stamp = (sec: number) => {
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

const label = (narration: string) => {
  const words = narration.replace(/[.,;:!?¡¿"“”]+/g, "").split(/\s+/).filter(Boolean).slice(0, 5).join(" ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// YouTube chapters need to start at 0:00, be at least 3, and last 10 s or more: short scenes are merged.
export function chaptersOf(p: Project, minSec = 10): YoutubeMetadata["chapters"] {
  const groups: { start: number; narration: string }[] = []
  let t = 0
  for (const s of p.scenes) {
    if (s.audioDurationSec === undefined) return []
    if (!groups.length || t - groups[groups.length - 1].start >= minSec) groups.push({ start: t, narration: s.narration })
    t += s.audioDurationSec + p.padSeconds
  }
  // The last chapter must also last at least minSec: fold it into the previous one otherwise.
  if (groups.length > 1 && t - groups[groups.length - 1].start < minSec) groups.pop()
  return groups.length >= 3 ? groups.map((g) => ({ time: stamp(g.start), label: label(g.narration) })) : []
}

export function youtubeMetadata(p: Project): YoutubeMetadata {
  const chapters = chaptersOf(p)
  const tags = keywordsOf(`${p.title} ${p.prompt}`, 8).split(" ").filter(Boolean)
  const lines = [p.prompt || p.title, ""]
  if (chapters.length) lines.push(...chapters.map((c) => `${c.time} ${c.label}`), "")
  lines.push([...tags.slice(0, 3).map((t) => `#${t}`), ...(p.format === "9:16" ? ["#Shorts"] : [])].join(" "))
  return { title: p.title.slice(0, 100), description: lines.join("\n").trim(), tags, chapters }
}
