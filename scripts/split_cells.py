"""Split a built place's cells.json into the part sent first and the rest.

Builds from 0.6.1 on write both files themselves. This splits the files of an
earlier build in place, so a site can be sped up without building it again.

    python scripts/split_cells.py <site>/data/*/cells.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from team.export import _dump, split_cells  # noqa: E402


def main() -> None:
    for name in sys.argv[1:]:
        path = Path(name)
        payload = json.loads(path.read_text(encoding="utf-8"))
        if "jobs" not in payload:
            print(f"{path}: already split")
            continue
        core, more = split_cells(payload)
        _dump(path.with_name("cells_more.json"), more)
        _dump(path, core)
        print(f"{path.parent.name}: core {path.with_suffix('.json.br').stat().st_size // 1024} KB, "
              f"rest {path.with_name('cells_more.json.br').stat().st_size // 1024} KB (brotli)")


if __name__ == "__main__":
    main()
