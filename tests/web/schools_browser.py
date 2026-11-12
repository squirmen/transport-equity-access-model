"""Check the Schools row in Chromium and WebKit, desktop and phone, with the
stylesheet held back the way WebKit can leave it, on a build with the 0.12.0
round-2 school files (zones, ages, public transport or walking, stops).

    python tests/web/schools_browser.py --base "http://localhost:8812/web/?data=../build/site/data/" \
        --fixture "http://localhost:8812/web/?city=web&data=../tests/fixtures/" --out build/shots/schools

`--base` is the page with ?data= for the build (no city); `--fixture` the
page on the synthetic fixture (tests/fixtures/make_web_fixture.py). The scenes:

- the councillors' slide link, written without sch: it opens In zone, the
  link then says sch=zone, the line under the headline says which schools
  must take a child living there and counts children aged 13 to 17, and the
  card names Mt Albert Grammar School, 15 min on foot;
- the same link with sch=all: All, and TKKM o Nga Maungarongo 9 min on foot;
- One school, Mt Albert Grammar School, from 89bb50021b7ffff: the zone
  headline (a share of the children living in its zone), the zone outlined
  on the map, the stops near the school listed and drawn as symbols with
  walking badges (23 symbols below zoom 16.5; the stations and the 1-minute
  stop keep their badges at zoom 13 and 15, and 20 or more badges show at
  zoom 15), Baldwin Ave and Mt Albert train stations (16 and 17 minutes)
  under their own line, a stop's tooltip and its Show button, and the
  card's 15 min on foot with R5's 26 by bus or train; Who misses out is on;
- picking a school (0.12.1): the search is there under In zone; the slide
  hexagon's card names Mt Albert Grammar School as a link that shows only
  it, keeping the card and o=; Clear goes back to In zone; a link with
  sch=one opens with the cursor in the search; a school's pin offers "Show
  only this school"; on a phone, a pick drops the sheet with the zone in
  view;
- in every scene, every symbol drawn on the map has a row in the key;
- One school, Marist College (no home zone, a girls' school): a count of
  girls, and Who misses out off;
- Wellington, In zone, girls, at 89bb295594fffff;
- Blenheim, State, secondary, at 89bb29ba32fffff: public transport is the
  22-minute walk, where R5 had none within the hour;
- a fare budget of $0: public transport counts the walks that need no fare;
- the tooltip's first line is the card's;
- the About text has the In zone, Who is counted and How times are worked
  out sections;
- on a phone, the choices are one select and the card opens clear of the map;
- a place built before zones, or any place where zones.json is missing,
  shows All and says so (--old-city; 0.12.0 gave every place zones, so pass
  --old-city none for a 0.12.0 build);
- on the fixture: In zone by default, and One school with its zone, stops and
  Who misses out.

It saves a screenshot of each. Exits with status 1 on any failure or any
console error (a 404 for a file a test build does not have is not one).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

DELAY_MS = 1500
CHROMIUM_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
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
      // textContent: the key may be folded away, and WebKit gives no innerText for what is hidden.
      key: document.getElementById('key-body')?.textContent || '',
      painted: window.team.map.queryRenderedFeatures({ layers: ['cells-fill'] }).filter((f) => f.state && f.state.k != null).length,
      outline: (() => { const s = window.team.map.getSource('school-zone'); return s && s._data && s._data.geometry ? s._data.geometry.type : null; })(),
      stops: (() => { const s = window.team.map.getSource('near-all'); return s && s._data && s._data.features ? s._data.features.length : 0; })(),
      onScreen: window.team.onScreen(),
      keyRows: window.team.keyRows(),
    })""")


def stop_symbols(page: Page, zoom: float) -> dict:
    """The stops near the school as the map draws them at `zoom`, centred on
    the school: how many symbols, which carry a walking badge, and the
    minutes on the stations' badges."""
    page.evaluate(f"() => window.team.map.jumpTo({{ center: [174.7245, -36.8835], zoom: {zoom} }})")
    page.wait_for_function("() => window.team.map.loaded() && window.team.map.areTilesLoaded()", timeout=60_000)
    page.wait_for_timeout(1200)
    return page.evaluate("""() => {
      const m = window.team.map;
      const stops = m.queryRenderedFeatures({ layers: ['near-stop', 'near-stop-all'] });
      const badges = m.queryRenderedFeatures({ layers: ['near-badge', 'near-badge-all'] });
      const ks = new Set(stops.map((f) => f.properties.ks));
      const badged = new Set(badges.map((f) => f.properties.ks));
      const station = badges.filter((f) => f.properties.station === 1).map((f) => f.properties.walk).sort((a, b) => a - b);
      const stationsDrawn = stops.filter((f) => f.properties.station === 1).length;
      return { symbols: ks.size, badges: badged.size, stations: station, stationsDrawn, one: badges.some((f) => f.properties.walk === 1) };
    }""")


def symbols_in_key(problems: list[str], label: str, seen: dict) -> None:
    """Every symbol drawn on the map has a row in the key."""
    missing = sorted(set(seen["onScreen"]) - set(seen["keyRows"]))
    check(problems, f"{label} key", not missing, f"drawn but not in the key: {missing}")


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
    symbols_in_key(problems, f"{engine} slide", seen)
    # The search is there under In zone, before any school is picked.
    check(problems, f"{engine} slide search", page.is_visible("#school-search") and "Find a school" in seen["school"], seen["school"][:200])
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
    check(problems, f"{engine} MAGS", seen["stops"] == 35, f"{seen['stops']} stops on the map")
    symbols_in_key(problems, f"{engine} MAGS", seen)
    check(problems, f"{engine} MAGS", seen["strong"] == "Mt Albert Grammar School: 15 min on foot. No bus or train is quicker.", seen["strong"])
    check(problems, f"{engine} MAGS", "By bus or train: 26 min." in seen["band"] and "Inside its enrolment zone." in seen["band"], seen["band"])
    check(problems, f"{engine} MAGS", "Its home zone" in seen["key"] and "Outside its zone" in seen["key"], seen["key"])
    check(problems, f"{engine} MAGS", "Minutes on foot from the stop to the school" in seen["key"] and "Train station" in seen["key"], seen["key"])
    # The key keeps room for what the map draws, on a laptop as well.
    room = page.evaluate("() => { const rows = [...document.querySelectorAll('#key-body .k-layers .k-row')].slice(0, 4); const box = document.getElementById('key').getBoundingClientRect(); return rows.length && rows.every((r) => r.getBoundingClientRect().bottom <= box.bottom + 1); }")
    check(problems, f"{engine} MAGS key room", room, "the first rows of On the map are cut off")
    page.screenshot(path=str(out / f"{engine}-3-mags.png"))
    page.click("#school-field details[data-fold='school-stops'] > summary")
    page.wait_for_timeout(300)
    stops = page.evaluate("() => document.querySelector('#school-field .stop-list')?.innerText || ''")
    check(problems, f"{engine} MAGS stops", "Mount Albert Grammar School (stop 1427) · 1 min walk" in stops, stops[:300])
    far = page.evaluate("""() => ({
      head: document.querySelector('#school-field .stop-far-head')?.textContent || '',
      rows: [...document.querySelectorAll('#school-field .stop-list.is-far .stop-text')].map((li) => li.textContent),
      summary: document.querySelector("#school-field details[data-fold='school-stops'] .fold-sum")?.textContent || '',
    })""")
    check(problems, f"{engine} MAGS stations", far["head"] == "Nearest train stations, beyond a 15-minute walk", far["head"])
    check(problems, f"{engine} MAGS stations", far["rows"][:2] == [
        "Baldwin Ave Train Station (stop 119) · 16 min walk · 23 trips arriving 7–9am · E-W",
        "Mt Albert Train Station (stop 120) · 17 min walk · 23 trips arriving 7–9am · E-W"], str(far["rows"]))
    check(problems, f"{engine} MAGS stations", far["summary"].startswith("32 within 15 min · ") and "train stations within 30 min" in far["summary"], far["summary"])
    # The Show button finds the stop on the map and opens what it says.
    page.click("#school-field .stop-list .stop-show >> nth=0")
    page.wait_for_timeout(1500)
    pop = page.evaluate("() => document.querySelector('.point-popup')?.innerText || ''")
    check(problems, f"{engine} MAGS stop show", "Mount Albert Grammar School (stop 1427)" in pop and "1 min walk to the school" in pop, pop)
    page.keyboard.press("Escape")
    for zoom, least in ((13, 7), (15, 20)):
        drawn = stop_symbols(page, zoom)
        # Every station in view keeps its badge, and so does the 1-minute stop.
        check(problems, f"{engine} MAGS symbols z{zoom}", drawn["symbols"] >= 20 and drawn["stationsDrawn"] >= 2, str(drawn))
        check(problems, f"{engine} MAGS badges z{zoom}", drawn["badges"] >= least and drawn["one"], str(drawn))
        check(problems, f"{engine} MAGS station badges z{zoom}", len(drawn["stations"]) == drawn["stationsDrawn"] and drawn["stations"][:2] == [16, 17], str(drawn))
        symbols_in_key(problems, f"{engine} MAGS z{zoom}", panel(page))
    page.screenshot(path=str(out / f"{engine}-4-mags-stops.png"))
    # A stop's tooltip: its name, its walk and its trips.
    at = page.evaluate("""() => {
      const m = window.team.map;
      const f = m.queryRenderedFeatures({ layers: ['near-stop'] }).find((x) => x.properties.station === 1);
      if (!f) return null;
      const p = m.project(f.geometry.coordinates);
      const r = m.getContainer().getBoundingClientRect();
      return [p.x + r.left, p.y + r.top];
    }""")
    if at:
        page.mouse.move(at[0] - 2, at[1] - 2)
        page.mouse.move(at[0], at[1])
        page.wait_for_timeout(400)
        tip = page.evaluate("() => document.getElementById('tooltip').hidden ? '' : document.getElementById('tooltip').innerText")
        check(problems, f"{engine} MAGS stop tooltip", "Train Station" in tip and "min walk to the school" in tip and "arriving 7–9am" in tip, tip)
    else:
        check(problems, f"{engine} MAGS stop tooltip", False, "no station drawn")
    seen = go(page, base, "auckland", "s=secondary_school&v=people&m=best&sch=one:69")
    check(problems, f"{engine} MAGS people", "can't reach it within 30 minutes" in seen["hero"] and "Mt Albert Grammar School's zone" in seen["hero"], seen["hero"])
    groups = page.evaluate("() => [...document.querySelectorAll('#people option')].map((o) => o.textContent)")
    check(problems, f"{engine} MAGS groups", groups[:1] == ["Children aged 13–17"] and "Children" not in groups[1:] and "65 and over" not in groups, str(groups))
    page.screenshot(path=str(out / f"{engine}-5-mags-people.png"))

    # One school with no home zone.
    seen = go(page, base, "auckland", f"s=secondary_school&m=pt&sch=one:70&o={SLIDE}")
    check(problems, f"{engine} Marist", "girls aged 13–17 live within 30 minutes of Marist College" in seen["hero"] and "no catchment" in seen["hero"], seen["hero"])
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
    page.keyboard.press("Escape")
    picking(page, base, out, engine, problems)


def picking(page: Page, base: str, out: Path, engine: str, problems: list[str]) -> None:
    """Picking a school (0.12.1): from the card, by the search, from a pin, and Clear."""
    seen = go(page, base, "auckland", f"s=secondary_school&m=pt&o={SLIDE}")
    link = page.locator("#place-body .verdict .link-button", has_text="Mt Albert Grammar School")
    check(problems, f"{engine} card link", link.count() == 1, f"{link.count()} links to MAGS in the band")
    if link.count():
        link.first.click()
        page.wait_for_timeout(1500)
        ready(page)
        seen = panel(page)
        check(problems, f"{engine} card link", "sch=one:69" in seen["hash"] and f"o={SLIDE}" in seen["hash"], seen["hash"])
        check(problems, f"{engine} card link", page.evaluate("() => !document.getElementById('place').hidden"), "the card closed")
        check(problems, f"{engine} card link", page.evaluate("() => document.activeElement?.id") == "school-picked-name", "focus is not on the school's name")
        symbols_in_key(problems, f"{engine} card link", seen)
        page.screenshot(path=str(out / f"{engine}-16-card-link.png"))
        page.click("#school-clear")
        page.wait_for_timeout(1500)
        ready(page)
        seen = panel(page)
        check(problems, f"{engine} clear", "sch=zone" in seen["hash"], seen["hash"])
        check(problems, f"{engine} clear", page.evaluate("() => document.activeElement?.id") == "school-search", "focus is not in the search")
    # A link to One school with none picked: the search, with the cursor in it, and no figure.
    seen = go(page, base, "auckland", "s=secondary_school&m=pt&sch=one")
    check(problems, f"{engine} sch=one", "sch=one" in seen["hash"] and "sch=one:" not in seen["hash"], seen["hash"])
    check(problems, f"{engine} sch=one", page.evaluate("() => document.activeElement?.id") == "school-search", "the search is not focused")
    check(problems, f"{engine} sch=one", seen["hero"].startswith("Pick a school to see who can reach it."), seen["hero"])
    symbols_in_key(problems, f"{engine} sch=one", seen)
    page.keyboard.type("MAGS")
    page.wait_for_timeout(300)
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Enter")
    page.wait_for_timeout(1500)
    ready(page)
    seen = panel(page)
    check(problems, f"{engine} search pick", "sch=one:69" in seen["hash"], seen["hash"])
    # Another school's pin: its tooltip, then Show this school instead.
    at = page.evaluate("""() => {
      const m = window.team.map;
      const f = m.queryRenderedFeatures({ layers: ['dest-out'] }).find((x) => { const p = m.project(x.geometry.coordinates); return p.x > 420 && p.x < 1000 && p.y > 100 && p.y < 800; });
      if (!f) return null;
      const p = m.project(f.geometry.coordinates);
      const r = m.getContainer().getBoundingClientRect();
      return [p.x + r.left, p.y + r.top];
    }""")
    if at:
        page.mouse.move(at[0] - 2, at[1] - 2)
        page.mouse.move(at[0], at[1])
        page.wait_for_timeout(400)
        tip = page.evaluate("() => document.getElementById('tooltip').hidden ? '' : document.getElementById('tooltip').innerText")
        check(problems, f"{engine} pin tooltip", "Not counted: One school counts Mt Albert Grammar School only." in tip and "Click to show only this school" in tip, tip)
        page.mouse.click(at[0], at[1])
        page.wait_for_timeout(500)
        pop = page.evaluate("() => document.querySelector('.point-popup .point-button.is-primary')?.textContent || ''")
        check(problems, f"{engine} pin popup", pop == "Show this school instead", pop)
        page.screenshot(path=str(out / f"{engine}-17-pin-popup.png"))
    else:
        check(problems, f"{engine} pin tooltip", False, "no other school drawn")


def older(page: Page, base: str, city: str, out: Path, engine: str, problems: list[str]) -> None:
    """A build with no zones: All, and a line saying why."""
    seen = go(page, base, city, "s=secondary_school&m=pt")
    check(problems, f"{engine} no zones", "Zones could not be loaded; showing all schools." in seen["school"], seen["school"])
    check(problems, f"{engine} no zones", "sch=all" in seen["hash"] and seen["counting"].startswith("Counting all"), seen["hash"] + seen["counting"])
    page.screenshot(path=str(out / f"{engine}-13-no-zones.png"))


def fixture(page: Page, base: str, out: Path, engine: str, problems: list[str]) -> None:
    """The synthetic fixture: the same rules on made-up files."""
    page.goto("about:blank")
    page.goto(f"{base}#s=secondary_school&m=pt")
    ready(page)
    seen = panel(page)
    check(problems, f"{engine} fixture", "sch=zone" in seen["hash"] and seen["counting"].startswith("In zone:"), seen["hash"] + seen["counting"])
    check(problems, f"{engine} fixture", "children aged 13–17" in seen["hero"], seen["hero"])
    page.screenshot(path=str(out / f"{engine}-14-fixture-in-zone.png"))
    page.goto("about:blank")
    page.goto(f"{base}#s=secondary_school&m=best&sch=one:9030")
    ready(page)
    seen = panel(page)
    check(problems, f"{engine} fixture one", "living in Testville State Secondary 1's zone" in seen["hero"], seen["hero"])
    check(problems, f"{engine} fixture one", seen["outline"] == "Polygon" and seen["stops"] == 2, f"{seen['outline']} {seen['stops']}")
    page.click("#tabs [data-view='people']")
    ready(page)
    seen = panel(page)
    check(problems, f"{engine} fixture people", "can't reach it within 30 minutes" in seen["hero"], seen["hero"])
    page.screenshot(path=str(out / f"{engine}-15-fixture-one-people.png"))


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
    # Picking on a phone: the search opens the sheet full; a pick drops it to
    # the peek, with the school's zone on the map above it.
    page.goto("about:blank")
    page.goto(f"{base}&city=auckland#s=secondary_school&m=pt&sch=zone")
    ready(page)
    page.evaluate("() => window.team.sheet('half')")
    page.wait_for_timeout(400)
    page.tap("#school-search")
    page.wait_for_timeout(400)
    check(problems, f"{engine} phone search", page.evaluate("() => document.getElementById('side').dataset.sheet") == "full", "the sheet did not open full")
    page.keyboard.type("MAGS")
    page.wait_for_timeout(300)
    page.tap("#school-results [role=option] >> nth=0")
    page.wait_for_timeout(1500)
    ready(page)
    seen = panel(page)
    framed = page.evaluate("""() => {
      const m = window.team.map;
      const s = m.getSource('school-zone')._data;
      const ring = s && s.geometry ? (s.geometry.type === 'Polygon' ? s.geometry.coordinates[0] : s.geometry.coordinates[0][0]) : [];
      const top = document.getElementById('side').getBoundingClientRect().top;
      const inView = ring.filter(([x, y]) => { const p = m.project([x, y]); return p.x >= 0 && p.x <= innerWidth && p.y >= 0 && p.y <= top; }).length;
      return { sheet: document.getElementById('side').dataset.sheet, share: ring.length ? inView / ring.length : 0, scroll: document.documentElement.scrollWidth, width: innerWidth };
    }""")
    check(problems, f"{engine} phone pick", "sch=one:69" in seen["hash"] and framed["sheet"] == "peek" and framed["share"] >= 0.95, str(framed))
    check(problems, f"{engine} phone pick", framed["scroll"] <= framed["width"], f"page scrolls sideways: {framed}")
    symbols_in_key(problems, f"{engine} phone pick", seen)
    page.screenshot(path=str(out / f"{engine}-18-phone-pick.png"))
    context.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", required=True, help="the page with ?data= for the build to test, no city")
    parser.add_argument("--fixture", help="the page on the synthetic fixture, with ?city= and ?data=")
    parser.add_argument("--old-city", default="christchurch", help="a place in the build with no zones, or none to skip")
    parser.add_argument("--out", default="build/shots/schools")
    parser.add_argument("--engines", default="chromium,webkit")
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    problems: list[str] = []
    errors: list[str] = []
    with sync_playwright() as p:
        for engine in args.engines.split(","):
            # Chromium draws the map with SwiftShader's WebGL when there is no GPU.
            browser = p.chromium.launch(args=CHROMIUM_ARGS) if engine == "chromium" else getattr(p, engine).launch()
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            page.on("console", lambda m, e=engine: errors.append(f"{e}: {m.text}") if m.type == "error" and "404" not in m.text else None)
            page.on("pageerror", lambda exc, e=engine: errors.append(f"{e}: {exc}"))
            held_back(page)
            desktop(page, args.base, out, engine, problems)
            if args.old_city != "none":
                older(page, args.base, args.old_city, out, engine, problems)
            if args.fixture:
                fixture(page, args.fixture, out, engine, problems)
            phone(browser, args.base, out, engine, problems, errors)
            browser.close()
    for line in problems + errors:
        print(line)
    print(f"{len(problems)} problems, {len(errors)} console errors. Screenshots in {out}.")
    return 1 if problems or errors else 0


if __name__ == "__main__":
    sys.exit(main())
