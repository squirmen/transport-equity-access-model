// Which urban area a visitor is in.

/** The urban area a point is in, or the nearest one within 50 km. */
export function nearestCity(cities, lon, lat) {
  const km = (a, b) => {
    const rad = Math.PI / 180;
    const x = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) / 2) * rad);
    const y = (b[1] - a[1]) * rad;
    return 6371 * Math.hypot(x, y);
  };
  let best = null;
  for (const city of cities) {
    if (!city.bbox) continue;
    const [w, s, e, n] = city.bbox;
    const inside = lon >= w && lon <= e && lat >= s && lat <= n;
    const edge = [Math.min(Math.max(lon, w), e), Math.min(Math.max(lat, s), n)];
    const distance = inside ? 0 : km([lon, lat], edge);
    if (!best || distance < best.distance) best = { city, distance };
  }
  return best && best.distance <= 50 ? best.city : null;
}
