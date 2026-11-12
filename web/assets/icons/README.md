# Map icons

The glyphs on TEAM's map symbols, the key and the stop list. Material Icons,
filled style, 24 px grid, by Google, under the Apache License 2.0 (`LICENSE`
here). Source: github.com/google/material-design-icons,
`src/<category>/<name>/materialicons/24px.svg`.

| File | Used for |
| --- | --- |
| `school.svg` | primary, intermediate and secondary schools; tertiary campuses |
| `child_friendly.svg` | early childhood services |
| `build.svg` | trades training campuses |
| `shopping_cart.svg` | supermarkets |
| `medical_services.svg` | GPs |
| `local_pharmacy.svg` | pharmacies |
| `local_library.svg` | libraries |
| `account_balance.svg` | banks and post shops |
| `directions_bus.svg` | bus stops |
| `train.svg` | train stations |
| `directions_boat.svg` | ferry terminals |
| `directions_walk.svg` | walking minutes from a stop to a school |

The path data in these twelve files was typed in from the Material Icons set
for the 0.12.1 design work (13 November 2026) and checked by drawing each one;
it has not yet been compared with the files in Google's repository, which were
not downloaded. To replace them with the official files, copy each
`materialicons/24px.svg` over the file of the same name here, note the commit
and date below, and run `python scripts/build_glyphs.py`, which writes
`web/js/glyphs.js` (`tests/web/symbols.test.mjs` checks the two match).

The page draws the glyphs from `web/js/glyphs.js`; it does not load these
files. No operator's or agency's marks are used.

Fetched: not yet (typed in, 13 November 2026).
