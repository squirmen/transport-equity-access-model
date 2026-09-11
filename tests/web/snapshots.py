"""Render the web app in headless Chromium and save a screenshot of each view.

    python tests/web/snapshots.py \
        --url "http://localhost:8812/web/?data=../tests/fixtures/web/" --out build/shots

Exits with status 1 if the page logs a console error or throws.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright


def ready(page: Page) -> None:
    page.wait_for_function("() => document.getElementById('loading').hidden === true", timeout=90_000)
    page.wait_for_function("() => window.team && window.team.map && window.team.map.loaded()", timeout=90_000)
    page.wait_for_timeout(900)


def settle(page: Page, ms: int = 700) -> None:
    page.wait_for_timeout(ms)


def desktop(page: Page, out: Path) -> None:
    page.screenshot(path=out / "desktop-1-access-gp.png")
    page.click("#tab-people")
    settle(page)
    page.screenshot(path=out / "desktop-2-people-gp.png")
    page.click("#tab-fixes")
    settle(page)
    page.screenshot(path=out / "desktop-3-fixes-gp.png")
    page.evaluate("() => { const b = document.querySelector('.panel-body'); b.scrollTop = b.scrollHeight; }")
    settle(page, 300)
    page.screenshot(path=out / "desktop-3b-fixes-ranked.png")
    page.evaluate("() => { document.querySelector('.panel-body').scrollTop = 0; }")
    page.evaluate("() => { const s = document.getElementById('standard'); s.value = '30'; s.dispatchEvent(new Event('input')); }")
    settle(page)
    page.screenshot(path=out / "desktop-4-fixes-gp-30min.png")
    page.get_by_role("radio", name="Primary school", exact=True).click()
    page.click("#tab-access")
    page.get_by_role("radio", name="Public transport", exact=True).click()
    settle(page)
    page.screenshot(path=out / "desktop-5-access-primary-pt.png")
    page.get_by_role("radio", name="Jobs", exact=True).click()
    settle(page)
    page.screenshot(path=out / "desktop-6-jobs-access.png")
    page.click("#tab-people")
    settle(page)
    page.screenshot(path=out / "desktop-7-jobs-people.png")
    page.get_by_role("radio", name="GP", exact=True).click()
    page.click("#tab-access")
    settle(page)
    page.mouse.click(860, 430)
    settle(page)
    page.screenshot(path=out / "desktop-8-place.png")
    page.click("#about-open")
    settle(page)
    page.screenshot(path=out / "desktop-9-about.png")


def phone(page: Page, out: Path) -> None:
    page.screenshot(path=out / "phone-1-start.png")
    page.click("#panel-toggle")
    settle(page)
    page.screenshot(path=out / "phone-2-open.png")
    page.click("#tab-fixes")
    settle(page)
    page.screenshot(path=out / "phone-3-fixes.png")
    page.click("#panel-toggle")
    settle(page)
    x, y = page.evaluate("() => { const r = window.team.map.getCanvas().getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }")
    page.touchscreen.tap(x, y)
    settle(page)
    page.screenshot(path=out / "phone-4-place.png")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--out", default="build/shots")
    parser.add_argument("--chromium", help="path to a Chromium or headless-shell executable, if Playwright's own is missing")
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    problems: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.chromium) if args.chromium else playwright.chromium.launch()
        for name, viewport, mobile, script in (
            ("desktop", {"width": 1280, "height": 800}, False, desktop),
            ("phone", {"width": 390, "height": 844}, True, phone),
        ):
            context = browser.new_context(viewport=viewport, is_mobile=mobile, has_touch=mobile, device_scale_factor=2 if mobile else 1)
            page = context.new_page()
            page.on("console", lambda msg, n=name: problems.append(f"{n}: console {msg.type}: {msg.text}") if msg.type == "error" else None)
            page.on("pageerror", lambda err, n=name: problems.append(f"{n}: page error: {err}"))
            page.goto(args.url)
            ready(page)
            script(page, out)
            context.close()
        browser.close()
    print("\n".join(problems) if problems else "no console errors")
    print(f"screenshots in {out}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
