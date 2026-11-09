import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

export interface Voice {
  name: string
  locale: string
  gender: string
  label: string
}

const ROOT = process.cwd()
const CACHE = path.join(ROOT, "data", "voices.json")
const TTS_SCRIPT = path.join(ROOT, "tools", "tts.py")
const MAX_AGE_MS = 7 * 24 * 3600 * 1000

// Cached for a week: the list changes rarely and needs the network.
export function loadVoices(refresh = false): Voice[] {
  const fresh = fs.existsSync(CACHE) && Date.now() - fs.statSync(CACHE).mtimeMs < MAX_AGE_MS
  if (refresh || !fresh) {
    const r = spawnSync("python", [TTS_SCRIPT, "--list-voices", CACHE], { encoding: "utf8" })
    if (r.status !== 0) {
      if (!fs.existsSync(CACHE)) throw new Error(`Could not list voices:\n${(r.stderr || r.stdout).trim().split("\n").slice(-3).join("\n")}`)
    }
  }
  return JSON.parse(fs.readFileSync(CACHE, "utf8")) as Voice[]
}

// Filters by language code ("es"), locale ("es-MX") or part of the voice name.
export function filterVoices(voices: Voice[], query?: string): Voice[] {
  if (!query) return voices
  const q = query.toLowerCase()
  return voices.filter((v) => v.locale.toLowerCase().startsWith(q) || v.name.toLowerCase().includes(q))
}

export function assertVoice(voices: Voice[], name: string): void {
  if (!voices.some((v) => v.name === name)) {
    throw new Error(`Unknown voice '${name}'. List them with: pnpm studio voices <lang>`)
  }
}
