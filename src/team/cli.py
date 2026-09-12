"""Command line for TEAM.

    team destinations                  build the service and job destination sets
    team route --all                   run every routing job (resumable)
    team route --all --shard 1/3       route every third batch, to split work across processes
    team route services walk           run one job
    team build                         measures, people, context, summaries and web data
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
    services = destinations.build_services(settings)
    jobs = destinations.build_jobs(settings)
    print(services.groupby("service").size().to_string())
    print(f"job cells: {len(jobs):,}  jobs: {jobs['jobs'].sum():,.0f}")
    return 0


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
        done = settings.out("routing", f"{tag}.parquet").exists()
        print(f"{'done ' if done else 'to do'}  {tag}")
    return 0


def cmd_build(args: argparse.Namespace) -> int:
    from . import build

    build.run(_settings(args))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="team", description="Transport Equity and Access Model")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG), help="YAML configuration file")
    parser.add_argument("--data-root", help="folder holding raw/ and processed/ inputs")
    parser.add_argument("--out", help="output folder (default: <data root>/team)")
    parser.add_argument("--cache", help="cache folder for large intermediate files (default: ~/.cache/team)")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("destinations", help="build destination sets")
    p.set_defaults(func=cmd_destinations)

    p = sub.add_parser("route", help="run R5 routing")
    p.add_argument("dataset", nargs="?", choices=["services", "jobs"])
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
    return parser


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s", datefmt="%H:%M:%S")
    args = build_parser().parse_args(argv)
    return int(args.func(args) or 0)


if __name__ == "__main__":
    raise SystemExit(main())
