// src/test/data-export.test.ts
// ─── Tests: PII Data Export — R2 upload + signed URL flow ────────────────────
// Covers:
//   1. Export uploads JSON to R2 with correct key format (exports/{userId}/...)
//   2. Export generates signed URL with 24-hour TTL (expiresIn: 86400)
//   3. Email is sent with downloadUrl — not the raw JSON export data
//   4. Email payload does NOT contain jsonPayload under any key
//   5. R2 upload failure causes the export to fail with an error
//   6. Signed URL contains the userId in the R2 key path
//   cleanupExportFiles:
//   7. Deletes R2 objects under exports/ prefix older than 24 hours
//   8. Returns errors: 1 when R2 throws

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

vi.mock("@/infrastructure/redis/client", () => ({
  getRedisClient: () => ({
    get: vi.fn().mockResolvedValue(null), // no rate limit
    set: vi.fn().mockResolvedValue("OK"),
    ping: vi.fn().mockResolvedValue("PONG"),
  }),
}));

// ── Imports ───────────────────────────────────────────────────────────────────
import db from "@/lib/db";
import { r2 } from "@/infrastructure/storage/r2";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { enqueueEmail } from "@/lib/email-queue";
import {
  exportUserData,
  EXPORT_URL_TTL_SECONDS,
} from "@/modules/users/export.service";
import { cleanupExportFiles } from "@/server/jobs/cleanupExportFiles";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = "user-export-test-1";
const USER_EMAIL = "export@buyzi.test";

const MOCK_PROFILE = {
  id: USER_ID,
  email: USER_EMAIL,
  username: "exportuser",
  displayName: "Export User",
  bio: null,
  phone: null,
  isPhoneVerified: false,
  region: "Wellington",
  suburb: null,
  dateOfBirth: null,
  idVerified: false,
  nzbn: null,
  gstNumber: null,
  isSellerEnabled: false,
  hasMarketingConsent: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const SIGNED_URL =
  "https://test-bucket.r2.example.com/exports/user-export-test-1/signed?X-Amz-Signature=abc";

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupDefaultMocks() {
  vi.mocked(db.user.findUnique).mockResolvedValue(MOCK_PROFILE as never);
  vi.mocked(db.order.findMany).mockResolvedValue([]);
  vi.mocked(db.message.findMany).mockResolvedValue([]);
  vi.mocked(db.review.findMany).mockResolvedValue([]);
  vi.mocked(db.listing.findMany).mockResolvedValue([]);
  vi.mocked(db.offer.findMany).mockResolvedValue([]);
  vi.mocked(db.watchlistItem.findMany).mockResolvedValue([]);

  vi.mocked(r2.send).mockResolvedValue({} as never);
  vi.mocked(getSignedUrl).mockResolvedValue(SIGNED_URL);
  vi.mocked(enqueueEmail).mockResolvedValue(undefined);
}

// ─────────────────────────────────────────────────────────────────────────────

describe("exportUserData — R2 upload + signed URL flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  // Test 1: R2 upload with correct key format
  it("uploads the JSON export to R2 under exports/{userId}/... prefix", async () => {
    await exportUserData(USER_ID, USER_EMAIL);

    // r2.send should have been called at least once with a PutObjectCommand
    const calls = vi.mocked(r2.send).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);

    // Find the PutObject call — its input has a Key field
    const putCall = calls.find((call) => {
      const input = (call[0] as { input?: { Key?: string } }).input;
      return input?.Key?.startsWith("exports/");
    });
    expect(putCall).toBeDefined();

    const putInput = (
      putCall![0] as { input: { Key: string; ContentType: string } }
    ).input;
    expect(putInput.Key).toMatch(new RegExp(`^exports/${USER_ID}/`));
    expect(putInput.Key).toMatch(/-data-export\.json$/);
    expect(putInput.ContentType).toBe("application/json");
  });

  // Test 2: signed URL with 24-hour TTL
  it("generates a signed GET URL with the correct 24-hour TTL", async () => {
    await exportUserData(USER_ID, USER_EMAIL);

    expect(getSignedUrl).toHaveBeenCalledWith(
      r2,
      expect.anything(), // GetObjectCommand instance
      expect.objectContaining({ expiresIn: EXPORT_URL_TTL_SECONDS }),
    );
    // TTL must be exactly 24 hours (86 400 s)
    expect(EXPORT_URL_TTL_SECONDS).toBe(86_400);
  });

  // Test 3: email sent with URL, not JSON data
  it("emails the user the download URL, not the raw JSON data", async () => {
    await exportUserData(USER_ID, USER_EMAIL);

    expect(enqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        template: "dataExport",
        to: USER_EMAIL,
        downloadUrl: SIGNED_URL,
        expiresAt: expect.any(String),
      }),
    );
  });

  // Test 4: JSON payload must NEVER appear in the email job
  it("does NOT include jsonPayload in the email job data", async () => {
    await exportUserData(USER_ID, USER_EMAIL);

    const emailCall = vi.mocked(enqueueEmail).mock.calls[0]![0]!;

    // No JSON data in the payload — only the signed URL
    expect(emailCall).not.toHaveProperty("jsonPayload");

    // The downloadUrl must be the signed URL returned by getSignedUrl
    const call = emailCall as Record<string, unknown>;
    expect(call.downloadUrl).toBe(SIGNED_URL);
  });

  // Test 5: R2 upload failure → graceful error
  it("propagates an error and does not send an email if the R2 upload fails", async () => {
    vi.mocked(r2.send).mockRejectedValueOnce(new Error("R2 unavailable"));

    await expect(exportUserData(USER_ID, USER_EMAIL)).rejects.toThrow(
      "R2 unavailable",
    );

    // Email must NOT be sent when the upload fails
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  // Test 6: signed URL contains userId in the key path
  it("includes the userId in the R2 key so exports are namespaced per user", async () => {
    await exportUserData(USER_ID, USER_EMAIL);

    const calls = vi.mocked(r2.send).mock.calls;
    const putCall = calls.find((call) => {
      const input = (call[0] as { input?: { Key?: string } }).input;
      return input?.Key?.startsWith("exports/");
    });

    const key = (putCall![0] as { input: { Key: string } }).input.Key;
    expect(key).toContain(USER_ID);

    // Verify getSignedUrl was called with a command targeting the same key
    const signArgs = vi.mocked(getSignedUrl).mock.calls[0]!;
    // The GetObjectCommand input has a Key field matching the upload key
    const getInput = (signArgs[1] as { input: { Key: string } }).input;
    expect(getInput.Key).toBe(key);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("cleanupExportFiles — R2 stale file removal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 7: deletes stale export files
  it("deletes R2 objects under exports/ that are older than 24 hours", async () => {
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 h ago
    const freshDate = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1 h ago

    vi.mocked(r2.send)
      .mockResolvedValueOnce({
        // ListObjectsV2 response
        Contents: [
          {
            Key: "exports/user-1/old-data-export.json",
            LastModified: staleDate,
          },
          {
            Key: "exports/user-2/recent-data-export.json",
            LastModified: freshDate,
          },
        ],
      } as never)
      .mockResolvedValue({} as never); // DeleteObject calls

    const result = await cleanupExportFiles();

    expect(result.deleted).toBe(1);
    expect(result.errors).toBe(0);

    // Only the stale file should have been deleted
    const deleteCalls = vi.mocked(r2.send).mock.calls.slice(1); // skip ListObjects
    expect(deleteCalls).toHaveLength(1);
    const deleteInput = (deleteCalls[0]![0] as { input: { Key: string } })
      .input;
    expect(deleteInput.Key).toBe("exports/user-1/old-data-export.json");
  });

  // Test 8: error handling
  it("returns errors: 1 and deleted: 0 when R2 list throws", async () => {
    vi.mocked(r2.send).mockRejectedValueOnce(new Error("R2 list failed"));

    const result = await cleanupExportFiles();

    expect(result.deleted).toBe(0);
    expect(result.errors).toBe(1);
  });
});
