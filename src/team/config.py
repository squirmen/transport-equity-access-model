"""Load a TEAM configuration and resolve its paths."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


@dataclass
class Settings:
    raw: dict[str, Any]
    config_path: Path
    data_root: Path
    output_dir: Path
    cache_dir: Path

    def data(self, key: str) -> Path:
        """Absolute path of an input listed under `data` in the config."""
        path = Path(self.raw["data"][key]).expanduser()
        return path if path.is_absolute() else self.data_root / path

    def out(self, *parts: str) -> Path:
        path = self.output_dir.joinpath(*parts)
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def routing(self) -> dict[str, Any]:
        return self.raw["routing"]

    @property
    def modes(self) -> dict[str, dict[str, Any]]:
        return self.raw["routing"]["modes"]

    @property
    def services(self) -> dict[str, dict[str, Any]]:
        return self.raw["services"]

    @property
    def jobs(self) -> dict[str, Any]:
        return self.raw["jobs"]

    @property
    def gravity(self) -> dict[str, Any]:
        return self.raw.get("gravity", {})

    @property
    def naming(self) -> dict[str, str]:
        """How the place is named in the interface and the downloads."""
        given = dict(self.raw.get("naming", {}))
        place = given.get("place") or str(self.raw.get("region", "")).split(" ")[0] or self.raw["name"].title()
        given.setdefault("place", place)
        given.setdefault("residents", f"people in {place}")
        given.setdefault("possessive", f"{place}'s")
        given.setdefault("slug", str(self.raw["name"]).lower().replace(" ", "_"))
        given.setdefault("agency", "the local transport agency")
        return given

    @property
    def fares(self) -> dict[str, Any]:
        return self.raw.get("fares", {})

    @property
    def standard_modes(self) -> list[str]:
        return list(self.raw.get("standard_modes", []))


def load(
    config_path: str | Path,
    data_root: str | Path | None = None,
    output_dir: str | Path | None = None,
    cache_dir: str | Path | None = None,
) -> Settings:
    config_path = Path(config_path).expanduser().resolve()
    raw = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    root = data_root or os.environ.get("TEAM_DATA_ROOT") or raw.get("data_root")
    if not root:
        raise SystemExit("Set the data root with --data-root or TEAM_DATA_ROOT.")
    root_path = Path(root).expanduser().resolve()
    out = Path(output_dir).expanduser() if output_dir else root_path / "team"
    cache = Path(cache_dir or os.environ.get("TEAM_CACHE_DIR") or "~/.cache/team").expanduser()
    out.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    return Settings(raw=raw, config_path=config_path, data_root=root_path, output_dir=out, cache_dir=cache)
