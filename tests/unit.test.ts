import { describe, expect, it } from "vitest"
import { ProjectSchema } from "../lib/schema.ts"
import { buildMessages, extractJson, generateStoryboard, parseStoryboard, sceneCount, slugify, toProject } from "../lib/pipeline/storyboard.ts"
import type { LlmProvider } from "../lib/providers/llm/pollinations.ts"
import { languageOf } from "../lib/languages.ts"
import { alignWords, buildCues, fallbackWords, filterPath, toAss } from "../lib/subtitles.ts"
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

describe("storyboard", () => {
  const good = JSON.stringify({
    title: "El mapa más antiguo",
    scenes: [
      { narration: "Uno.", imagePrompt: "a ship", motion: "pan-left" },
      { narration: "Dos.", imagePrompt: "a star" },
    ],
  })
  const req = { prompt: "x", language: "es", format: "9:16" as const, style: "oil painting", durationSec: 24 }

  it("extracts JSON from fences and surrounding text", () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('here: {"a":{"b":2}} done')).toEqual({ a: { b: 2 } })
    expect(() => extractJson("no json")).toThrow()
  })
  it("scales scene count with duration within limits", () => {
    expect([sceneCount(5), sceneCount(60), sceneCount(9999)]).toEqual([2, 5, 40])
  })
  it("asks for the right language, scene count and English image prompts", () => {
    const text = buildMessages(req).map((m) => m.content).join("\n")
    expect(text).toContain("Exactly 2 scenes")
    expect(text).toContain("Spanish")
    expect(text).toContain("always in English")
  })
  it("rejects storyboards with empty fields", () => {
    expect(() => parseStoryboard('{"title":"t","scenes":[{"narration":"","imagePrompt":"x"}]}')).toThrow(/narration/)
  })
  it("retries with the validation error and then succeeds", async () => {
    const seen: string[] = []
    const answers = ["not json at all", good]
    const llm: LlmProvider = { name: "fake", chat: async (msgs) => { seen.push(msgs.at(-1)!.content); return answers.shift()! } }
    const sb = await generateStoryboard(llm, req)
    expect(sb.scenes).toHaveLength(2)
    expect(seen[1]).toContain("invalid")
  })
  it("gives up after the attempt limit", async () => {
    const llm: LlmProvider = { name: "fake", chat: async () => "nope" }
    await expect(generateStoryboard(llm, req, 2)).rejects.toThrow(/2 attempts/)
  })
  it("builds a valid project with voice, defaults and rotating motions", () => {
    const p = toProject(parseStoryboard(good), req, "mapa")
    expect(p.voice).toBe(languageOf("es").voice)
    expect(p.scenes.map((s) => s.motion)).toEqual(["pan-left", "zoom-out"])
    expect(p.scenes.map((s) => s.id)).toEqual(["s1", "s2"])
    expect(ProjectSchema.safeParse(p).success).toBe(true)
  })
  it("slugifies accents and symbols, never empty", () => {
    expect(slugify("¡El mapa más antiguo!")).toBe("el-mapa-mas-antiguo")
    expect(slugify("???")).toBe("video")
  })
  it("rejects unsupported languages", () => {
    expect(() => languageOf("xx")).toThrow(/Unsupported/)
  })
})

describe("subtitles", () => {
  const w = (text: string, start: number) => ({ start, end: start + 0.4, text })
  it("keeps narration punctuation when the token count matches, else the raw words", () => {
    const words = [w("Hello", 0), w("there", 0.5)]
    expect(alignWords(words, "Hello, there.").map((x) => x.text)).toEqual(["Hello,", "there."])
    expect(alignWords(words, "Hello big there").map((x) => x.text)).toEqual(["Hello", "there"])
  })
  it("splits cues at sentence ends and at the character limit", () => {
    const words = alignWords(
      ["One", "two", "three.", "Four", "five", "six", "seven", "eight", "nine"].map((t, i) => w(t, i)),
      "One two three. Four five six seven eight nine",
    )
    const cues = buildCues(words, 16)
    expect(cues[0].text).toBe("One two three.")
    expect(cues.every((c) => c.text.length <= 16)).toBe(true)
    expect(cues.map((c) => c.text).join(" ")).toBe("One two three. Four five six seven eight nine")
  })
  it("carries trailing short words to the next cue", () => {
    const text = "entra en la atmósfera y se encuentra"
    const words = text.split(" ").map((t, i) => w(t, i))
    const cues = buildCues(words, 24).map((c) => c.text)
    expect(cues.every((c) => !/ (y|de|la|en|que)$/.test(c) || c === cues.at(-1))).toBe(true)
    expect(cues.join(" ")).toBe(text)
  })
  it("spreads fallback words over the whole audio", () => {
    const f = fallbackWords("aa bbbb cc", 6)
    expect(f[0].start).toBe(0)
    expect(f.at(-1)!.end).toBeCloseTo(6)
  })
  it("writes valid ASS with portrait resolution and escaped braces", () => {
    const ass = toAss([{ start: 0.5, end: 3725.25, text: "A {b} c" }], "9:16")
    expect(ass).toContain("PlayResY: 1920")
    expect(ass).toContain("Dialogue: 0,0:00:00.50,1:02:05.25,Default,,0,0,0,,A b c")
  })
  it("escapes Windows paths for the ffmpeg filter", () => {
    expect(filterPath("C:\\a b\\x.ass")).toBe("C\\:/a b/x.ass")
    expect(clipArgs({ image: "i", audio: "a", out: "o", format: "16:9", motion: "zoom-in", audioSec: 1, pad: 0, subtitles: "C:\\s.ass" }).args.join(" ")).toContain("ass='C\\:/s.ass'")
  })
})
