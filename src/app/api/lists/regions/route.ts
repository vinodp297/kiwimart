// src/app/api/lists/regions/route.ts
// ─── Public API — NZ Regions with Coordinates ──────────────────────────────
// Dedicated route for region data with lat/lng for geocoding/maps.

import { NextResponse } from "next/server";
import { getRegionsWithCoords } from "@/lib/dynamic-lists";

export async function GET() {
  const regions = await getRegionsWithCoords();
  return NextResponse.json(regions);
}
