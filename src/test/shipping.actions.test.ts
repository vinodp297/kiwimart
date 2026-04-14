// src/test/shipping.actions.test.ts
// ─── Tests: shipping.ts (calculateShipping) ──────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// getConfigMany is mocked in setup.ts (getConfigMany returns new Map())
// We need it to return a map with the shipping config keys.
// Override locally to return sensible defaults.
import { getConfigMany } from "@/lib/platform-config";

const { calculateShipping } = await import("@/server/actions/shipping");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeConfigMap(
  overrides: Record<string, string> = {},
): Map<string, string> {
  return new Map<string, string>(
    Object.entries({
      "financial.shipping.same_region_cents": "600",
      "financial.shipping.same_island_cents": "800",
      "financial.shipping.inter_island_cents": "1200",
      "financial.shipping.rural_surcharge_cents": "400",
      ...overrides,
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP A — Input validation
// ─────────────────────────────────────────────────────────────────────────────

describe("calculateShipping — input validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getConfigMany).mockResolvedValue(makeConfigMap());
  });

  it("empty fromRegion → returns error", async () => {
    const result = await calculateShipping({
      fromRegion: "",
      toRegion: "Auckland",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/required/i);
  });

  it("empty toRegion → returns error", async () => {
    const result = await calculateShipping({
      fromRegion: "Wellington",
      toRegion: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/required/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP B — Same-region shipping
// ─────────────────────────────────────────────────────────────────────────────

describe("calculateShipping — same region", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getConfigMany).mockResolvedValue(makeConfigMap());
  });

  it("Auckland → Auckland → same region rate 600 cents, 1–2 days", async () => {
    const result = await calculateShipping({
      fromRegion: "Auckland",
      toRegion: "Auckland",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rateCents).toBe(600);
      expect(result.data.estimatedDays).toBe("1–2 business days");
      expect(result.data.isRural).toBe(false);
    }
  });

  it("Wellington → Wellington → same region rate 600 cents", async () => {
    const result = await calculateShipping({
      fromRegion: "Wellington",
      toRegion: "Wellington",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.rateCents).toBe(600);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP C — Same-island (North to North, South to South)
// ─────────────────────────────────────────────────────────────────────────────

describe("calculateShipping — same island", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getConfigMany).mockResolvedValue(makeConfigMap());
  });

  it("Auckland → Wellington (North→North) → 800 cents, 2–3 days", async () => {
    const result = await calculateShipping({
      fromRegion: "Auckland",
      toRegion: "Wellington",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rateCents).toBe(800);
      expect(result.data.estimatedDays).toBe("2–3 business days");
      expect(result.data.isRural).toBe(false);
    }
  });

  it("Canterbury → Otago (South→South) → 800 cents", async () => {
    const result = await calculateShipping({
      fromRegion: "Canterbury",
      toRegion: "Otago",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.rateCents).toBe(800);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP D — Inter-island (North to South, South to North)
// ─────────────────────────────────────────────────────────────────────────────

describe("calculateShipping — inter-island", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getConfigMany).mockResolvedValue(makeConfigMap());
  });

  it("Auckland → Canterbury (North→South) → 1200 cents, 3–5 days", async () => {
    const result = await calculateShipping({
      fromRegion: "Auckland",
      toRegion: "Canterbury",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rateCents).toBe(1200);
      expect(result.data.estimatedDays).toBe("3–5 business days");
    }
  });

  it("Otago → Wellington (South→North) → 1200 cents", async () => {
    const result = await calculateShipping({
      fromRegion: "Otago",
      toRegion: "Wellington",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.rateCents).toBe(1200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP E — Rural surcharge
// ─────────────────────────────────────────────────────────────────────────────

describe("calculateShipping — rural surcharge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getConfigMany).mockResolvedValue(makeConfigMap());
  });

  it("toRegion is Northland (rural) → adds 400 surcharge + isRural: true", async () => {
    const result = await calculateShipping({
      fromRegion: "Auckland",
      toRegion: "Northland",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // Northland is same island (North) → 800 + 400 rural = 1200
      expect(result.data.rateCents).toBe(1200);
      expect(result.data.isRural).toBe(true);
    }
  });

  it("toRegion is Southland (rural) → surcharge applied", async () => {
    const result = await calculateShipping({
      fromRegion: "Canterbury",
      toRegion: "Southland",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isRural).toBe(true);
      // Canterbury→Southland: same island + rural
      expect(result.data.rateCents).toBe(1200); // 800 + 400
    }
  });

  it("toRegion is West Coast (rural) → surcharge applied", async () => {
    const result = await calculateShipping({
      fromRegion: "Otago",
      toRegion: "West Coast",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isRural).toBe(true);
    }
  });

  it("toRegion is not rural → isRural: false, no surcharge", async () => {
    const result = await calculateShipping({
      fromRegion: "Auckland",
      toRegion: "Wellington",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isRural).toBe(false);
      expect(result.data.rateCents).toBe(800);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP F — Unknown regions fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("calculateShipping — unknown regions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getConfigMany).mockResolvedValue(makeConfigMap());
  });

  it("unknown fromRegion and toRegion → fallback rate (800 cents)", async () => {
    const result = await calculateShipping({
      fromRegion: "UnknownRegion",
      toRegion: "AnotherUnknown",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rateCents).toBe(800);
      expect(result.data.estimatedDays).toBe("2–4 business days");
    }
  });

  it("config values override defaults when provided", async () => {
    vi.mocked(getConfigMany).mockResolvedValue(
      makeConfigMap({ "financial.shipping.same_region_cents": "500" }),
    );

    const result = await calculateShipping({
      fromRegion: "Auckland",
      toRegion: "Auckland",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.rateCents).toBe(500);
  });
});
