"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { LANGUAGES } from "../lib/languages.ts"

interface Summary {
  id: string
  title: string
  format: string
  scenes: number
  hasVideo: boolean
  updatedAt: string
}

const DEFAULT_STYLE = "cinematic digital illustration, soft light, highly detailed"

export default function Home() {
  const router = useRouter()
  const [projects, setProjects] = useState<Summary[] | null>(null)
  const [prompt, setPrompt] = useState("")
  const [seconds, setSeconds] = useState(60)
  const [language, setLanguage] = useState("en")
  const [format, setFormat] = useState("16:9")
  const [style, setStyle] = useState(DEFAULT_STYLE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    const res = await fetch("/api/projects")
    setProjects(res.ok ? await res.json() : [])
  }, [])
  useEffect(() => {
    load()
  }, [load])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, seconds, language, format, style }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      router.push(`/projects/${data.id}`)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!confirm(`Delete project "${id}" and all its files?`)) return
    await fetch(`/api/projects/${id}`, { method: "DELETE" })
    load()
  }

  return (
    <>
      <h1>New video</h1>
      <p className="muted">Describe the idea. The storyboard is generated first so you can edit it before spending any image quota.</p>
      <form className="panel" onSubmit={create}>
        <div className="row">
          <div>
            <label htmlFor="prompt">Topic or idea</label>
            <textarea id="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Why is the sky blue, explained simply" rows={3} required minLength={3} />
          </div>
        </div>
        <div className="row c4">
          <div>
            <label htmlFor="style">Visual style</label>
            <input id="style" value={style} onChange={(e) => setStyle(e.target.value)} />
          </div>
          <div>
            <label htmlFor="seconds">Length (seconds)</label>
            <input id="seconds" type="number" min={10} max={600} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} />
          </div>
          <div>
            <label htmlFor="language">Narration language</label>
            <select id="language" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {Object.entries(LANGUAGES).map(([code, l]) => (
                <option key={code} value={code}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="format">Format</label>
            <select id="format" value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="16:9">16:9 (YouTube)</option>
              <option value="9:16">9:16 (Shorts)</option>
            </select>
          </div>
        </div>
        <div className="actions">
          <button disabled={busy}>{busy ? "Writing storyboard…" : "Create storyboard"}</button>
          {busy && <span className="muted">The free text service allows 1 request every 45 s; this can take up to a minute.</span>}
        </div>
        {error && <p className="err">{error}</p>}
      </form>

      <h2>Projects</h2>
      {projects === null ? (
        <p className="muted">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="muted">No projects yet.</p>
      ) : (
        <div className="grid">
          {projects.map((p) => (
            <div className="card" key={p.id}>
              <h3>
                <Link href={`/projects/${p.id}`}>{p.title}</Link>
              </h3>
              <div className="actions">
                <span className="badge">{p.format}</span>
                <span className="badge">{p.scenes} scenes</span>
                <span className={`badge ${p.hasVideo ? "ok" : "warn"}`}>{p.hasVideo ? "video ready" : "not rendered"}</span>
              </div>
              <span className="muted">{new Date(p.updatedAt).toLocaleString()}</span>
              <div className="actions">
                <Link href={`/projects/${p.id}`}>Open</Link>
                <button type="button" className="ghost danger" onClick={() => remove(p.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
