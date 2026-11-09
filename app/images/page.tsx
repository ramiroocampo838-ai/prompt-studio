"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { LibraryImage } from "../../lib/schema.ts"

export default function Images() {
  const [images, setImages] = useState<LibraryImage[] | null>(null)
  const [prompt, setPrompt] = useState("")
  const [format, setFormat] = useState("16:9")
  const [count, setCount] = useState(1)
  const [tags, setTags] = useState("")
  const [filter, setFilter] = useState("")
  const [status, setStatus] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    const res = await fetch("/api/images")
    setImages(res.ok ? await res.json() : [])
  }, [])
  useEffect(() => {
    load()
  }, [load])

  async function generate(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError("")
    try {
      for (let i = 1; i <= count; i++) {
        setStatus(`Generating image ${i} of ${count}… (the free service allows about 1 every 45 s)`)
        const res = await fetch("/api/images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, format, tags: tags.split(",") }),
        })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
        await load()
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
      setStatus("")
    }
  }

  async function retag(img: LibraryImage) {
    const next = window.prompt("Tags (comma separated)", img.tags.join(", "))
    if (next === null) return
    await fetch(`/api/images/${img.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tags: next.split(",") }) })
    load()
  }

  async function remove(img: LibraryImage) {
    if (!confirm("Delete this image from the library? Projects that already rendered it are not affected.")) return
    await fetch(`/api/images/${img.id}`, { method: "DELETE" })
    load()
  }

  const allTags = useMemo(() => [...new Set((images ?? []).flatMap((i) => i.tags))].sort(), [images])
  const shown = (images ?? []).filter((i) => !filter || i.tags.includes(filter))

  return (
    <>
      <h1>Images</h1>
      <p className="muted">Generate standalone images and reuse them in any video from the scene editor.</p>
      <form className="panel" onSubmit={generate}>
        <div className="row">
          <div>
            <label htmlFor="p">Describe the image</label>
            <textarea id="p" rows={2} required minLength={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="a lighthouse on a cliff at sunset, oil painting" />
          </div>
        </div>
        <div className="row c3">
          <div>
            <label htmlFor="f">Format</label>
            <select id="f" value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="16:9">16:9 (landscape)</option>
              <option value="9:16">9:16 (vertical)</option>
            </select>
          </div>
          <div>
            <label htmlFor="c">Variations (different seeds)</label>
            <input id="c" type="number" min={1} max={4} value={count} onChange={(e) => setCount(Math.min(4, Math.max(1, Number(e.target.value) || 1)))} />
          </div>
          <div>
            <label htmlFor="t">Tags (comma separated)</label>
            <input id="t" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="sea, intro" />
          </div>
        </div>
        <div className="actions">
          <button disabled={busy}>{busy ? "Generating…" : "Generate"}</button>
          {status && <span className="muted">{status}</span>}
        </div>
        {error && <p className="err">{error}</p>}
      </form>

      <div className="actions" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Library</h2>
        {allTags.length > 0 && (
          <select style={{ width: "auto" }} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All tags</option>
            {allTags.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        )}
      </div>
      {images === null ? (
        <p className="muted">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="muted">No images yet.</p>
      ) : (
        <div className="grid">
          {shown.map((img) => (
            <div className="card" key={img.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="gallery-img" src={`/api/images/${img.id}/file`} alt={img.prompt} />
              <span className="muted" style={{ fontSize: 13 }}>{img.prompt}</span>
              <div className="actions">
                <span className="badge">{img.width}×{img.height}</span>
                {img.tags.map((t) => (
                  <span className="badge" key={t}>{t}</span>
                ))}
              </div>
              <div className="actions">
                <button type="button" className="ghost" onClick={() => retag(img)}>Tags</button>
                <a href={`/api/images/${img.id}/file`} download={`${img.id}.jpg`}>Download</a>
                <button type="button" className="ghost danger" onClick={() => remove(img)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
