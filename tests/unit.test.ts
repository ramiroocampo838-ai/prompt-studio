import { describe, expect, it } from "vitest"
import { ProjectSchema } from "../lib/schema.ts"
import { hashOf } from "../lib/hash.ts"
import { RateLimitError, mapLimit, withRetry } from "../lib/queue.ts"
import { clipArgs, concatList, motionFilter } from "../lib/ffmpeg.ts"
import { planStale, imageHashOf, audioHashOf, clipHashOf } from "../lib/pipeline/build.ts"

const scene = (id: string, extra = {}) => ({ id, narration: "Hello world.", imagePrompt: "a fox", ...extra })
const project = (scenes = [scene("a"), scene("b")]) => ProjectSchema.parse({ id: "p1", title: "T", scenes })

describe("schema", () => {
  it("applies defaults", () => {
    const p = project()
    expect(p.format).toBe("16:9")
    expect(p.scenes[0].motion).toBe("zoom-in")
  })
  it("rejects empty narration and duplicate ids", () => {
    expect(ProjectSchema.safeParse({ id: "p", title: "T", scenes: [scene("a", { narration: " " })] }).success).toBe(false)
    expect(ProjectSchema.safeParse({ id: "p", title: "T", scenes: [scene("a"), scene("a")] }).success).toBe(false)
  })
  it("rejects ids that are not simple slugs", () => {
    expect(ProjectSchema.safeParse({ id: "../x", title: "T", scenes: [scene("a")] }).success).toBe(false)
  })
})

describe("hashOf", () => {
  it("is stable and sensitive to every part", () => {
    expect(hashOf("a", 1)).toBe(hashOf("a", 1))
    expect(hashOf("a", 1)).not.toBe(hashOf("a", 2))
    expect(hashOf("ab", "c")).not.toBe(hashOf("a", "bc"))
  })
})

describe("withRetry", () => {
  const noWait = async () => {}
  it("retries then succeeds", async () => {
    let n = 0
    const r = await withRetry(async () => { if (++n < 3) throw new Error("x"); return "ok" }, { sleep: noWait })
    expect([r, n]).toEqual(["ok", 3])
  })
  it("honors RateLimitError wait and gives up after the retry limit", async () => {
    const waits: number[] = []
    await expect(
      withRetry(async () => { throw new RateLimitError("slow", 4000) }, { retries: 3, sleep: async (ms) => { waits.push(ms) } }),
    ).rejects.toThrow("slow")
    expect(waits).toEqual([4000, 4000])
  })
})

describe("mapLimit", () => {
  it("keeps order and respects the limit", async () => {
    let active = 0, peak = 0
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      peak = Math.max(peak, ++active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return n * 2
    })
    expect(out).toEqual([2, 4, 6, 8, 10])
    expect(peak).toBe(2)
  })
})

describe("ffmpeg commands", () => {
  const base = { image: "i.jpg", audio: "a.mp3", out: "o.mp4", format: "16:9" as const, motion: "zoom-in" as const, audioSec: 4, pad: 0.6 }
  it("computes duration and frame count", () => {
    const { args, totalSec } = clipArgs(base)
    expect(totalSec).toBeCloseTo(4.6)
    expect(args.join(" ")).toContain("d=115:s=1920x1080:fps=25")
  })
  it("uses portrait size for 9:16", () => {
    expect(clipArgs({ ...base, format: "9:16" }).args.join(" ")).toContain("s=1080x1920")
  })
  it("has a distinct motion per type", () => {
    const zs = (["zoom-in", "zoom-out", "pan-left", "pan-right"] as const).map((m) => JSON.stringify(motionFilter(m, 100)))
    expect(new Set(zs).size).toBe(4)
  })
  it("writes forward slashes in the concat list", () => {
    expect(concatList(["C:\\a\\1.mp4", "C:\\a\\2.mp4"])).toBe("file 'C:/a/1.mp4'\nfile 'C:/a/2.mp4'")
  })
})

describe("planStale", () => {
  const fresh = () => {
    const p = project()
    for (const s of p.scenes) {
      s.imageHash = imageHashOf(p, s, "prov")
      s.audioHash = audioHashOf(p, s)
      s.audioDurationSec = 3
      s.clipHash = clipHashOf(p, s, s.imageHash, s.audioHash)
    }
    return p
  }
  it("is empty when everything is fresh", () => {
    expect(planStale(fresh(), "prov", () => true)).toEqual({ images: [], audio: [], clips: [] })
  })
  it("only reruns the scene whose narration changed", () => {
    const p = fresh()
    p.scenes[1].narration = "Something else."
    expect(planStale(p, "prov", () => true)).toEqual({ images: [], audio: ["b"], clips: ["b"] })
  })
  it("changing the style invalidates images and clips of all scenes", () => {
    const p = fresh()
    p.style = "watercolor"
    expect(planStale(p, "prov", () => true)).toEqual({ images: ["a", "b"], audio: [], clips: ["a", "b"] })
  })
  it("treats missing files as stale", () => {
    const s = planStale(fresh(), "prov", (f) => !f.endsWith("a.mp3"))
    expect(s.audio).toEqual(["a"])
    expect(s.clips).toEqual(["a"])
  })
})
