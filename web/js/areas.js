// Who misses out, area by area, for whatever is on screen.
//
// The map shows where the shortfall is; a council needs the same thing as a
// table it can sort, act on and take away. Every figure here is recomputed
// from the current settings, so the table always matches the map.

/** One row per area: people, how many miss the standard, the share, how far
 *  short they are on average, and the area's average NZDep.
 *
 *  `areaOf[i]` names the area of hexagon i (null to skip it), `gaps` is each
 *  hexagon's shortfall as a share of the standard, and `weights` the people
 *  being counted there. */
export function areaTable(areaOf, gaps, weights, nzdep, standard) {
  const rows = new Map();
  for (let i = 0; i < gaps.length; i += 1) {
    const area = areaOf[i];
    const w = weights[i];
    if (area == null || !(w > 0)) continue;
    let row = rows.get(area);
    if (!row) {
      row = { area, people: 0, missing: 0, minutes: 0, dep: 0, depPeople: 0 };
      rows.set(area, row);
    }
    row.people += w;
    if (gaps[i] > 0) {
      row.missing += w;
      row.minutes += w * gaps[i] * standard;
    }
    if (Number.isFinite(nzdep[i])) {
      row.dep += w * nzdep[i];
      row.depPeople += w;
    }
  }
  return [...rows.values()].map((row) => ({
    area: row.area,
    people: row.people,
    missing: row.missing,
    share: row.people > 0 ? row.missing / row.people : NaN,
    minutesShort: row.missing > 0 ? row.minutes / row.missing : NaN,
    nzdep: row.depPeople > 0 ? row.dep / row.depPeople : NaN,
  }));
}

/** Sort by how many miss out, or by the share who do. The share ignores
 *  areas too small for a percentage to mean much. */
export function sortAreas(rows, by = 'missing', minimum = 100) {
  const eligible = by === 'share' ? rows.filter((r) => r.people >= minimum) : rows;
  return [...eligible].sort((a, b) => (b[by] || 0) - (a[by] || 0) || b.missing - a.missing);
}

/** The table as CSV text, with its settings in the file name, not the rows.
 *  Rows that also know the area's residents, as the where-they-live table
 *  does, get the group's share of them too. */
export function areaCsv(rows, label) {
  const quote = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const round = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '');
  const live = rows.some((r) => r.residents != null);
  const head = [label, 'people', 'missing', 'share_missing', 'minutes_short', 'mean_nzdep'];
  if (live) head.push('residents', 'share_of_residents');
  const lines = [head.join(',')];
  for (const r of rows) {
    const cells = [quote(r.name), round(r.people), round(r.missing), round(r.share, 3), round(r.minutesShort, 1), round(r.nzdep, 1)];
    if (live) cells.push(round(r.residents), round(r.ofResidents, 3));
    lines.push(cells.join(','));
  }
  return `${lines.join('\n')}\n`;
}
