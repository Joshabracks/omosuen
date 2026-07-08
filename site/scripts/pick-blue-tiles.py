"""Score LapisSin tiles for blue-dominant (dark lapis) appearance."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

LAPIS = (0x1E, 0x3A, 0x8A)
PARCHMENT = (0xF4, 0xE9, 0xD8)
ROOT = Path(__file__).resolve().parents[1]
DIR = ROOT.parent / ".design/website/BaT_v2.0/LapisSin/single_textures"
OUT = ROOT / "src/scenes/hero-texture-ids.json"
NEEDED = 55


def score_texture(path: Path) -> dict[str, float | int]:
    img = Image.open(path).convert("RGBA")
    t_sum = 0.0
    blue_dom = 0
    n = 0
    r_sum = g_sum = b_sum = 0.0
    for r, g, b, a in img.getdata():
        if a < 128:
            continue
        n += 1
        r_sum += r
        g_sum += g
        b_sum += b
        ts = [
            (r - LAPIS[0]) / (PARCHMENT[0] - LAPIS[0]),
            (g - LAPIS[1]) / (PARCHMENT[1] - LAPIS[1]),
            (b - LAPIS[2]) / (PARCHMENT[2] - LAPIS[2]),
        ]
        t_sum += max(0.0, min(1.0, sum(ts) / 3.0))
        if b > r and b > g:
            blue_dom += 1
    if n == 0:
        raise ValueError(f"empty texture: {path}")
    ar = r_sum / n
    ag = g_sum / n
    ab = b_sum / n
    return {
        "num": int(path.stem.removeprefix("texture")),
        "parchment_mix": t_sum / n,
        "blue_dominance": blue_dom / n,
        "brightness": (ar + ag + ab) / 3.0,
        "b_minus_rg": ab - max(ar, ag),
    }


def main() -> None:
    results = [score_texture(p) for p in sorted(DIR.glob("texture*.png"), key=lambda p: int(p.stem[7:]))]
    # Prefer dark lapis: low parchment mix, blue channel leads, not bright.
    candidates = [
        r
        for r in results
        if r["blue_dominance"] >= 0.45
        and r["parchment_mix"] <= 0.5
        and r["brightness"] <= 135
        and r["b_minus_rg"] >= 0
    ]
    candidates.sort(key=lambda r: (r["parchment_mix"], r["brightness"]))

    print(f"Total textures: {len(results)}")
    print(f"Blue-dominant candidates: {len(candidates)}")
    nums = [int(r["num"]) for r in candidates[:NEEDED]]
    if len(nums) < NEEDED:
        print("WARNING: not enough candidates, relaxing filter...")
        relaxed = sorted(
            [r for r in results if r["blue_dominance"] >= 0.4 and r["parchment_mix"] <= 0.6],
            key=lambda r: (r["parchment_mix"], r["brightness"]),
        )
        nums = [int(r["num"]) for r in relaxed[:NEEDED]]
        print(f"Relaxed top {NEEDED}: {', '.join(str(n) for n in nums)}")

    OUT.write_text(json.dumps(nums, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
