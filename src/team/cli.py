"""Command line for TEAM.

    team destinations                  build the service and job destination sets
    team destinations --only schools   rebuild only the schools from the directory snapshot
    team schools split                 move an existing build to separate school runs
    team schools check                 what the directory gives each school service
    team zones check                   enrolment zone statuses and the schools to look at (reports only)
    team ages check                    children by age group against Stats NZ's totals (reports only)
    team schools reroute               route only the schools that changed, then check a sample
    team schools relabel               a school that gains a service keeps its minutes: no routing
    team schools verify                route a sample of origins to every school and compare
    team schools stops                 stops within a 15-minute walk of each school, with morning trips
    team schools stops --recount       count the trips at those stops again, without routing the walks
    team schools audit-points          each school's map point against its grounds and the streets
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
    if args.action == "reroute":
        return _reroute(args, settings)
    if args.action == "verify":
        from . import routing

        report = routing.verify_school_runs(settings, sample=args.sample, modes=args.modes, record=True)
        _report(report, args.json)
        return 0 if report["identical"] else 1
    if args.action == "relabel":
        from . import routing

        report = routing.relabel_schools(settings, reason=args.reason or "", backup=Path(args.backup) if args.backup else None)
        _report(report, args.json)
        return 0
    if args.action == "stops":
        from . import school_stops

        report = school_stops.recount(settings) if args.recount else school_stops.build(settings)
        _report(report, args.json)
        return 0
    if args.action == "audit-points":
        from . import school_points

        folder = Path(args.to) if args.to else settings.output_dir / "destinations"
        audited = school_points.audit_place(settings, settings.cache_dir / "school_checks", school_points.read_snap(settings))
        folder.mkdir(parents=True, exist_ok=True)
        audited.to_csv(folder / "school_points_audit.csv", index=False)
        print(f"{len(audited)} schools, {int(audited['move'].sum())} moved by rule {school_points.RULE}, "
              f"{int((audited['flags'].notna() & ~audited['move']).sum())} to check: {folder / 'school_points_audit.csv'}")
        return 0
    record: dict = {}
    directory = schools.place_directory(settings, record)
    table = schools.school_table(settings, directory)
    area = schools.routing_area(settings)
    where = "the routing area " + ", ".join(f"{v:.4f}" for v in area) if area else "the file"
    print(f"{len(directory)} open schools in {where}; {len(table)} in a school service")
    print("by regional council:", json.dumps(schools.regional_councils(table.rename(columns={"region": "Regional_Council"}))))
    for far in record.get("far_from_streets", []):
        print(f"left out, {far['street_m']} m from the street file: {far['moe']} {far['name']} ({far['region']})")
    missing = schools.unknown_types(settings, directory)
    if missing:
        print("types in no service and not excluded:", ", ".join(missing))
    for service in schools.school_service_ids(settings):
        print(service, json.dumps(schools.counting_line(table, service)))
    return 1 if missing else 0


def cmd_zones(args: argparse.Namespace) -> int:
    import json

    from . import zones

    settings = _settings(args)
    if not zones.available(settings):
        raise SystemExit("No zone file configured (data.zones).")
    print(json.dumps(zones.check(settings), indent=2, default=str, ensure_ascii=False))
    return 0


def cmd_ages(args: argparse.Namespace) -> int:
    import json

    from . import ages, routing

    settings = _settings(args)
    if not ages.available(settings):
        raise SystemExit("No census age files configured (data.census_ages, census_ages_sa2, census_age_shape).")
    print(json.dumps(ages.check(settings, routing.load_origins(settings)), indent=2, ensure_ascii=False))
    return 0
def _report(report: dict, path: str | None) -> None:
    import json

    text = json.dumps(report, indent=2, default=str)
    print(text)
    if path:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(text + "\n")


def _reroute(args: argparse.Namespace, settings) -> int:
    """Route the changed schools, then check a sample against a fresh routing in a new process."""
    import subprocess
    import sys

    from . import routing

    report = routing.reroute_schools(settings, schools=args.schools, modes=args.modes, reason=args.reason or "",
                                     backup=Path(args.backup) if args.backup else None, shard=_shard(args.shard),
                                     prepare=args.prepare)
    _report(report, args.json)
    if args.prepare or args.shard or args.no_verify or not any(isinstance(v, dict) for v in report["runs"].values()):
        return 0
    command = [sys.executable, "-m", "team", "--config", args.config, "--data-root", str(settings.data_root),
               "--out", str(settings.output_dir), "--cache", str(settings.cache_dir), "schools", "verify",
               "--sample", str(args.sample)]
    if args.modes:
        command += ["--modes", *args.modes]
    if args.json:
        command += ["--json", str(Path(args.json).with_name(Path(args.json).stem + "_verify.json"))]
    return subprocess.run(command, check=False).returncode


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

    p = sub.add_parser("schools", help="school directory checks, re-routing changed schools, stops near schools")
    p.add_argument("action", choices=["check", "split", "reroute", "relabel", "verify", "stops", "audit-points"])
    p.add_argument("--schools", nargs="+", help="reroute: only these changed schools (moe:<id>); others are refused")
    p.add_argument("--modes", nargs="+", help="reroute, verify: only these modes")
    p.add_argument("--reason", help="reroute: why, for the run's record (D4, D5, ...)")
    p.add_argument("--backup", help="reroute: folder for the copies of the runs (default: <cache>/reroute_backup)")
    p.add_argument("--shard", help="reroute: every Nth batch only, as I/N; run again without it to combine")
    p.add_argument("--prepare", action="store_true", help="reroute: make the copies and stop, so shards can start together")
    p.add_argument("--no-verify", action="store_true", help="reroute: skip the check against a fresh routing")
    p.add_argument("--sample", type=int, default=300, help="reroute, verify: origins in the check (default 300)")
    p.add_argument("--json", help="write the report here too")
    p.add_argument("--to", help="audit-points: folder for the audit (default: <out>/destinations)")
    p.add_argument("--recount", action="store_true", help="stops: count the trips at the stops listed again, without routing the walks")
    p.set_defaults(func=cmd_schools)

    p = sub.add_parser("zones", help="enrolment zone checks (reports only)")
    p.add_argument("action", choices=["check"])
    p.set_defaults(func=cmd_zones)

    p = sub.add_parser("ages", help="children by age group: totals against Stats NZ (reports only)")
    p.add_argument("action", choices=["check"])
    p.set_defaults(func=cmd_ages)

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
