// src/lib/geocoding.ts
// ─── NZ Geocoding — Nominatim + static region centers ──────────────────────

/** Pre-computed NZ region center coordinates (WGS-84) */
export const NZ_REGION_CENTERS: Record<string, { lat: number; lng: number }> = {
  'Auckland':           { lat: -36.8485, lng: 174.7633 },
  'Wellington':         { lat: -41.2865, lng: 174.7762 },
  'Canterbury':         { lat: -43.5321, lng: 172.6362 },
  'Waikato':            { lat: -37.7870, lng: 175.2793 },
  'Bay of Plenty':      { lat: -37.6878, lng: 176.1651 },
  'Otago':              { lat: -45.8788, lng: 170.5028 },
  "Hawke's Bay":        { lat: -39.4928, lng: 176.9120 },
  'Manawatū-Whanganui': { lat: -39.9307, lng: 175.0597 },
  'Northland':          { lat: -35.7275, lng: 174.3166 },
  'Tasman':             { lat: -41.2706, lng: 172.9081 },
  'Nelson':             { lat: -41.2706, lng: 173.2840 },
  'Marlborough':        { lat: -41.5134, lng: 173.9612 },
  'Southland':          { lat: -46.4132, lng: 168.3538 },
  'Taranaki':           { lat: -39.0556, lng: 174.0752 },
  'Gisborne':           { lat: -38.6623, lng: 178.0176 },
  'West Coast':         { lat: -42.4504, lng: 171.2108 },
}

/**
 * Haversine distance in kilometres between two WGS-84 points.
 */
export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371 // Earth radius in km
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}
