"""Check the Schools row in Chromium and WebKit, desktop and phone, with the
stylesheet held back the way WebKit can leave it, on a build with the 0.12.0
round-2 school files (zones, ages, public transport or walking, stops).

    python tests/web/schools_browser.py --base "http://localhost:8812/web/?data=../build/site/data/" --out build/shots/schools

`--base` is the page with ?data= for the build (no city). The scenes:

- the councillors' slide link, written without sch: it opens In zone, the
  link then says sch=zone, the line under the headline says which schools
  must take a child living there and counts children aged 13 to 17, and the
  card names Mt Albert Grammar School, 15 min on foot;
- the same link with sch=all: All, and TKKM o Nga Maungarongo 9 min on foot;
- One school, Mt Albert Grammar School, from 89bb50021b7ffff: the zone
  headline (a share of the children living in its zone), the zone outlined
  on the map, the stops near the school listed and marked, and the card's
  15 min on foot with R5's 26 by bus or train; Who misses out is on;
- One school, Marist College (no home zone): a count, and Who misses out off;
- Wellington, In zone, girls, at 89bb295594fffff;
- Blenheim, State, secondary, at 89bb29ba32fffff: public transport is the
  22-minute walk, where R5 had none within the hour;
- a fare budget of $0: public transport counts the walks that need no fare;
- the tooltip's first line is the card's;
- the About text has the In zone, Who is counted and How times are worked
  out sections;
- on a phone, the choices are one select and the card opens clear of the map.

It saves a screenshot of each. Exits with status 1 on any failure or any
console error (a 404 for a file a test build does not have is not one).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

DELAY_MS = 1500
SLIDE = "89bb50021a3ffff"
SOUTH_EAST = "89bb50021b7ffff"


def ready(page: Page) -> None:
    page.wait_for_function("() => document.getElementById('loading').hidden === true", timeout=120_000)
    page.wait_for_function("() => window.team && window.team.map && window.team.map.loaded()", timeout=120_000)
    page.wait_for_function("() => !(document.querySelector('#view > .note')?.textContent || '').startsWith('Loading')", timeout=120_000)
    page.wait_for_function("() => !(document.querySelector('#place-body')?.textContent || '').startsWith('Loading')", timeout=120_000)
    page.wait_for_timeout(1500)


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
      view: document.getElementById('view')?.innerText || '',
      school: document.getElementById('school-field')?.innerText || '',
      band: document.querySelector('#place-body .verdict')?.innerText || '',
      strong: (document.querySelector('#place-body .verdict strong')?.textContent || '').trim(),
      hash: location.hash,
      key: document.getElementById('key-body')?.innerText || '',
      painted: window.team.map.queryRenderedFeatures({ layers: ['cells-fill'] }).filter((f) => f.state && f.state.k != null).length,
      outline: (() => { const s = window.team.map.getSource('school-zone'); return s && s._data && s._data.geometry ? s._data.geometry.type : null; })(),
      stopTags: document.querySelectorAll('.map-tag.is-school-stop').length,
    })""")


def tooltip_at(page: Page, cell: str) -> list[str]:
    """The map's tooltip over a hexagon, a line a part."""
    at = page.evaluate(f"""() => {{
      const [lat, lng] = h3.cellToLatLng('{cell}');
      const p = window.team.map.project([lng, lat]);
      const r = window.team.map.getContainer().getBoundingClientRect();
      return [p.x + r.left, p.y + r.top];
    }}""")
    page.mouse.move(at[0] - 3, at[1] - 3)
    page.mouse.move(at[0], at[1])
    page.wait_for_timeout(400)
    return page.evaluate("() => [...document.querySelectorAll('#tooltip > span')].map((s) => s.textContent.trim())")


def check(problems: list[str], label: str, ok: bool, detail: str) -> None:
    if not ok:
        problems.append(f"{label}: {detail[:600]}")


def go(page: Page, base: str, city: str, hash_: str) -> dict:
    page.goto("about:blank")
    page.goto(f"{base}&city={city}#{hash_}")
    ready(page)
    return panel(page)


def desktop(page: Page, base: str, out: Path, engine: str, problems: list[str]) -> None:
    # The slide link, as the councillors have it: no sch, so the default.
    seen = go(page, base, "auckland", f"s=secondary_school&m=pt&o={SLIDE}")
    check(problems, f"{engine} slide", "sch=zone" in seen["hash"], seen["hash"])
    check(problems, f"{engine} slide", seen["counting"].startswith("In zone: state secondary schools taught in English that must take a child living here"), seen["counting"])
    check(problems, f"{engine} slide", "Counting children aged 13–17" in seen["counting"], seen["counting"])
    check(problems, f"{engine} slide", "of children aged 13–17 in Auckland can reach a state secondary school that must take them within 30 minutes by public transport, or on foot where that is quicker." in seen["hero"], seen["hero"])
    check(problems, f"{engine} slide", seen["strong"] == "State secondary school, in zone: 15 min on foot. No bus or train is quicker.", seen["strong"])
    check(problems, f"{engine} slide", "Nearest state school that must take them: Mt Albert Grammar School." in seen["band"], seen["band"])
    check(problems, f"{engine} slide", seen["painted"] > 0, "no hexagons painted")
    lines = tooltip_at(page, SLIDE)
    check(problems, f"{engine} slide tooltip", bool(lines) and lines[0] == seen["strong"], f"{lines} / {seen['strong']}")
    page.screenshot(path=str(out / f"{engine}-1-slide-in-zone.png"))

    seen = go(page, base, "auckland", f"s=secondary_school&m=pt&sch=all&o={SLIDE}")
    check(problems, f"{engine} slide all", seen["counting"].startswith("Counting all"), seen["counting"])
    check(problems, f"{engine} slide all", seen["strong"] == "Secondary school: 9 min on foot. No bus or train is quicker.", seen["strong"])
    check(problems, f"{engine} slide all", "sch=all" in seen["hash"], seen["hash"])
    page.screenshot(path=str(out / f"{engine}-2-slide-all.png"))

    # One school with a zone.
    seen = go(page, base, "auckland", f"s=secondary_school&m=pt&sch=one:69&o={SOUTH_EAST}")
    check(problems, f"{engine} MAGS", "living in Mt Albert Grammar School's zone are within 30 minutes of it by public transport, or on foot where that is quicker." in seen["hero"], seen["hero"])
    check(problems, f"{engine} MAGS", " are not." in seen["hero"], seen["hero"])
    check(problems, f"{engine} MAGS", seen["outline"] in ("Polygon", "MultiPolygon"), f"outline {seen['outline']}")
    check(problems, f"{engine} MAGS", "Stops near the school" in seen["school"], seen["school"])
    check(problems, f"{engine} MAGS", seen["stopTags"] > 0, "no stops marked on the map")
    check(problems, f"{engine} MAGS", seen["strong"] == "Mt Albert Grammar School: 15 min on foot. No bus or train is quicker.", seen["strong"])
    check(problems, f"{engine} MAGS", "By bus or train: 26 min." in seen["band"] and "In its zone." in seen["band"], seen["band"])
    check(problems, f"{engine} MAGS", "Its zone" in seen["key"] and "Outside its zone" in seen["key"], seen["key"])
    page.screenshot(path=str(out / f"{engine}-3-mags.png"))
    page.click("#school-field details[data-fold='school-stops'] > summary")
    page.wait_for_timeout(300)
    stops = page.evaluate("() => document.querySelector('#school-field .stop-list')?.innerText || ''")
    check(problems, f"{engine} MAGS stops", "Mount Albert Grammar School (stop 1427) · 1 min walk" in stops, stops[:300])
    page.screenshot(path=str(out / f"{engine}-4-mags-stops.png"))
    seen = go(page, base, "auckland", "s=secondary_school&v=people&m=best&sch=one:69")
    check(problems, f"{engine} MAGS people", "can't reach it within 30 minutes" in seen["hero"] and "Mt Albert Grammar School's zone" in seen["hero"], seen["hero"])
    groups = page.evaluate("() => [...document.querySelectorAll('#people option')].map((o) => o.textContent)")
    check(problems, f"{engine} MAGS groups", groups[:1] == ["Children aged 13–17"] and "Children" not in groups[1:] and "65 and over" not in groups, str(groups))
    page.screenshot(path=str(out / f"{engine}-5-mags-people.png"))

    # One school with no home zone.
    seen = go(page, base, "auckland", f"s=secondary_school&m=pt&sch=one:70&o={SLIDE}")
    check(problems, f"{engine} Marist", "children aged 13–17 live within 30 minutes of Marist College" in seen["hero"] and "no catchment" in seen["hero"], seen["hero"])
    seen = go(page, base, "auckland", "s=secondary_school&v=people&m=best&sch=one:70")
    check(problems, f"{engine} Marist people", "home zone" in seen["view"] and "can't reach" not in seen["view"], seen["view"][:300])
    page.screenshot(path=str(out / f"{engine}-6-marist-people.png"))

    # Wellington, In zone, girls.
    seen = go(page, base, "wellington", "s=secondary_school&m=pt&sch=zone&stu=girls&o=89bb295594fffff")
    check(problems, f"{engine} Wellington girls", "stu=girls" in seen["hash"] and "must take a girl living here" in seen["counting"], seen["counting"])
    check(problems, f"{engine} Wellington girls", seen["strong"].startswith("State secondary school, in zone, girls:"), seen["strong"])
    page.screenshot(path=str(out / f"{engine}-7-wellington-girls.png"))

    # Blenheim, State: the walk that R5 left out.
    seen = go(page, base, "blenheim", "s=secondary_school&m=pt&sch=state&o=89bb29ba32fffff")
    check(problems, f"{engine} Blenheim", seen["strong"] == "State secondary school: 22 min on foot. No bus or train is quicker.", seen["strong"])
    check(problems, f"{engine} Blenheim", "No bus or train gets there within 60 min." in seen["band"], seen["band"])
    page.screenshot(path=str(out / f"{engine}-8-blenheim-state.png"))

    # A fare budget of $0: walks need no fare.
    seen = go(page, base, "auckland", f"s=gp&m=pt&c=0.adult.hop.r&o={SLIDE}")
    check(problems, f"{engine} fare 0", seen["hero"].strip()[:1].isdigit(), seen["hero"])
    page.screenshot(path=str(out / f"{engine}-9-fare-zero.png"))

    # About.
    page.click("#about-open")
    page.wait_for_timeout(400)
    about = page.evaluate("() => document.getElementById('about')?.innerText || ''")
    for text in ["In zone: the state schools taught in English that must take a child living there", "Who is counted", "How times are worked out", "Eagle Technology"]:
        check(problems, f"{engine} about", text in about, text)


def phone(browser, base: str, out: Path, engine: str, problems: list[str], errors: list[str]) -> None:
    context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=engine != "firefox", has_touch=True)
    page = context.new_page()
    page.on("console", lambda m: errors.append(f"{engine} phone: {m.text}") if m.type == "error" and "404" not in m.text else None)
    page.on("pageerror", lambda e: errors.append(f"{engine} phone: {e}"))
    held_back(page)
    page.goto(f"{base}&city=auckland#s=secondary_school&m=pt&o={SLIDE}")
    ready(page)
    framed = page.evaluate(f"""() => {{
      const [lat, lng] = h3.cellToLatLng('{SLIDE}');
      const at = window.team.map.project([lng, lat]);
      const card = document.getElementById('place').getBoundingClientRect().top;
      return {{ x: at.x, y: at.y, card, width: window.innerWidth, scroll: document.documentElement.scrollWidth }};
    }}""")
    check(problems, f"{engine} phone card", 0 < framed["x"] < framed["width"] and 0 < framed["y"] < framed["card"], str(framed))
    check(problems, f"{engine} phone", framed["scroll"] <= framed["width"], f"page scrolls sideways: {framed}")
    page.screenshot(path=str(out / f"{engine}-10-phone-card.png"))
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
    check(problems, f"{engine} phone", shown["value"] == "zone", str(shown))
    page.screenshot(path=str(out / f"{engine}-11-phone-in-zone.png"))
    page.goto("about:blank")
    page.goto(f"{base}&city=auckland#s=secondary_school&m=pt&sch=one:69")
    ready(page)
    page.evaluate("() => window.team.sheet('full')")
    page.wait_for_timeout(500)
    page.screenshot(path=str(out / f"{engine}-12-phone-mags.png"))
    context.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", required=True, help="the page with ?data= for the build to test, no city")
    parser.add_argument("--out", default="build/shots/schools")
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
            page.on("console", lambda m, e=engine: errors.append(f"{e}: {m.text}") if m.type == "error" and "404" not in m.text else None)
            page.on("pageerror", lambda exc, e=engine: errors.append(f"{e}: {exc}"))
            held_back(page)
            desktop(page, args.base, out, engine, problems)
            phone(browser, args.base, out, engine, problems, errors)
            browser.close()
    for line in problems + errors:
        print(line)
    print(f"{len(problems)} problems, {len(errors)} console errors. Screenshots in {out}.")
    return 1 if problems or errors else 0


if __name__ == "__main__":
    sys.exit(main())
