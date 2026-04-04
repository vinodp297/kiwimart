// src/app/api/lists/regions/route.ts
// ─── Public API — NZ Regions with Coordinates ──────────────────────────────
// Dedicated route for region data with lat/lng for geocoding/maps.

import { getRegionsWithCoords } from "@/lib/dynamic-lists";
import { apiOk } from "@/app/api/v1/_helpers/response";

export async function GET() {
  const regions = await getRegionsWithCoords();
  return apiOk(regions);
}
