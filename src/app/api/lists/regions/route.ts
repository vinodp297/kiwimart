// src/app/api/lists/regions/route.ts
// ─── Public API — NZ Regions with Coordinates ──────────────────────────────
// Dedicated route for region data with lat/lng for geocoding/maps.

import { getRegionsWithCoords } from "@/lib/dynamic-lists";
import { apiOk } from "@/app/api/v1/_helpers/response";
import { MS_PER_DAY } from "@/lib/time";

export async function GET() {
  const regions = await getRegionsWithCoords();
  const response = apiOk(regions);
  response.headers.set(
    "Cache-Control",
    "public, s-maxage=86400, stale-while-revalidate=604800",
  );
  response.headers.set("Deprecation", "true");
  response.headers.set(
    "Sunset",
    new Date(Date.now() + 90 * MS_PER_DAY).toUTCString(),
  );
  response.headers.set("Link", '</api/v1/>; rel="successor-version"');
  return response;
}
