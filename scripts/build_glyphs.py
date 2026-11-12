"""Write web/js/glyphs.js from the icon files in web/assets/icons.

The map draws its symbols on a canvas from path data, so it needs no image
files at run time. Run this after changing an icon file:

    python scripts/build_glyphs.py

tests/web/symbols.test.mjs checks that glyphs.js matches the files.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "web" / "assets" / "icons"
OUT = ROOT / "web" / "js" / "glyphs.js"

PATH = re.compile(r'<path\b[^>]*?\sd="([^"]+)"')


def glyphs() -> dict[str, str]:
    out = {}
    for svg in sorted(ICONS.glob("*.svg")):
        text = svg.read_text(encoding="utf-8")
        if 'viewBox="0 0 24 24"' not in text:
            raise SystemExit(f"{svg.name}: expected a 24 px viewBox")
        paths = PATH.findall(text)
        if not paths:
            raise SystemExit(f"{svg.name}: no path")
        out[svg.stem] = " ".join(paths)
    return out


def main() -> None:
    lines = [
        "// Written by scripts/build_glyphs.py from web/assets/icons/*.svg; edit those and run it again.",
        "// Material Icons, filled, 24 px grid, by Google, Apache License 2.0 (web/assets/icons/LICENSE).",
        "",
        "export const GLYPHS = {",
    ]
    for name, d in glyphs().items():
        lines.append(f"  {name}: '{d}',")
    lines += ["};", ""]
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
