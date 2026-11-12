"""Schools across a regional boundary (D4) and re-routing only the schools
that changed (`team schools reroute`, routing.reroute_schools).

Tests on the built places need TEAM_BUILDS (each place's build output,
<root>/<place>), TEAM_CACHES (their route caches) and, for the before and
after comparison, TEAM_REROUTE_BACKUP (the copies the reroute made,
<root>/<place>/<run>). TEAM_SLOW=1 routes a sample again with r5py.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pandas as pd
import pytest

from team import config, destinations, routing, schools

REPO = Path(__file__).resolve().parents[1]
DATA_ROOT = Path(os.environ.get("TEAM_DATA_ROOT", REPO.parent))
SNAPSHOT = DATA_ROOT / "raw" / "nz" / "education" / "moe_schools_directory_2026-11-12.csv"
BUILDS = Path(os.environ["TEAM_BUILDS"]) if os.environ.get("TEAM_BUILDS") else None
CACHES = Path(os.environ["TEAM_CACHES"]) if os.environ.get("TEAM_CACHES") else None
BACKUP = Path(os.environ["TEAM_REROUTE_BACKUP"]) if os.environ.get("TEAM_REROUTE_BACKUP") else None
PLACES = sorted(p.stem for p in (REPO / "configs").glob("*.yml"))


def points(rows):
    return pd.DataFrame(rows, columns=["id", "school", "service", "lon", "lat"])


def test_changed_schools_finds_added_removed_and_moved():
    before = points([("moe:1", "moe:1", "primary_school", 174.0, -36.0), ("moe:2", "moe:2", "primary_school", 174.1, -36.1),
                     ("moe:3", "moe:3", "primary_school", 174.2, -36.2), ("moe:4", "moe:4", "primary_school", 174.3, -36.3)])
    after = points([("moe:1", "moe:1", "primary_school", 174.0, -36.0), ("moe:2", "moe:2", "primary_school", 174.1005, -36.1),
                    ("moe:3", "moe:3", "secondary_school", 174.2, -36.2), ("moe:5", "moe:5", "primary_school", 174.4, -36.4)])
    change = routing.changed_schools(before, after)
    assert change == {"added": ["moe:5"], "removed": ["moe:4"], "moved": ["moe:2", "moe:3"]}


def place(name: str):
    import tempfile

    scratch = Path(tempfile.mkdtemp(prefix=f"team-{name}-"))
    out = BUILDS / name if BUILDS else scratch / "out"
    cache = CACHES / name if CACHES else scratch / "cache"
    return config.load(REPO / "configs" / f"{name}.yml", DATA_ROOT, out, cache)


@pytest.mark.skipif(not SNAPSHOT.exists(), reason="needs the directory snapshot and the street files in the data root")
def test_schools_over_a_regional_boundary_are_kept():
    auckland = place("auckland")
    listed = schools.place_directory(auckland)
    names = dict(zip(listed["School_Id"].astype(int), listed["Org_Name"]))
    # Pukeoware School (Waikato) is 160 m from an Auckland hexagon; Tuakau College is in Waikato too.
    assert {1454, 106} <= set(names)
    assert listed.loc[listed["School_Id"] == "1454", "Regional_Council"].item() == "Waikato Region"
    west, south, east, north = destinations.city_bounds(auckland)
    lon, lat = pd.to_numeric(listed["Longitude"]), pd.to_numeric(listed["Latitude"])
    assert lon.between(west, east).all() and lat.between(south, north).all()
    # Onewhero Area School is in the box but 4 km from any street in Auckland's
    # street file, which stops before it: it cannot be routed, so it is left out.
    record: dict = {}
    schools.place_directory(auckland, record)
    far = {r["moe"]: r for r in record["far_from_streets"]}
    assert 108 in far and far[108]["street_m"] > schools.STREET_REACH_M and 108 not in names
    wellington = schools.place_directory(place("wellington"))
    assert "2886" in set(wellington["School_Id"])  # Levin East School, Horowhenua (Manawatū-Whanganui)


needs_builds = pytest.mark.skipif(BUILDS is None or CACHES is None, reason="set TEAM_BUILDS and TEAM_CACHES")


@needs_builds
@pytest.mark.parametrize("name", PLACES)
def test_every_school_run_is_current_after_the_reroutes(name):
    settings = place(name)
    for dataset, mode_id, window in routing.school_runs(settings):
        assert routing.is_current(settings, dataset, mode_id, window), routing.run_tag(dataset, mode_id, window, window is not None)


@needs_builds
@pytest.mark.parametrize("name", PLACES)
def test_every_reroute_was_checked_against_a_fresh_routing(name):
    settings = place(name)
    for dataset, mode_id, window in routing.school_runs(settings):
        tag = routing.run_tag(dataset, mode_id, window, window is not None)
        record = json.loads((settings.output_dir / "routing" / f"{tag}.json").read_text())
        if not record.get("rerouted"):
            continue
        assert record.get("verified", {}).get("identical") is True, tag
        assert record["verified"]["members"] == record["members"], f"{tag}: checked before the last reroute"


@pytest.mark.skipif(BUILDS is None or CACHES is None or BACKUP is None, reason="set TEAM_BUILDS, TEAM_CACHES and TEAM_REROUTE_BACKUP")
@pytest.mark.parametrize("name", PLACES)
def test_reroute_leaves_every_other_school_alone(name):
    settings = place(name)
    if not (BACKUP / name).exists():
        # No copy: then no school run here may have been re-routed.
        for dataset, mode_id, window in routing.school_runs(settings):
            tag = routing.run_tag(dataset, mode_id, window, window is not None)
            record = json.loads((settings.output_dir / "routing" / f"{tag}.json").read_text())
            assert not record.get("rerouted"), f"{name} {tag} was re-routed but has no copy from before"
        return
    report = routing.compare_reroute(settings, BACKUP / name)
    assert report["identical"], json.dumps(report["runs"])


@needs_builds
@pytest.mark.parametrize("name", PLACES)
def test_a_relabelled_school_keeps_its_minutes(name):
    """A school that gained a service has, under it, exactly the pairs it has
    under a service it already had (routing.relabel_schools)."""
    settings = place(name)
    for dataset, mode_id, window in routing.school_runs(settings):
        tag = routing.run_tag(dataset, mode_id, window, window is not None)
        record = json.loads((settings.output_dir / "routing" / f"{tag}.json").read_text())
        if not record.get("relabelled"):
            continue
        pairs = schools.load_reach(settings, tag)
        for school, change in record["relabelled"][-1]["schools"].items():
            kept = [s for s in change["before"] if s in change["after"]]
            for gained in [s for s in change["after"] if s not in change["before"]]:
                a = pairs[(pairs["destination"] == school) & (pairs["service"] == kept[0])].drop(columns="service")
                b = pairs[(pairs["destination"] == school) & (pairs["service"] == gained)].drop(columns="service")
                key = ["origin"]
                assert a.sort_values(key).reset_index(drop=True).equals(b.sort_values(key).reset_index(drop=True)), f"{tag} {school} {gained}"


@pytest.mark.skipif(os.environ.get("TEAM_SLOW") != "1" or BUILDS is None, reason="routes with r5py; set TEAM_SLOW=1 and TEAM_BUILDS")
@pytest.mark.parametrize("name", ["nelson"])
def test_reroute_equals_a_full_route(name):
    report = routing.verify_school_runs(place(name), sample=300)
    assert report["identical"], json.dumps(report["runs"])
