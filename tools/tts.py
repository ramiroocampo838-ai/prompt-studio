"""Text to speech for a scene list: one mp3 per scene using edge-tts.

Usage: python tts.py <scenes.json> <audio-out-dir>
scenes.json: {"voice": "en-US-GuyNeural", "scenes": [{"id": "s1", "narration": "..."}]}
"""
import asyncio
import json
import os
import sys

import edge_tts


async def main(script_path, out_dir):
    with open(script_path, encoding="utf-8") as f:
        script = json.load(f)
    os.makedirs(out_dir, exist_ok=True)
    for scene in script["scenes"]:
        out = os.path.join(out_dir, f"{scene['id']}.mp3")
        await edge_tts.Communicate(scene["narration"], script["voice"]).save(out)
        print(f"audio {scene['id']}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    asyncio.run(main(sys.argv[1], sys.argv[2]))
