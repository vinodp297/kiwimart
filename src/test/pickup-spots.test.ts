// src/test/pickup-spots.test.ts
// ─── Tests for OI-007: Safe Pickup Spots ────────────────────────────────────

import { describe, it, expect, vi } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// Mock React hooks so client components can be imported in Node test env
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: vi.fn((init: unknown) => [init, vi.fn()]),
    useEffect: vi.fn(),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Static data — pickup-spots.ts
// ─────────────────────────────────────────────────────────────────────────────

describe("OI-007 — PICKUP_SPOTS static data", () => {
  it("PICKUP_SPOTS is a non-empty array", async () => {
    const { PICKUP_SPOTS } = await import("@/lib/pickup-spots");
    expect(Array.isArray(PICKUP_SPOTS)).toBe(true);
    expect(PICKUP_SPOTS.length).toBeGreaterThan(0);
  });

  it("every spot has required fields: id, name, address, region, suburb, type", async () => {
    const { PICKUP_SPOTS } = await import("@/lib/pickup-spots");
    for (const spot of PICKUP_SPOTS) {
      expect(spot.id).toBeTruthy();
      expect(spot.name).toBeTruthy();
      expect(spot.address).toBeTruthy();
      expect(spot.region).toBeTruthy();
      expect(spot.suburb).toBeTruthy();
      expect(spot.type).toBeTruthy();
    }
  });

  it("spot ids are unique", async () => {
    const { PICKUP_SPOTS } = await import("@/lib/pickup-spots");
    const ids = PICKUP_SPOTS.map((s) => s.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("has at least 4 Auckland spots", async () => {
    const { PICKUP_SPOTS } = await import("@/lib/pickup-spots");
    const aucklandSpots = PICKUP_SPOTS.filter((s) => s.region === "Auckland");
    expect(aucklandSpots.length).toBeGreaterThanOrEqual(4);
  });

  it("has at least 3 Wellington spots", async () => {
    const { PICKUP_SPOTS } = await import("@/lib/pickup-spots");
    const wellingtonSpots = PICKUP_SPOTS.filter(
      (s) => s.region === "Wellington",
    );
    expect(wellingtonSpots.length).toBeGreaterThanOrEqual(3);
  });

  it("has at least 3 Canterbury spots", async () => {
    const { PICKUP_SPOTS } = await import("@/lib/pickup-spots");
    const canterburySpots = PICKUP_SPOTS.filter(
      (s) => s.region === "Canterbury",
    );
    expect(canterburySpots.length).toBeGreaterThanOrEqual(3);
  });

  it("covers all 16 NZ regions", async () => {
    const { PICKUP_SPOTS } = await import("@/lib/pickup-spots");
    const coveredRegions = new Set(PICKUP_SPOTS.map((s) => s.region));
    const expectedRegions = [
      "Auckland",
      "Wellington",
      "Canterbury",
      "Waikato",
      "Bay of Plenty",
      "Otago",
      "Hawke's Bay",
      "Manawatū-Whanganui",
      "Northland",
      "Tasman",
      "Nelson",
      "Marlborough",
      "Southland",
      "Taranaki",
      "Gisborne",
      "West Coast",
    ];
    for (const region of expectedRegions) {
      expect(coveredRegions.has(region as import("@/types").NZRegion)).toBe(
        true,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getSpotsForRegion
// ─────────────────────────────────────────────────────────────────────────────

describe("OI-007 — getSpotsForRegion", () => {
  it("returns spots for a known region", async () => {
    const { getSpotsForRegion } = await import("@/lib/pickup-spots");
    const spots = getSpotsForRegion("Auckland");
    expect(spots.length).toBeGreaterThan(0);
    expect(spots.every((s) => s.region === "Auckland")).toBe(true);
  });

  it("respects the maxSpots limit (default 4)", async () => {
    const { getSpotsForRegion } = await import("@/lib/pickup-spots");
    const spots = getSpotsForRegion("Auckland");
    expect(spots.length).toBeLessThanOrEqual(4);
  });

  it("respects a custom maxSpots value", async () => {
    const { getSpotsForRegion } = await import("@/lib/pickup-spots");
    const spots = getSpotsForRegion("Auckland", 2);
    expect(spots.length).toBeLessThanOrEqual(2);
  });

  it("returns empty array for an unknown region", async () => {
    const { getSpotsForRegion } = await import("@/lib/pickup-spots");
    const spots = getSpotsForRegion("Atlantis");
    expect(spots).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildMapsUrl
// ─────────────────────────────────────────────────────────────────────────────

describe("OI-007 — buildMapsUrl", () => {
  it("builds a valid Google Maps search URL", async () => {
    const { buildMapsUrl } = await import("@/lib/pickup-spots");
    const url = buildMapsUrl("36 Cook Street, Auckland CBD, Auckland 1010");
    expect(url).toContain("https://www.google.com/maps/search/");
    expect(url).toContain("api=1");
    expect(url).toContain("query=");
  });

  it("URL-encodes the address (spaces become %20 or +)", async () => {
    const { buildMapsUrl } = await import("@/lib/pickup-spots");
    const url = buildMapsUrl("36 Cook Street");
    // encodeURIComponent encodes spaces as %20
    expect(url).not.toContain(" ");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SafePickupCard component
// ─────────────────────────────────────────────────────────────────────────────

describe("OI-007 — SafePickupCard component", () => {
  it("component is exported and is a function", async () => {
    const mod = await import("@/components/listings/SafePickupCard");
    expect(mod.SafePickupCard).toBeDefined();
    expect(typeof mod.SafePickupCard).toBe("function");
  });
});
