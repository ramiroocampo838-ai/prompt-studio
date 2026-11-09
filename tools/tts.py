"""Text to speech with edge-tts.

Usage: python tts.py <jobs.json>
jobs.json: [{"text": "...", "voice": "en-US-GuyNeural", "out": "path/to/file.mp3"}]
"""
import asyncio
import json
import os
import sys

import edge_tts


async def main(jobs_path):
    with open(jobs_path, encoding="utf-8") as f:
        jobs = json.load(f)
    for job in jobs:
        os.makedirs(os.path.dirname(job["out"]), exist_ok=True)
        await edge_tts.Communicate(job["text"], job["voice"]).save(job["out"])
        print(f"audio {job['out']}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    asyncio.run(main(sys.argv[1]))
