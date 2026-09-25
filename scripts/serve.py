"""Serve the repo for local testing, without any caching.

A browser will hold on to an ES module across reloads, which makes an edit
look like it did nothing. The live site sends no-cache headers of its own, so
this only matters while developing.

    python scripts/serve.py --port 8812
"""

from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        if "404" in (fmt % args):
            return
        super().log_message(fmt, *args)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8812)
    parser.add_argument("--directory", default=str(Path(__file__).resolve().parents[1]))
    args = parser.parse_args()
    handler = partial(NoCacheHandler, directory=args.directory)
    print(f"serving {args.directory} on http://127.0.0.1:{args.port} with caching off")
    ThreadingHTTPServer(("127.0.0.1", args.port), handler).serve_forever()


if __name__ == "__main__":
    main()
