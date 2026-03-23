'use server';
// src/server/actions/shipping.ts
// ─── NZ Post Shipping Rate Calculator ───────────────────────────────────────
// Flat-rate estimates based on NZ region routing.
// Rates are approximate and based on standard NZ Post parcel rates.

import type { ActionResult } from '@/types';

// Island classification
const NORTH_ISLAND = new Set([
  'Auckland', 'Waikato', 'Bay of Plenty', 'Northland',
  "Hawke's Bay", 'Manawatū-Whanganui', 'Taranaki', 'Gisborne', 'Wellington',
]);

const SOUTH_ISLAND = new Set([
  'Canterbury', 'Otago', 'Southland', 'Tasman', 'Nelson',
  'Marlborough', 'West Coast',
]);

// Rural regions attract a surcharge
const RURAL_REGIONS = new Set([
  'Northland', 'Gisborne', 'West Coast', 'Southland', 'Taranaki',
]);

const SAME_REGION_RATE = 600;      // $6.00
const SAME_ISLAND_RATE = 800;      // $8.00
const INTER_ISLAND_RATE = 1200;    // $12.00
const RURAL_SURCHARGE = 400;       // $4.00

export async function calculateShipping(params: {
  fromRegion: string;
  toRegion: string;
}): Promise<ActionResult<{ rateCents: number; estimatedDays: string; isRural: boolean }>> {
  const { fromRegion, toRegion } = params;

  if (!fromRegion || !toRegion) {
    return { success: false, error: 'Both regions are required.' };
  }

  let baseCents: number;
  let estimatedDays: string;

  if (fromRegion === toRegion) {
    baseCents = SAME_REGION_RATE;
    estimatedDays = '1–2 business days';
  } else {
    const fromNorth = NORTH_ISLAND.has(fromRegion);
    const fromSouth = SOUTH_ISLAND.has(fromRegion);
    const toNorth = NORTH_ISLAND.has(toRegion);
    const toSouth = SOUTH_ISLAND.has(toRegion);

    if ((fromNorth && toNorth) || (fromSouth && toSouth)) {
      baseCents = SAME_ISLAND_RATE;
      estimatedDays = '2–3 business days';
    } else if ((fromNorth && toSouth) || (fromSouth && toNorth)) {
      baseCents = INTER_ISLAND_RATE;
      estimatedDays = '3–5 business days';
    } else {
      // Fallback for unknown regions
      baseCents = SAME_ISLAND_RATE;
      estimatedDays = '2–4 business days';
    }
  }

  const isRural = RURAL_REGIONS.has(toRegion);
  if (isRural) {
    baseCents += RURAL_SURCHARGE;
  }

  return {
    success: true,
    data: {
      rateCents: baseCents,
      estimatedDays,
      isRural,
    },
  };
}
