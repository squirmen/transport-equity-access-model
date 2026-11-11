"""Command line for TEAM.

    team destinations                  build the service and job destination sets
    team destinations --only schools   rebuild only the schools from the directory snapshot
    team schools split                 move an existing build to separate school runs
    team schools check                 what the directory gives each school service
    team route --all                   run every routing job (resumable)
    team route --all --shard 1/3       route every third batch, to split work across processes
    team route services walk           run one job
    team build                         measures, people, context, summaries and web data
    team overlays --to DIR             write only the map overlays, and the named stops, stations and lines
    team pairs route --shard 1/3       cell to cell pairs and public transport paths (resumable)
    team pairs route                   route what is left and combine the batches
    team pairs write --site DIR        tile the pairs for the web app
    team pairs check                   compare sample paths with r5py and the timetable
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

from . import config as config_module

DEFAULT_CONFIG = Path(__file__).resolve().parents[2] / "configs" / "auckland.yml"


def _settings(args: argparse.Namespace) -> config_module.Settings:
    return config_module.load(args.config, args.data_root, args.out, args.cache)


def _shard(value: str | None) -> tuple[int, int] | None:
    """Parse --shard I/N into a zero-based (index, count) pair."""
    if not value:
        return None
    try:
        i, n = (int(part) for part in value.split("/"))
    except ValueError:
        raise SystemExit("--shard takes the form I/N, for example 1/3.") from None
    if not 1 <= i <= n:
        raise SystemExit("--shard I/N needs 1 <= I <= N.")
    return i - 1, n


def cmd_destinations(args: argparse.Namespace) -> int:
    from . import destinations

    settings = _settings(args)
    if args.only == "schools":
        from . import schools

        points, table = schools.build(settings)
        print(points.drop_duplicates(["school", "service"]).groupby("service").size().to_string())
        return 0
    services = destinations.build_services(settings)
    jobs = destinations.build_jobs(settings)
    print(services.groupby("service").size().to_string())
    print(f"job cells: {len(jobs):,}  jobs: {jobs['jobs'].sum():,.0f}")
    return 0


def cmd_schools(args: argparse.Namespace) -> int:
    import json

    from . import schools

    settings = _settings(args)
    if args.action == "split":
        print(json.dumps(schools.split(settings), indent=2))
        return 0
    table = schools.school_table(settings)
    directory = schools.place_directory(settings)
    print(f"{len(directory)} open schools in {', '.join(schools.regions(settings)) or 'the file'}; {len(table)} in a school service")
    missing = schools.unknown_types(settings, directory)
    if missing:
        print("types in no service and not excluded:", ", ".join(missing))
    for service in schools.school_service_ids(settings):
        print(service, json.dumps(schools.counting_line(table, service)))
    return 1 if missing else 0


def cmd_route(args: argparse.Namespace) -> int:
    from . import routing

    settings = _settings(args)
    shard = _shard(args.shard)
    if args.all or args.only:
        routing.run_plan(settings, force=args.force, only=args.only, shard=shard)
        return 0
    if not args.dataset or not args.mode:
        raise SystemExit("Give a dataset and mode, or --all.")
    routing.run(settings, args.dataset, args.mode, args.window, limit=args.limit, force=args.force, shard=shard)
    return 0


def cmd_plan(args: argparse.Namespace) -> int:
    from . import routing

    settings = _settings(args)
    for dataset, mode_id, window in routing.plan(settings):
        tag = routing.run_tag(dataset, mode_id, window, window is not None)
        done = routing.is_current(settings, dataset, mode_id, window)
        print(f"{'done ' if done else 'to do'}  {tag}")
    return 0


def cmd_build(args: argparse.Namespace) -> int:
    from . import build

    build.run(_settings(args))
    return 0


def cmd_overlays(args: argparse.Namespace) -> int:
    from . import context
    from .export import _dump

    settings = _settings(args)
    folder = Path(args.to) if args.to else settings.output_dir / "site" / "data"
    layers, named = context.network_layers(settings)
    _dump(folder / "overlays.json", layers)
    _dump(folder / "transit.json", named)
    print(f"wrote {folder / 'overlays.json'} and {folder / 'transit.json'} (.gz, .br)")
    return 0


def cmd_pairs(args: argparse.Namespace) -> int:
    from . import pairs

    settings = _settings(args)
    if args.action == "plan":
        for tag, mode_id, window in pairs.runs(settings):
            done = (pairs.cache_dir(settings) / f"{tag}.parquet").exists()
            print(f"{'done ' if done else 'to do'}  {tag}")
    elif args.action == "route":
        pairs.run_all(settings, only=args.only, limit=args.limit, force=args.force, shard=_shard(args.shard))
    elif args.action == "write":
        pairs.write_site(settings, Path(args.site) if args.site else None)
    elif args.action == "check":
        pairs.check(settings, window=args.window, sample=args.sample)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="team", description="Transport Equity and Access Model")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG), help="YAML configuration file")
    parser.add_argument("--data-root", help="folder holding raw/ and processed/ inputs")
    parser.add_argument("--out", help="output folder (default: <data root>/team)")
    parser.add_argument("--cache", help="cache folder for large intermediate files (default: ~/.cache/team)")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("destinations", help="build destination sets")
    p.add_argument("--only", choices=["schools"], help="rebuild only this set")
    p.set_defaults(func=cmd_destinations)

    p = sub.add_parser("schools", help="school directory checks and the move to separate school runs")
    p.add_argument("action", choices=["check", "split"])
    p.set_defaults(func=cmd_schools)

    p = sub.add_parser("route", help="run R5 routing")
    p.add_argument("dataset", nargs="?", choices=["services", "jobs", "schools"])
    p.add_argument("mode", nargs="?")
    p.add_argument("--window", help="time window for public transport runs")
    p.add_argument("--limit", type=int, help="route only the first N origins (for timing tests)")
    p.add_argument("--all", action="store_true", help="run every planned job")
    p.add_argument("--only", nargs="+", help="run only these planned jobs, by tag")
    p.add_argument("--force", action="store_true", help="recompute finished batches")
    p.add_argument(
        "--shard",
        help="route every Nth batch only, given as I/N (for example 1/3); run again without it to combine",
    )
    p.set_defaults(func=cmd_route)

    p = sub.add_parser("plan", help="list routing jobs and which are done")
    p.set_defaults(func=cmd_plan)

    p = sub.add_parser("build", help="compute measures and write web data")
    p.set_defaults(func=cmd_build)

    p = sub.add_parser("overlays", help="write only the map overlays and the named network (transit.json)")
    p.add_argument("--to", help="folder to write overlays.json and transit.json into (default: <out>/site/data)")
    p.set_defaults(func=cmd_overlays)

    p = sub.add_parser("pairs", help="cell to cell pairs and public transport paths")
    p.add_argument("action", choices=["plan", "route", "write", "check"])
    p.add_argument("--only", nargs="+", help="route only these runs, by tag (walk, bike, pt_am_peak, ...)")
    p.add_argument("--limit", type=int, help="route only the first N origins (for timing tests)")
    p.add_argument("--force", action="store_true", help="recompute finished batches")
    p.add_argument("--shard", help="route every Nth batch only, as I/N; run again without it to combine")
    p.add_argument("--site", help="the place's data folder in the site, for write (default: <out>/site/data)")
    p.add_argument("--window", default="interpeak", help="window to check (default: interpeak)")
    p.add_argument("--sample", type=int, default=10, help="pairs to check (default: 10)")
    p.set_defaults(func=cmd_pairs)
    return parser


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s", datefmt="%H:%M:%S")
    args = build_parser().parse_args(argv)
    return int(args.func(args) or 0)


if __name__ == "__main__":
    raise SystemExit(main())
