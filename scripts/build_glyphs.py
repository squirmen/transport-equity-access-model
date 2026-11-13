"""Write web/js/glyphs.js from the icon files in web/assets/icons.

The map draws its symbols on a canvas from path data, so it needs no image
files at run time. Run this after changing an icon file:

    python scripts/build_glyphs.py

Each file's shapes (path, rect, polygon) become one path, in the order they
come; a shape with fill="none" (Material Icons' 24 px bounding box) is left
out. Material Icons are on a 24 px grid and Temaki's on 15 px: the grid is
read from the viewBox and written to GLYPH_GRID where it is not 24.

tests/web/symbols.test.mjs checks that glyphs.js matches the files.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "web" / "assets" / "icons"
OUT = ROOT / "web" / "js" / "glyphs.js"

SHAPE = re.compile(r"<(path|rect|polygon)\b([^>]*?)/?>")
ATTR = re.compile(r'([\w:-]+)="([^"]*)"')
VIEWBOX = re.compile(r'viewBox="0 0 (\d+) (\d+)"')
# Elements a glyph may have; anything else (a transform, a style, a use) is refused.
ALLOWED = {"svg", "g", "path", "rect", "polygon"}


def shape_path(kind: str, attrs: dict[str, str]) -> str | None:
    """One shape as path data, or None for one that draws nothing."""
    if attrs.get("fill") == "none":
        return None
    if kind == "path":
        return attrs["d"]
    if kind == "rect":
        x, y, w, h = attrs.get("x", "0"), attrs.get("y", "0"), attrs["width"], attrs["height"]
        return f"M{x} {y}h{w}v{h}h-{w}z"
    points = re.split(r"[\s,]+", attrs["points"].strip())
    pairs = [f"{points[k]} {points[k + 1]}" for k in range(0, len(points), 2)]
    return "M" + "L".join(pairs) + "z"


def glyph(svg: Path) -> tuple[str, int]:
    text = svg.read_text(encoding="utf-8")
    box = VIEWBOX.search(text)
    if not box or box.group(1) != box.group(2):
        raise SystemExit(f"{svg.name}: expected a square viewBox from 0 0")
    for el in ET.fromstring(svg.read_bytes()).iter():
        tag = el.tag.split("}")[-1]
        if tag not in ALLOWED or "transform" in el.attrib:
            raise SystemExit(f"{svg.name}: cannot draw <{tag}>{' with a transform' if 'transform' in el.attrib else ''}")
    paths = [p for kind, rest in SHAPE.findall(text) if (p := shape_path(kind, dict(ATTR.findall(rest))))]
    if not paths:
        raise SystemExit(f"{svg.name}: no shape")
    return " ".join(paths), int(box.group(1))


def main() -> None:
    found = {svg.stem: glyph(svg) for svg in sorted(ICONS.glob("*.svg"))}
    lines = [
        "// Written by scripts/build_glyphs.py from web/assets/icons/*.svg; edit those and run it again.",
        "// Material Icons by Google, Apache License 2.0; temaki_* from Temaki, CC0 (web/assets/icons/LICENSE).",
        "",
        "export const GLYPHS = {",
    ]
    lines += [f"  {name}: '{d}'," for name, (d, _) in found.items()]
    lines += [
        "};",
        "",
        "// The grid a glyph's path data is on, where it is not 24 px.",
        "export const GLYPH_GRID = {",
    ]
    lines += [f"  {name}: {grid}," for name, (_, grid) in found.items() if grid != 24]
    lines += ["};", ""]
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
