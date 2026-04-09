// src/test/time-and-date.test.ts
// ─── Unit tests for src/lib/time.ts and src/lib/date.ts ──────────────────────

import { describe, it, expect } from "vitest";
import {
  MS_PER_SECOND,
  MS_PER_MINUTE,
  MS_PER_HOUR,
  MS_PER_DAY,
  MS_PER_WEEK,
  SECONDS_PER_MINUTE,
  SECONDS_PER_HOUR,
  SECONDS_PER_DAY,
  SECONDS_PER_WEEK,
} from "@/lib/time";
import { formatDateTimeNz, formatDateNz, relativeTime } from "@/lib/date";

// ── time.ts constants ─────────────────────────────────────────────────────────

describe("time constants", () => {
  it("MS_PER_SECOND equals 1 000", () => {
    expect(MS_PER_SECOND).toBe(1_000);
  });

  it("MS_PER_MINUTE equals 60 000", () => {
    expect(MS_PER_MINUTE).toBe(60_000);
  });

  it("MS_PER_HOUR equals 3 600 000", () => {
    expect(MS_PER_HOUR).toBe(3_600_000);
  });

  it("MS_PER_DAY equals 86 400 000", () => {
    expect(MS_PER_DAY).toBe(86_400_000);
  });

  it("MS_PER_WEEK equals 604 800 000", () => {
    expect(MS_PER_WEEK).toBe(604_800_000);
  });

  it("SECONDS_PER_MINUTE equals 60", () => {
    expect(SECONDS_PER_MINUTE).toBe(60);
  });

  it("SECONDS_PER_HOUR equals 3 600", () => {
    expect(SECONDS_PER_HOUR).toBe(3_600);
  });

  it("SECONDS_PER_DAY equals 86 400", () => {
    expect(SECONDS_PER_DAY).toBe(86_400);
  });

  it("SECONDS_PER_WEEK equals 604 800", () => {
    expect(SECONDS_PER_WEEK).toBe(604_800);
  });

  it("constants are internally consistent (week = 7 days)", () => {
    expect(MS_PER_WEEK).toBe(7 * MS_PER_DAY);
    expect(SECONDS_PER_WEEK).toBe(7 * SECONDS_PER_DAY);
  });
});

// ── date.ts formatters ────────────────────────────────────────────────────────

describe("formatDateTimeNz", () => {
  it("returns a non-empty string for a valid Date", () => {
    const result = formatDateTimeNz(new Date("2026-04-08T09:00:00Z"));
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("accepts a number (epoch ms)", () => {
    const result = formatDateTimeNz(Date.now());
    expect(typeof result).toBe("string");
  });

  it("accepts an ISO string", () => {
    const result = formatDateTimeNz("2026-01-01T00:00:00Z");
    expect(typeof result).toBe("string");
  });
});

describe("formatDateNz", () => {
  it("returns a non-empty string for a valid Date", () => {
    const result = formatDateNz(new Date("2026-04-08T09:00:00Z"));
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("does not include a time component", () => {
    const result = formatDateNz(new Date("2026-04-08T09:00:00Z"));
    // Time strings in en-NZ format contain "am"/"pm" or digits with a colon
    expect(result).not.toMatch(/\d:\d\d/);
  });
});

describe("relativeTime", () => {
  it("returns 'just now' for a date less than 1 minute ago", () => {
    const thirtySecondsAgo = new Date(Date.now() - 30_000);
    expect(relativeTime(thirtySecondsAgo)).toBe("just now");
  });

  it("returns minutes ago for a date 5 minutes ago", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * MS_PER_MINUTE);
    expect(relativeTime(fiveMinutesAgo)).toBe("5m ago");
  });

  it("returns hours ago for a date 3 hours ago", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * MS_PER_HOUR);
    expect(relativeTime(threeHoursAgo)).toBe("3h ago");
  });

  it("returns days ago for a date 2 days ago", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * MS_PER_DAY);
    expect(relativeTime(twoDaysAgo)).toBe("2d ago");
  });
});

// ── withDeprecation ───────────────────────────────────────────────────────────

describe("withDeprecation", () => {
  it("sets Deprecation and Sunset headers on the response", async () => {
    const { withDeprecation } = await import("@/app/api/_helpers/deprecation");
    const sunset = new Date("2026-07-07T00:00:00Z");
    const res = withDeprecation(new Response("ok"), sunset);
    expect(res.headers.get("Deprecation")).toBe("true");
    expect(res.headers.get("Sunset")).toBe(sunset.toUTCString());
  });

  it("sets the default Link header to /api/v1/", async () => {
    const { withDeprecation } = await import("@/app/api/_helpers/deprecation");
    const res = withDeprecation(new Response("ok"), new Date());
    expect(res.headers.get("Link")).toContain("/api/v1/");
  });

  it("uses the provided alternative in the Link header", async () => {
    const { withDeprecation } = await import("@/app/api/_helpers/deprecation");
    const res = withDeprecation(new Response("ok"), new Date(), "/api/v1/cart");
    expect(res.headers.get("Link")).toBe(
      '</api/v1/cart>; rel="successor-version"',
    );
  });
});
