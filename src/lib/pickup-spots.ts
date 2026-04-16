// src/lib/pickup-spots.ts
// ─── Safe Pickup Spots — OI-007 ───────────────────────────────────────────────
// Static curated list of safe, public meeting points across all 16 NZ regions.
// No external API, no database. Addresses are Google Maps-searchable.

import type { NZRegion } from "@/types";

export type SpotType = "police" | "library" | "council" | "mall" | "public";

export interface PickupSpot {
  id: string;
  name: string;
  address: string;
  region: NZRegion;
  suburb: string;
  type: SpotType;
}

export const SPOT_TYPE_LABELS: Record<SpotType, string> = {
  police: "Police Station",
  library: "Public Library",
  council: "Council Building",
  mall: "Shopping Centre",
  public: "Public Space",
};

// ── Curated spots — at least 4 Auckland, 3 Wellington, 3 Canterbury, 1 per remaining region ──

export const PICKUP_SPOTS: PickupSpot[] = [
  // ── Auckland (4) ────────────────────────────────────────────────────────────
  {
    id: "akl-01",
    name: "Auckland Central Police Station",
    address: "36 Cook Street, Auckland CBD, Auckland 1010",
    region: "Auckland",
    suburb: "Auckland CBD",
    type: "police",
  },
  {
    id: "akl-02",
    name: "Auckland Central City Library",
    address: "44-46 Lorne Street, Auckland CBD, Auckland 1010",
    region: "Auckland",
    suburb: "Auckland CBD",
    type: "library",
  },
  {
    id: "akl-03",
    name: "Westfield St Lukes",
    address: "80 St Lukes Road, Mount Albert, Auckland 1025",
    region: "Auckland",
    suburb: "Mount Albert",
    type: "mall",
  },
  {
    id: "akl-04",
    name: "Manukau Police Station",
    address: "Manukau Station Road, Manukau, Auckland 2104",
    region: "Auckland",
    suburb: "Manukau",
    type: "police",
  },

  // ── Wellington (3) ──────────────────────────────────────────────────────────
  {
    id: "wlg-01",
    name: "Wellington Central Police Station",
    address: "41 Victoria Street, Te Aro, Wellington 6011",
    region: "Wellington",
    suburb: "Te Aro",
    type: "police",
  },
  {
    id: "wlg-02",
    name: "Wellington Central Library",
    address: "65 Victoria Street, Te Aro, Wellington 6011",
    region: "Wellington",
    suburb: "Te Aro",
    type: "library",
  },
  {
    id: "wlg-03",
    name: "Westfield Queensgate",
    address: "Queens Drive, Lower Hutt, Wellington 5010",
    region: "Wellington",
    suburb: "Lower Hutt",
    type: "mall",
  },

  // ── Canterbury (3) ──────────────────────────────────────────────────────────
  {
    id: "can-01",
    name: "Christchurch Central Police Station",
    address: "40 Lichfield Street, Christchurch Central, Christchurch 8011",
    region: "Canterbury",
    suburb: "Christchurch Central",
    type: "police",
  },
  {
    id: "can-02",
    name: "Tūranga — Christchurch Central Library",
    address: "60 Cathedral Square, Christchurch Central, Christchurch 8011",
    region: "Canterbury",
    suburb: "Christchurch Central",
    type: "library",
  },
  {
    id: "can-03",
    name: "Westfield Riccarton",
    address: "129 Riccarton Road, Riccarton, Christchurch 8041",
    region: "Canterbury",
    suburb: "Riccarton",
    type: "mall",
  },

  // ── Waikato ─────────────────────────────────────────────────────────────────
  {
    id: "wkt-01",
    name: "Hamilton Central Police Station",
    address: "10 Tainui Street, Hamilton CBD, Hamilton 3204",
    region: "Waikato",
    suburb: "Hamilton CBD",
    type: "police",
  },

  // ── Bay of Plenty ───────────────────────────────────────────────────────────
  {
    id: "bop-01",
    name: "Tauranga Police Station",
    address: "75 McLean Street, Tauranga CBD, Tauranga 3110",
    region: "Bay of Plenty",
    suburb: "Tauranga CBD",
    type: "police",
  },

  // ── Otago ────────────────────────────────────────────────────────────────────
  {
    id: "otg-01",
    name: "Dunedin Central Police Station",
    address: "25 Great King Street, Dunedin Central, Dunedin 9016",
    region: "Otago",
    suburb: "Dunedin Central",
    type: "police",
  },

  // ── Hawke's Bay ─────────────────────────────────────────────────────────────
  {
    id: "hkb-01",
    name: "Napier Police Station",
    address: "6 Coote Road, Napier South, Napier 4110",
    region: "Hawke's Bay",
    suburb: "Napier South",
    type: "police",
  },

  // ── Manawatū-Whanganui ──────────────────────────────────────────────────────
  {
    id: "mwg-01",
    name: "Palmerston North Police Station",
    address: "355 Main Street, Palmerston North 4410",
    region: "Manawatū-Whanganui",
    suburb: "Palmerston North",
    type: "police",
  },

  // ── Northland ───────────────────────────────────────────────────────────────
  {
    id: "nld-01",
    name: "Whangarei Police Station",
    address: "9 Robert Street, Whangarei 0110",
    region: "Northland",
    suburb: "Whangarei",
    type: "police",
  },

  // ── Tasman ──────────────────────────────────────────────────────────────────
  {
    id: "tsm-01",
    name: "Richmond Police Station",
    address: "3 Champion Road, Richmond, Tasman 7020",
    region: "Tasman",
    suburb: "Richmond",
    type: "police",
  },

  // ── Nelson ──────────────────────────────────────────────────────────────────
  {
    id: "nel-01",
    name: "Nelson Police Station",
    address: "33 Trafalgar Street, Nelson CBD, Nelson 7010",
    region: "Nelson",
    suburb: "Nelson CBD",
    type: "police",
  },

  // ── Marlborough ─────────────────────────────────────────────────────────────
  {
    id: "mlb-01",
    name: "Blenheim Police Station",
    address: "42 Alfred Street, Blenheim 7201",
    region: "Marlborough",
    suburb: "Blenheim",
    type: "police",
  },

  // ── Southland ───────────────────────────────────────────────────────────────
  {
    id: "stl-01",
    name: "Invercargill Police Station",
    address: "31 Don Street, Invercargill CBD, Invercargill 9810",
    region: "Southland",
    suburb: "Invercargill CBD",
    type: "police",
  },

  // ── Taranaki ────────────────────────────────────────────────────────────────
  {
    id: "trk-01",
    name: "New Plymouth Police Station",
    address: "69 Leach Street, New Plymouth 4310",
    region: "Taranaki",
    suburb: "New Plymouth",
    type: "police",
  },

  // ── Gisborne ────────────────────────────────────────────────────────────────
  {
    id: "gsb-01",
    name: "Gisborne Police Station",
    address: "Carbon Street, Gisborne CBD, Gisborne 4010",
    region: "Gisborne",
    suburb: "Gisborne CBD",
    type: "police",
  },

  // ── West Coast ──────────────────────────────────────────────────────────────
  {
    id: "wct-01",
    name: "Greymouth Police Station",
    address: "12 Tainui Street, Greymouth 7805",
    region: "West Coast",
    suburb: "Greymouth",
    type: "police",
  },
];

/**
 * Returns up to `maxSpots` safe pickup spots for the given NZ region.
 */
export function getSpotsForRegion(region: string, maxSpots = 4): PickupSpot[] {
  return PICKUP_SPOTS.filter((spot) => spot.region === region).slice(
    0,
    maxSpots,
  );
}

/**
 * Builds a Google Maps search URL for a given address.
 * No API key required — uses the public search endpoint.
 */
export function buildMapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
