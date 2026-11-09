"""Text to speech with edge-tts, plus word timings for subtitles.

Usage:
  python tts.py <jobs.json>            synthesize; writes <out> and <out>.words.json
  python tts.py --list-voices <out>    write all available voices as JSON

jobs.json: [{"text": "...", "voice": "en-US-GuyNeural", "out": "path/to/file.mp3"}]
words.json: [{"start": 0.1, "end": 0.5, "text": "Hello"}]  (seconds)
"""
import asyncio
import json
import os
import sys

import edge_tts

TICKS = 10_000_000  # edge-tts offsets are in 100 ns units


async def synthesize(job):
    os.makedirs(os.path.dirname(job["out"]), exist_ok=True)
    comm = edge_tts.Communicate(job["text"], job["voice"], boundary="WordBoundary")
    words = []
    with open(job["out"], "wb") as audio:
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                audio.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                words.append({
                    "start": round(chunk["offset"] / TICKS, 3),
                    "end": round((chunk["offset"] + chunk["duration"]) / TICKS, 3),
                    "text": chunk["text"],
                })
    with open(job["out"] + ".words.json", "w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False)
    print(f"audio {job['out']}")


async def main(jobs_path):
    with open(jobs_path, encoding="utf-8") as f:
        jobs = json.load(f)
    for job in jobs:
        await synthesize(job)


async def list_voices(out):
    voices = await edge_tts.list_voices()
    slim = [
        {"name": v["ShortName"], "locale": v["Locale"], "gender": v["Gender"], "label": v["FriendlyName"]}
        for v in voices
    ]
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(slim, f, ensure_ascii=False)
    print(f"{len(slim)} voices")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--list-voices":
        asyncio.run(list_voices(sys.argv[2]))
    elif len(sys.argv) == 2:
        asyncio.run(main(sys.argv[1]))
    else:
        sys.exit(__doc__)
