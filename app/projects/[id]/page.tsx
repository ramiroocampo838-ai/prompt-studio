"use client"

import { useParams } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { MOTIONS, type LibraryImage, type Project, type Scene } from "../../../lib/schema.ts"

export default function Editor() {
  const { id } = useParams<{ id: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [stamp, setStamp] = useState(Date.now())
  const counter = useRef(1)
  const [picking, setPicking] = useState<number | null>(null)
  const [library, setLibrary] = useState<LibraryImage[] | null>(null)
  const [notice, setNotice] = useState("")
  const [meta, setMeta] = useState<{ title: string; description: string; tags: string[]; chapters: unknown[] } | null>(null)

  async function loadMeta() {
    const res = await fetch(`/api/projects/${id}/youtube`)
    const d = await res.json()
    if (res.ok) setMeta(d)
    else setError(d.error ?? `HTTP ${res.status}`)
  }
  async function cleanUp() {
    const res = await fetch(`/api/projects/${id}/clean`, { method: "POST" })
    const d = await res.json()
    setNotice(res.ok ? `Freed ${(d.freedBytes / 1e6).toFixed(1)} MB. The next render rebuilds the clips (images and voices are kept).` : d.error ?? `HTTP ${res.status}`)
  }

  function openPicker(i: number) {
    setPicking(picking === i ? null : i)
    fetch("/api/images").then((r) => r.json()).then(setLibrary).catch(() => setLibrary([]))
  }
  async function saveToLibrary(sceneId: string) {
    const res = await fetch("/api/images", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fromProject: id, sceneId }) })
    const d = await res.json()
    setNotice(res.ok ? "Saved to the library." : d.error ?? `HTTP ${res.status}`)
  }
  const [render, setRender] = useState<{ status: string; lines: string[]; error?: string }>({ status: "idle", lines: [] })
  const source = useRef<EventSource | null>(null)

  const listen = useCallback(
    (reset: boolean) => {
      source.current?.close()
      if (reset) setRender({ status: "running", lines: [] })
      const es = new EventSource(`/api/projects/${id}/render`)
      source.current = es
      es.addEventListener("line", (e) => setRender((r) => ({ ...r, lines: [...r.lines, JSON.parse(e.data)] })))
      es.addEventListener("state", (e) => {
        const st = JSON.parse(e.data)
        setRender((r) => ({ ...r, status: st.status, error: st.error }))
        if (st.status !== "running") {
          es.close()
          if (st.status === "done") {
            setStamp(Date.now())
            fetch(`/api/projects/${id}`).then((r) => r.json()).then((p) => !p.error && setProject(p))
          }
        }
      })
      es.onerror = () => es.close()
    },
    [id],
  )
  useEffect(() => {
    listen(false)
    return () => source.current?.close()
  }, [listen])

  const rendering = render.status === "running"
  const total = (() => {
    const m = render.lines.map((l) => l.match(/to do: (\d+) images, (\d+) voices, (\d+) clips/)).find(Boolean)
    return m ? Number(m[1]) + (Number(m[2]) ? 1 : 0) + Number(m[3]) + 1 : 0
  })()
  const doneSteps = render.lines.filter((l) => /^(image |voice |clip |Final:)/.test(l)).length
  const pct = render.status === "done" ? 100 : total ? Math.min(99, Math.round((doneSteps / total) * 100)) : 0

  async function startRender() {
    setError("")
    if (dirty && !(await save())) return
    const res = await fetch(`/api/projects/${id}/render`, { method: "POST" })
    if (!res.ok && res.status !== 409) return setError((await res.json()).error ?? `HTTP ${res.status}`)
    listen(true)
  }

  useEffect(() => {
    fetch(`/api/projects/${id}`)
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
        setProject(d)
      })
      .catch((e) => setError(e.message))
  }, [id])

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => dirty && e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  if (!project) return error ? <p className="err">{error}</p> : <p className="muted">Loading…</p>

  const edit = (fn: (p: Project) => Project) => {
    setProject(fn(project))
    setDirty(true)
  }
  const patchScene = (i: number, patch: Partial<Scene>) =>
    edit((p) => ({ ...p, scenes: p.scenes.map((s, j) => (j === i ? { ...s, ...patch } : s)) }))
  const newId = (p: Project) => {
    let n = p.scenes.length + counter.current++
    while (p.scenes.some((s) => s.id === `s${n}`)) n++
    return `s${n}`
  }
  const add = (at: number, copy?: Scene) =>
    edit((p) => {
      const scene: Scene = copy
        ? { ...copy, id: newId(p), imageHash: undefined, audioHash: undefined, clipHash: undefined, audioDurationSec: undefined }
        : { id: newId(p), narration: "New narration.", imagePrompt: "describe the image", seed: Math.floor(Math.random() * 1e6), motion: "zoom-in" }
      const scenes = [...p.scenes]
      scenes.splice(at, 0, scene)
      return { ...p, scenes }
    })
  const remove = (i: number) => project.scenes.length > 1 && edit((p) => ({ ...p, scenes: p.scenes.filter((_, j) => j !== i) }))
  const move = (i: number, d: number) =>
    edit((p) => {
      const scenes = [...p.scenes]
      const [s] = scenes.splice(i, 1)
      scenes.splice(i + d, 0, s)
      return { ...p, scenes }
    })

  async function save(): Promise<boolean> {
    setSaving(true)
    setError("")
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(project) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
      setProject(d)
      setDirty(false)
      setStamp(Date.now())
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setSaving(false)
    }
  }

  const portrait = project.format === "9:16"
  return (
    <>
      <div className="sticky">
        <div>
          <strong>{project.title}</strong> <span className="badge">{project.format}</span> {dirty && <span className="badge warn">unsaved</span>}
        </div>
        <div className="actions">
          <button type="button" className="ghost" onClick={save} disabled={!dirty || saving || rendering}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={startRender} disabled={rendering || saving}>
            {rendering ? "Rendering…" : "Render video"}
          </button>
        </div>
      </div>
      {error && <p className="err">{error}</p>}
      {notice && <p className="muted">{notice}</p>}

      {render.status !== "idle" && (
        <div className="panel">
          <h2>Render {render.status === "done" ? "finished" : render.status === "error" ? "failed" : "in progress"}</h2>
          <div className="bar">
            <div style={{ width: `${pct}%` }} />
          </div>
          <pre className="log">{render.lines.slice(-8).join("\n")}</pre>
          {render.error && <p className="err">{render.error}</p>}
        </div>
      )}

      {!rendering && (
        <div className="panel">
          <h2>Video</h2>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video key={stamp} className={portrait ? "player portrait" : "player"} controls preload="metadata" src={`/api/projects/${id}/media/out/${id}.mp4?v=${stamp}`} />
          <div className="actions" style={{ marginTop: 10 }}>
            <a href={`/api/projects/${id}/media/out/${id}.mp4`} download={`${id}.mp4`}>
              Download MP4
            </a>
            <span className="muted">Only changed scenes are regenerated on each render.</span>
          </div>
          <div className="actions" style={{ marginTop: 10 }}>
            <button type="button" className="ghost" onClick={loadMeta}>
              YouTube metadata
            </button>
            <button type="button" className="ghost" onClick={cleanUp}>
              Free disk space
            </button>
          </div>
          {meta && (
            <div style={{ marginTop: 12 }}>
              <label>Title</label>
              <input readOnly value={meta.title} onFocus={(e) => e.target.select()} />
              <label style={{ marginTop: 10 }}>Description (with chapters)</label>
              <textarea readOnly rows={Math.min(14, meta.description.split("\n").length + 1)} value={meta.description} onFocus={(e) => e.target.select()} />
              <label style={{ marginTop: 10 }}>Tags</label>
              <input readOnly value={meta.tags.join(", ")} onFocus={(e) => e.target.select()} />
              {!meta.chapters.length && <p className="note">No chapters: render first, and the video needs at least three sections of 10 s or more.</p>}
            </div>
          )}
        </div>
      )}

      <div className="panel">
        <div className="row c2">
          <div>
            <label>Title</label>
            <input value={project.title} onChange={(e) => edit((p) => ({ ...p, title: e.target.value }))} />
          </div>
          <div>
            <label>Visual style (applies to every image)</label>
            <input value={project.style} onChange={(e) => edit((p) => ({ ...p, style: e.target.value }))} />
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={project.subtitles} onChange={(e) => edit((p) => ({ ...p, subtitles: e.target.checked }))} />
          Burn subtitles into the video
        </label>
      </div>

      {project.scenes.map((s, i) => (
        <div className="scene" key={s.id}>
          <div>
            <div className={`thumb ${portrait ? "portrait" : ""}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img key={s.imageRef ?? "gen"} src={s.imageRef ? `/api/images/${s.imageRef}/file` : `/api/projects/${id}/media/images/${s.id}.jpg?v=${stamp}`} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />
            </div>
            <div className="actions" style={{ marginTop: 8 }}>
              <button type="button" className="ghost" onClick={() => openPicker(i)}>
                Library
              </button>
              {s.imageRef && (
                <button type="button" className="ghost" onClick={() => patchScene(i, { imageRef: undefined })}>
                  Generate instead
                </button>
              )}
              {!s.imageRef && !dirty && (
                <button type="button" className="ghost" onClick={() => saveToLibrary(s.id)}>
                  Save to library
                </button>
              )}
            </div>
            {picking === i && (
              <div className="picker">
                {library === null ? (
                  <span className="muted">Loading…</span>
                ) : library.length === 0 ? (
                  <span className="muted">The library is empty.</span>
                ) : (
                  library.map((img) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={img.id} src={`/api/images/${img.id}/file`} alt={img.prompt} title={img.prompt} onClick={() => { patchScene(i, { imageRef: img.id }); setPicking(null) }} />
                  ))
                )}
              </div>
            )}
          </div>
          <div>
            <div className="scene-head">
              <strong>
                Scene {i + 1} <span className="muted">({s.id})</span>
              </strong>
              <div className="actions">
                <button type="button" className="ghost" disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" className="ghost" disabled={i === project.scenes.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button type="button" className="ghost" onClick={() => add(i + 1, s)}>
                  Duplicate
                </button>
                <button type="button" className="ghost" onClick={() => add(i + 1)}>
                  + Below
                </button>
                <button type="button" className="ghost danger" disabled={project.scenes.length === 1} onClick={() => remove(i)}>
                  Delete
                </button>
              </div>
            </div>
            <div className="row">
              <div>
                <label>Narration</label>
                <textarea value={s.narration} onChange={(e) => patchScene(i, { narration: e.target.value })} rows={3} />
              </div>
            </div>
            <div className="row">
              <div>
                <label>Image prompt</label>
                <textarea value={s.imagePrompt} onChange={(e) => patchScene(i, { imagePrompt: e.target.value })} rows={2} />
              </div>
            </div>
            <div className="row c3">
              <div>
                <label>Camera motion</label>
                <select value={s.motion} onChange={(e) => patchScene(i, { motion: e.target.value as Scene["motion"] })}>
                  {MOTIONS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Seed (change it to get a different image)</label>
                <div className="actions" style={{ flexWrap: "nowrap" }}>
                  <input type="number" value={s.seed} onChange={(e) => patchScene(i, { seed: Math.trunc(Number(e.target.value)) })} />
                  <button type="button" className="ghost" title="Random seed" onClick={() => patchScene(i, { seed: Math.floor(Math.random() * 1e6) })}>
                    🎲
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
      <button type="button" className="ghost" onClick={() => add(project.scenes.length)}>
        + Add scene
      </button>
    </>
  )
}
