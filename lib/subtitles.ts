import type { Format } from "./schema.ts"

export interface Word {
  start: number
  end: number
  text: string
}

export interface Cue {
  start: number
  end: number
  text: string
}

const SENTENCE_END = /[.!?…。！？]["'”’)»]*$/
const CLAUSE_END = /[,;:，；：]["'”’)»]*$/

// Edge word boundaries come without punctuation; when the token count matches the narration,
// use the narration's own tokens so cues can break at sentences and keep their punctuation.
export function alignWords(words: Word[], narration: string): Word[] {
  const tokens = narration.trim().split(/\s+/).filter(Boolean)
  if (tokens.length !== words.length) return words
  return words.map((w, i) => ({ ...w, text: tokens[i] }))
}

// Without timings, spread the words over the audio proportionally to their length.
export function fallbackWords(narration: string, durationSec: number): Word[] {
  const tokens = narration.trim().split(/\s+/).filter(Boolean)
  const total = tokens.reduce((n, t) => n + t.length + 1, 0)
  let at = 0
  return tokens.map((text) => {
    const span = ((text.length + 1) / total) * durationSec
    const w = { start: at, end: at + span, text }
    at += span
    return w
  })
}

export const MAX_CHARS: Record<Format, number> = { "16:9": 44, "9:16": 24 }

// Groups words into cues of at most maxChars, preferring to break after sentences and clauses.
export function buildCues(words: Word[], maxChars: number): Cue[] {
  const cues: Cue[] = []
  let cur: Word[] = []
  const flush = () => {
    if (!cur.length) return
    cues.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text).join(" ") })
    cur = []
  }
  const len = (ws: Word[]) => ws.reduce((n, w) => n + w.text.length, 0) + Math.max(0, ws.length - 1)
  for (const w of words) {
    if (cur.length && len([...cur, w]) > maxChars) {
      // Carry trailing short function words ("y", "de", "que la") to the next cue.
      const carry: Word[] = []
      while (cur.length > 1 && carry.length < 2 && cur[cur.length - 1].text.length <= 3 && !/[.,;:!?]$/.test(cur[cur.length - 1].text)) {
        carry.unshift(cur.pop()!)
      }
      flush()
      cur = carry
    }
    cur.push(w)
    const text = cur.map((x) => x.text).join(" ")
    if (SENTENCE_END.test(w.text) || (CLAUSE_END.test(w.text) && text.length >= maxChars * 0.6)) flush()
  }
  flush()
  // A cue stays on screen until the next one starts, so there are no flickering gaps.
  return cues.map((c, i) => ({ ...c, end: i + 1 < cues.length ? Math.max(c.end, Math.min(cues[i + 1].start, c.end + 0.4)) : c.end }))
}

const assTime = (sec: number) => {
  const cs = Math.round(sec * 100)
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`
}

const assText = (t: string) => t.replace(/[{}\\]/g, "").replace(/\r?\n/g, " ")

const STYLE: Record<Format, { w: number; h: number; size: number; marginV: number; marginH: number }> = {
  "16:9": { w: 1920, h: 1080, size: 58, marginV: 70, marginH: 160 },
  "9:16": { w: 1080, h: 1920, size: 72, marginV: 380, marginH: 80 },
}

export function toAss(cues: Cue[], format: Format): string {
  const s = STYLE[format]
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${s.w}`,
    `PlayResY: ${s.h}`,
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    `Style: Default,Arial,${s.size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,2,2,${s.marginH},${s.marginH},${s.marginV},1`,
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
  ]
  const events = cues.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${assText(c.text)}`)
  return [...header, ...events, ""].join("\n")
}

// Escapes a path for use inside an ffmpeg filter argument (Windows drive colon and backslashes).
export const filterPath = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:")
