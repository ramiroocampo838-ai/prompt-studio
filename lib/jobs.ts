import { spawn } from "node:child_process"

export interface Job {
  projectId: string
  status: "running" | "done" | "error"
  lines: string[]
  startedAt: number
  error?: string
}

type Listener = (job: Job, line?: string) => void

// Kept on globalThis so dev-mode module reloads don't lose running jobs.
const g = globalThis as unknown as { __jobs?: Map<string, Job>; __listeners?: Map<string, Set<Listener>> }
const jobs = (g.__jobs ??= new Map<string, Job>())
const listeners = (g.__listeners ??= new Map<string, Set<Listener>>())

export const getJob = (id: string) => jobs.get(id)
export const isRunning = (id: string) => jobs.get(id)?.status === "running"

export function subscribe(id: string, fn: Listener): () => void {
  const set = listeners.get(id) ?? new Set()
  set.add(fn)
  listeners.set(id, set)
  return () => set.delete(fn)
}

const emit = (job: Job, line?: string) => listeners.get(job.projectId)?.forEach((fn) => fn(job, line))

// The build uses synchronous ffmpeg/edge-tts calls, so it runs in a child process to keep the server responsive.
export function startBuild(projectId: string): Job {
  if (isRunning(projectId)) throw new Error("already running")
  const job: Job = { projectId, status: "running", lines: [], startedAt: Date.now() }
  jobs.set(projectId, job)
  const child = spawn(process.execPath, ["--use-system-ca", "scripts/studio.ts", "build", projectId], { cwd: process.cwd() })
  const push = (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (!line.trim()) continue
      job.lines.push(line)
      if (job.lines.length > 500) job.lines.shift()
      emit(job, line)
    }
  }
  child.stdout.on("data", push)
  child.stderr.on("data", push)
  child.on("error", (e) => {
    job.status = "error"
    job.error = e.message
    emit(job)
  })
  child.on("close", (code) => {
    if (job.status === "running") {
      job.status = code === 0 ? "done" : "error"
      if (code !== 0) job.error = job.lines.slice(-3).join("\n") || `exit code ${code}`
    }
    emit(job)
  })
  return job
}
