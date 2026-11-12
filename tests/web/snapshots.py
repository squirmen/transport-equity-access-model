"""Render the web app in headless Chromium and save a screenshot of each view.

    python tests/web/snapshots.py \
        --url "http://localhost:8812/web/?city=web&data=../tests/fixtures/" --out build/shots

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


def settings_count(page: Page) -> int:
    """The number on the Settings button, 0 when it is hidden."""
    return page.evaluate("() => { const c = document.getElementById('settings-count'); return c.hidden ? 0 : Number(c.textContent); }")


def check_settings_count(page: Page, url: str, problems: list[str]) -> None:
    """The count is of settings that differ from the defaults. Every link and reload spells out t= (and h= once
    a time is picked), so a reload, or a link with the defaults in it, must show no count."""
    base = url.split("#")[0]
    for label, address, want in (
        ("fresh", base, 0),
        ("defaults spelt out", f"{base}#s=gp&v=access&m=best&t=20&h=interpeak", 0),
        ("standard changed", f"{base}#s=gp&v=access&m=best&t=30", 1),
    ):
        page.goto("about:blank")
        page.goto(address)
        ready(page)
        got = settings_count(page)
        page.reload()
        ready(page)
        again = settings_count(page)
        if got != want or again != want:
            problems.append(f"desktop: Settings count for {label} is {got}, then {again} after a reload; want {want}")
    page.goto("about:blank")
    page.goto(url)
    ready(page)


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
    page.click("#open-settings")
    page.evaluate("() => { const s = document.getElementById('standard'); s.value = '30'; s.dispatchEvent(new Event('input')); }")
    settle(page)
    page.screenshot(path=out / "desktop-4-settings-30min.png")
    page.click("#open-settings")
    settle(page, 300)
    page.screenshot(path=out / "desktop-4b-fixes-gp-30min.png")
    page.select_option("#goal", "primary_school")
    page.click("#tab-access")
    page.get_by_role("radio", name="PT", exact=True).click()
    settle(page)
    page.screenshot(path=out / "desktop-5-access-primary-pt.png")
    page.select_option("#goal", "jobs")
    settle(page)
    page.screenshot(path=out / "desktop-6-jobs-access.png")
    page.click("#tab-people")
    settle(page)
    page.screenshot(path=out / "desktop-7-jobs-people.png")
    page.select_option("#goal", "gp")
    page.click("#tab-access")
    settle(page)
    page.click("#open-layers")
    page.check("#layer-stops")
    settle(page)
    page.screenshot(path=out / "desktop-8-layers.png")
    page.click("#open-layers")
    page.mouse.click(860, 430)
    settle(page)
    page.screenshot(path=out / "desktop-9-place.png")
    page.click("#about-open")
    settle(page)
    page.screenshot(path=out / "desktop-10-about.png")
    page.keyboard.press("Escape")
    symbols(page, out)


def symbols(page: Page, out: Path) -> None:
    """One school with its stops and the Stops layer, on each basemap: the map's symbols and the key's rows for them."""
    base = page.url.split("#")[0]
    for basemap in ("light", "streets", "satellite"):
        page.goto("about:blank")
        page.goto(f"{base}#s=secondary_school&m=best&sch=one:9030&b={basemap}")
        ready(page)
        page.click("#open-layers")
        page.check("#layer-stops")
        page.click("#open-layers")
        settle(page, 1200)
        page.screenshot(path=out / f"desktop-11-symbols-{basemap}.png")


def phone(page: Page, out: Path) -> None:
    page.screenshot(path=out / "phone-1-start.png")
    page.click("#sheet-handle")
    settle(page)
    page.screenshot(path=out / "phone-2-half.png")
    page.click("#tab-fixes")
    settle(page)
    page.screenshot(path=out / "phone-3-fixes.png")
    page.click("#sheet-handle")
    settle(page)
    page.screenshot(path=out / "phone-4-full.png")
    page.click("#sheet-handle")
    settle(page)
    x, y = page.evaluate("() => { const r = window.team.map.getCanvas().getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 3]; }")
    page.touchscreen.tap(x, y)
    settle(page)
    page.screenshot(path=out / "phone-5-place.png")


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
        # SwiftShader's WebGL draws the map where there is no GPU.
        gl = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
        browser = playwright.chromium.launch(executable_path=args.chromium, args=gl) if args.chromium else playwright.chromium.launch(args=gl)
        for name, viewport, mobile, script in (
            ("desktop", {"width": 1280, "height": 800}, False, desktop),
            ("phone", {"width": 390, "height": 844}, True, phone),
        ):
            context = browser.new_context(viewport=viewport, is_mobile=mobile, has_touch=mobile, device_scale_factor=2 if mobile else 1)
            page = context.new_page()
            # The fixture is one place on its own, with no list of places;
            # the picker's request for that list is the one miss expected.
            missing = []
            # Nor has it transit.json, which only names the Stops layer's stops.
            page.on("response", lambda r, m=missing: m.append(r.url) if r.status >= 400 and not r.url.endswith(("/cities.json", "/transit.json")) else None)
            page.on("console", lambda msg, n=name: problems.append(f"{n}: console {msg.type}: {msg.text}")
                    if msg.type == "error" and "Failed to load resource" not in msg.text else None)
            page.on("pageerror", lambda err, n=name: problems.append(f"{n}: page error: {err}"))
            page.goto(args.url)
            ready(page)
            if name == "desktop":
                check_settings_count(page, args.url, problems)
            script(page, out)
            problems.extend(f"{name}: not found: {url}" for url in missing)
            context.close()
        browser.close()
    print("\n".join(problems) if problems else "no console errors")
    print(f"screenshots in {out}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
