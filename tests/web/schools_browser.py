"""Check the Schools row in Chromium and WebKit, with the stylesheet held back
the way WebKit can leave it, on a built place that has the 0.12 school files.

    python tests/web/schools_browser.py \
        --url "http://localhost:8812/web/?city=auckland&data=../build/site/data/" --out build/shots/schools

It opens the St Lukes hexagon from the councillors' slide (89bb50021a3ffff,
or --hex) by public transport and checks, in each choice:

- the card names the school reached in the time shown, and says a walk is a walk
- the line under the headline says which schools are counted
- the link carries the choice, and opening that link shows the same thing
- One school found by name draws the map (hexagons painted, not blank)
- on a phone the four choices are one select

and saves a screenshot of each. Exits with status 1 on any failure or any
console error.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

DELAY_MS = 1500


def ready(page: Page) -> None:
    page.wait_for_function("() => document.getElementById('loading').hidden === true", timeout=120_000)
    page.wait_for_function("() => window.team && window.team.map && window.team.map.loaded()", timeout=120_000)
    page.wait_for_function("() => !(document.querySelector('#view > .note')?.textContent || '').startsWith('Loading')", timeout=120_000)
    page.wait_for_timeout(900)


def held_back(page: Page) -> None:
    """Hold team.css back, as WebKit can run the modules before it applies."""
    def slow(route):
        page.wait_for_timeout(DELAY_MS)
        route.continue_()
    page.route("**/css/team.css", slow)


def panel(page: Page) -> dict:
    return page.evaluate("""() => ({
      hero: document.querySelector('#view .hero')?.innerText || '',
      counting: document.querySelector('#view .counting')?.innerText || '',
      band: document.querySelector('#place-body .verdict')?.innerText || '',
      hash: location.hash,
      painted: window.team.map.queryRenderedFeatures({ layers: ['cells-fill'] })
        .filter((f) => f.state && f.state.k != null).length,
    })""")


def check(problems: list[str], label: str, ok: bool, detail: str) -> None:
    if not ok:
        problems.append(f"{label}: {detail}")


def desktop(page: Page, base: str, hexagon: str, out: Path, engine: str, problems: list[str]) -> None:
    page.goto(f"{base}#s=secondary_school&m=pt&o={hexagon}")
    ready(page)
    seen = panel(page)
    check(problems, f"{engine} all", "Counting all" in seen["counting"], seen["counting"])
    check(problems, f"{engine} all", "sch=" not in seen["hash"], seen["hash"])
    check(problems, f"{engine} all", seen["painted"] > 0, "no hexagons painted")
    page.screenshot(path=str(out / f"{engine}-1-all-pt.png"))
    if "on foot" in seen["band"]:
        check(problems, f"{engine} all", "No bus or train is quicker" in seen["band"], seen["band"])

    page.click("#school-field .school-kinds [data-value='state']")
    ready(page)
    seen = panel(page)
    check(problems, f"{engine} state", "sch=state" in seen["hash"], seen["hash"])
    check(problems, f"{engine} state", "state" in seen["hero"], seen["hero"])
    check(problems, f"{engine} state", seen["counting"].startswith("Counting") and "state" in seen["counting"], seen["counting"])
    check(problems, f"{engine} state", seen["band"].count("State secondary school") == 1, seen["band"])
    page.screenshot(path=str(out / f"{engine}-2-state-pt.png"))

    # The same link opened afresh shows the same thing.
    link = page.url
    page.goto("about:blank")
    page.goto(link)
    ready(page)
    again = panel(page)
    check(problems, f"{engine} state link", again["hero"] == seen["hero"], f"{again['hero']!r} != {seen['hero']!r}")

    page.click("#school-field .school-students [data-value='girls']")
    ready(page)
    seen = panel(page)
    check(problems, f"{engine} girls", "stu=girls" in seen["hash"], seen["hash"])
    check(problems, f"{engine} girls", "takes girls" in seen["hero"], seen["hero"])

    if page.locator("#school-field .school-kinds [data-value='zone']").count():
        page.click("#school-field .school-kinds [data-value='zone']")
        ready(page)
        seen = panel(page)
        check(problems, f"{engine} zone", "sch=zone" in seen["hash"], seen["hash"])
        check(problems, f"{engine} zone", "in-zone" in seen["hero"], seen["hero"])
        page.screenshot(path=str(out / f"{engine}-3-zone-pt.png"))

    page.click("#school-field .school-kinds [data-value='one']")
    page.wait_for_selector("#school-search")
    page.fill("#school-search", "albert grammar")
    page.wait_for_selector("#school-results button")
    page.click("#school-results button >> nth=0")
    ready(page)
    seen = panel(page)
    check(problems, f"{engine} one", "sch=one%3A" in seen["hash"], seen["hash"])
    check(problems, f"{engine} one", "Mt Albert Grammar School" in seen["band"], seen["band"])
    check(problems, f"{engine} one", seen["painted"] > 0, "the one-school map is blank")
    page.screenshot(path=str(out / f"{engine}-4-one-pt.png"))


def phone(browser, base: str, hexagon: str, out: Path, engine: str, problems: list[str], errors: list[str]) -> None:
    context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=engine != "firefox", has_touch=True)
    page = context.new_page()
    page.on("console", lambda m: errors.append(f"{engine} phone: {m.text}") if m.type == "error" and "404" not in m.text else None)
    page.on("pageerror", lambda e: errors.append(f"{engine} phone: {e}"))
    held_back(page)
    # A link written by hand, with no map position: it opens on the hexagon, clear of the card.
    page.goto(f"{base}#s=secondary_school&m=pt&sch=state&o={hexagon}")
    ready(page)
    framed = page.evaluate(f"""() => {{
      const [lat, lng] = h3.cellToLatLng('{hexagon}');
      const at = window.team.map.project([lng, lat]);
      const card = document.getElementById('place').getBoundingClientRect().top;
      return {{ x: at.x, y: at.y, card, width: window.innerWidth }};
    }}""")
    check(problems, f"{engine} phone link", 0 < framed["x"] < framed["width"] and 0 < framed["y"] < framed["card"], str(framed))
    page.screenshot(path=str(out / f"{engine}-5-phone-card.png"))
    page.click("#place-close")
    page.evaluate("() => window.team.sheet('full')")
    page.wait_for_timeout(500)
    shown = page.evaluate("""() => {
      const select = document.getElementById('schools-select');
      const chips = document.querySelector('#school-field .school-kinds');
      return { select: select && getComputedStyle(select).display !== 'none', value: select && select.value,
               chips: chips && getComputedStyle(chips).display !== 'none' };
    }""")
    check(problems, f"{engine} phone", shown["select"] and not shown["chips"], str(shown))
    check(problems, f"{engine} phone", shown["value"] == "state", str(shown))
    page.screenshot(path=str(out / f"{engine}-6-phone-state.png"))
    context.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", required=True, help="the page, with ?city= and ?data= for the build to test")
    parser.add_argument("--out", default="build/shots/schools")
    parser.add_argument("--hex", default="89bb50021a3ffff")
    parser.add_argument("--engines", default="chromium,webkit")
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    problems: list[str] = []
    errors: list[str] = []
    with sync_playwright() as p:
        for engine in args.engines.split(","):
            browser = getattr(p, engine).launch()
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            # A place with no list of places (a test build) answers 404 for it.
            page.on("console", lambda m, e=engine: errors.append(f"{e}: {m.text}") if m.type == "error" and "404" not in m.text else None)
            page.on("pageerror", lambda exc, e=engine: errors.append(f"{e}: {exc}"))
            held_back(page)
            desktop(page, args.url, args.hex, out, engine, problems)
            phone(browser, args.url, args.hex, out, engine, problems, errors)
            browser.close()
    for line in problems + errors:
        print(line)
    print(f"{len(problems)} problems, {len(errors)} console errors. Screenshots in {out}.")
    return 1 if problems or errors else 0


if __name__ == "__main__":
    sys.exit(main())
