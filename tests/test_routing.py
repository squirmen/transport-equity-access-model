"""The timetable copy handed to R5, and how runs are split into batches."""

import zipfile
from pathlib import Path

import pytest

from team import routing
from team.cli import _shard
from team.config import Settings


def make_feed(path: Path, tables: dict[str, str]) -> None:
    with zipfile.ZipFile(path, "w") as z:
        for name, text in tables.items():
            z.writestr(name, text)


def settings_for(tmp_path: Path, feed: Path) -> Settings:
    return Settings(
        raw={"data": {"gtfs": str(feed)}},
        config_path=tmp_path / "c.yml",
        data_root=tmp_path,
        output_dir=tmp_path,
        cache_dir=tmp_path / "cache",
    )


def test_empty_optional_tables_are_left_out(tmp_path: Path):
    feed = tmp_path / "feed.zip"
    make_feed(
        feed,
        {
            "agency.txt": "agency_id,agency_name\nAT,Auckland Transport\n",
            "stops.txt": "stop_id,stop_lat,stop_lon\n1,-36.8,174.7\n",
            # Required, so kept even when empty: R5 should still reject the feed.
            "trips.txt": "route_id,service_id,trip_id\n",
            "frequencies.txt": "trip_id,start_time,end_time,headway_secs\n",
            "fare_rules.txt": "fare_id,route_id\n\n",
            "transfers.txt": "from_stop_id,to_stop_id,transfer_type\n1,1,2\n",
        },
    )
    copy, left_out = routing.prepare_gtfs(settings_for(tmp_path, feed))
    assert left_out == ["fare_rules.txt", "frequencies.txt"]
    with zipfile.ZipFile(copy) as z:
        assert sorted(z.namelist()) == ["agency.txt", "stops.txt", "transfers.txt", "trips.txt"]
        assert z.read("stops.txt") == b"stop_id,stop_lat,stop_lon\n1,-36.8,174.7\n"


def test_copy_is_reused_until_the_feed_changes(tmp_path: Path):
    feed = tmp_path / "feed.zip"
    make_feed(feed, {"agency.txt": "agency_id\nAT\n", "frequencies.txt": "trip_id\n"})
    settings = settings_for(tmp_path, feed)
    first, _ = routing.prepare_gtfs(settings)
    stamp = first.stat().st_mtime_ns

    again, left_out = routing.prepare_gtfs(settings)
    assert again == first
    assert again.stat().st_mtime_ns == stamp
    assert left_out == ["frequencies.txt"]

    make_feed(feed, {"agency.txt": "agency_id\nAT\nMetro\n"})
    changed, left_out = routing.prepare_gtfs(settings)
    assert changed != first
    assert left_out == []


def test_shards_split_the_batches_without_overlap():
    starts = routing.batch_starts(9500, 2000)
    assert starts == [0, 2000, 4000, 6000, 8000]
    shards = [routing.batch_starts(9500, 2000, (i, 3)) for i in range(3)]
    assert shards == [[0, 6000], [2000, 8000], [4000]]
    assert sorted(start for shard in shards for start in shard) == starts


def test_shard_argument():
    assert _shard(None) is None
    assert _shard("1/3") == (0, 3)
    assert _shard("3/3") == (2, 3)
    for bad in ("0/3", "4/3", "2", "a/b"):
        with pytest.raises(SystemExit):
            _shard(bad)
