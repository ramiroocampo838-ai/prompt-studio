import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

export interface TtsJob {
  text: string
  voice: string
  out: string
}

const TTS_SCRIPT = path.resolve(import.meta.dirname, "..", "..", "..", "tools", "tts.py")

export function synthesizeEdge(jobs: TtsJob[]): void {
  if (!jobs.length) return
  const jobsFile = path.join(os.tmpdir(), `prompt-studio-tts-${process.pid}.json`)
  fs.writeFileSync(jobsFile, JSON.stringify(jobs))
  try {
    const r = spawnSync("python", [TTS_SCRIPT, jobsFile], { encoding: "utf8" })
    if (r.status !== 0) {
      const detail = (r.stderr || r.stdout || "").trim().split("\n").slice(-3).join("\n")
      const hint = detail.includes("403") ? "\nHint: run `pip install -U edge-tts`." : ""
      throw new Error(`edge-tts failed:\n${detail}${hint}`)
    }
  } finally {
    fs.rmSync(jobsFile, { force: true })
  }
}
