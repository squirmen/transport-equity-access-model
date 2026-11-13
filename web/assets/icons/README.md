# Map icons

The glyphs on TEAM's map symbols, the key and the stop list. Each file is
copied byte for byte from its source; none has been edited.

- Twelve are Material Icons, filled style, 24 px grid, by Google, under the
  Apache License 2.0. From github.com/google/material-design-icons at commit
  `10ecc14790612ca8fd164e3f4ffe9c16fc50d5b7`,
  `src/<category>/<name>/materialicons/24px.svg`.
- `temaki_tram_side.svg` is Temaki's `tram_side` (15 px grid), dedicated to
  the public domain under CC0 1.0. From github.com/rapideditor/temaki at
  commit `6d9ac860d1d615d4449aab049f630d25d036c19e`, `icons/tram_side.svg`.
  Stations use it because Material's `train` and `directions_bus` are both a
  vehicle seen from the front and read alike at map size.

`LICENSE` here has both licences. All thirteen were fetched on 13 November
2026 from the addresses below.

| File | Used for | Source |
| --- | --- | --- |
| `school.svg` | primary, intermediate and secondary schools; tertiary campuses | https://raw.githubusercontent.com/google/material-design-icons/10ecc14790612ca8fd164e3f4ffe9c16fc50d5b7/src/social/school/materialicons/24px.svg |
| `child_friendly.svg` | early childhood services | https://raw.githubusercontent.com/google/material-design-icons/10ecc14790612ca8fd164e3f4ffe9c16fc50d5b7/src/places/child_friendly/materialicons/24px.svg |
| `build.svg` | trades training campuses | https://raw.githubusercontent.com/google/material-design-icons/10ecc14790612ca8fd164e3f4ffe9c16fc50d5b7/src/action/build/materialicons/24px.svg |
| `shopping_cart.svg` | supermarkets | https://raw.githubusercontent.com/google/material-design-icons/10ecc14790612ca8fd164e3f4ffe9c16fc50d5b7/src/action/shopping_cart/materialicons/24px.svg |
| `medical_services.svg` | GPs | https://raw.githubusercontent.com/google/material-design-icons/10ecc14790612ca8fd164e3f4ffe9c16fc50d5b7/src/maps/medical_services/materialicons/24px.svg |
| `local_pharmacy.svg` | pharmacies | https://raw.githubusercontent.com/google/material-design-icons/10ecc14790612ca8fd164e3f4ffe9c16fc50d5b7/src/maps/local_pharmacy/materialicons/24px.svg |
| `local_library.svg` | libraries | https://raw.githubusercontent.com/google/material-design-icons/10ecc14790612ca8fd164e3f4ffe9c16fc50d5b7/src/maps/local_library/materialicons/24px.svg |
| `account_balance.svg` | banks and post shops | https://raw.githubusercontent.com/google/material-design-icons/10ecc14790612ca8fd164e3f4ffe9c16fc50d5b7/src/action/account_balance/materialicons/24px.svg |
| `directions_bus.svg` | bus stops | https://raw.githubusercontent.com/google/material-design-icons/10ecc14790612ca8fd164e3f4ffe9c16fc50d5b7/src/maps/directions_bus/materialicons/24px.svg |
| `temaki_tram_side.svg` | train stations, and a train trip's route label | https://raw.githubusercontent.com/rapideditor/temaki/6d9ac860d1d615d4449aab049f630d25d036c19e/icons/tram_side.svg |
| `train.svg` | not drawn since 0.12.1 (stations use `temaki_tram_side.svg`); kept with the set | https://raw.githubusercontent.com/google/material-design-icons/10ecc14790612ca8fd164e3f4ffe9c16fc50d5b7/src/maps/train/materialicons/24px.svg |
| `directions_boat.svg` | ferry terminals | https://raw.githubusercontent.com/google/material-design-icons/10ecc14790612ca8fd164e3f4ffe9c16fc50d5b7/src/maps/directions_boat/materialicons/24px.svg |
| `directions_walk.svg` | the walking badge on stops near a school ("7 min") | https://raw.githubusercontent.com/google/material-design-icons/10ecc14790612ca8fd164e3f4ffe9c16fc50d5b7/src/maps/directions_walk/materialicons/24px.svg |

Each file was checked before it was copied here: plain SVG shapes only (path,
rect, polygon, g), with no script, style, link or reference to another file.

The page draws the glyphs from `web/js/glyphs.js`; it does not load these
files. After changing a file, run `python scripts/build_glyphs.py`, which
writes `glyphs.js` (`tests/web/symbols.test.mjs` checks the two match). No
operator's or agency's marks are used.
