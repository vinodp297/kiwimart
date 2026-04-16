// src/test/verification.documents.extra.test.ts
// ─── Supplementary Tests: Verification Documents ────────────────────────────
// Covers branches in verification.documents.ts that aren't exercised by the
// existing document-validation / seller-actions tests:
//   requestVerificationUpload    — MIME, size, rate limit, presign happy path
//   getVerificationDocumentUrl   — admin-only, key prefix check, audit log

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock requireUser / requireAdmin ───────────────────────────────────────────
const mockRequireUser = vi.fn();
const mockRequireAdmin = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));
vi.mock("@/server/lib/requireAdmin", () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

// ── Mock AWS S3 command constructors ─────────────────────────────────────────
vi.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: class {
    constructor(p: unknown) {
      Object.assign(this, p);
    }
  },
  PutObjectCommand: class {
    constructor(p: unknown) {
      Object.assign(this, p);
    }
  },
}));

// ── Mock fire-and-forget ─────────────────────────────────────────────────────
vi.mock("@/lib/fire-and-forget", () => ({
  fireAndForget: (p: Promise<unknown>) => {
    if (p && typeof (p as Promise<unknown>).catch === "function") {
      void (p as Promise<unknown>).catch(() => undefined);
    }
  },
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const { requestVerificationUpload, getVerificationDocumentUrl } =
  await import("@/server/actions/verification.documents");
const { rateLimit } = await import("@/server/lib/rateLimit");
const { audit } = await import("@/server/lib/audit");

// ── Test fixtures ─────────────────────────────────────────────────────────────
const TEST_USER = { id: "user_kyc", email: "k@test.com", isAdmin: false };
const ADMIN_GUARD = { userId: "user_admin", ok: true as const };

// ─────────────────────────────────────────────────────────────────────────────
// requestVerificationUpload
// ─────────────────────────────────────────────────────────────────────────────

describe("requestVerificationUpload", () => {
  const validInput = {
    fileName: "passport.jpg",
    contentType: "image/jpeg",
    sizeBytes: 500_000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    vi.mocked(rateLimit).mockResolvedValue({
      success: true,
      remaining: 9,
      reset: Date.now() + 60_000,
      retryAfter: 0,
    });
  });

  it("unauthenticated → returns safe fallback error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await requestVerificationUpload(validInput);

    expect(result.success).toBe(false);
  });

  it("invalid schema (missing contentType) → returns validation error", async () => {
    const result = await requestVerificationUpload({
      fileName: "x.jpg",
      sizeBytes: 1000,
    });

    expect(result.success).toBe(false);
  });

  it("disallowed MIME (image/gif) → rejected (Zod enum guard)", async () => {
    const result = await requestVerificationUpload({
      ...validInput,
      contentType: "image/gif",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      // Zod enum rejection surfaces an explanatory error
      expect(result.error).toBeTruthy();
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it("file over 10MB → returns File too large", async () => {
    const result = await requestVerificationUpload({
      ...validInput,
      sizeBytes: 11 * 1024 * 1024,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/file too large|10MB/i);
    }
  });

  it("rate limit exceeded → returns wait message", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 3600_000,
      retryAfter: 3600,
    });

    const result = await requestVerificationUpload(validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many uploads/i);
    }
  });

  it("happy path (jpeg) → returns scoped r2Key with .jpg extension", async () => {
    const result = await requestVerificationUpload(validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.r2Key).toMatch(
        /^verification\/user_kyc\/[0-9a-f-]+\.jpg$/,
      );
      expect(result.data.uploadUrl).toMatch(/^https?:\/\//);
    }
  });

  it("happy path (pdf) → returns key with .pdf extension", async () => {
    const result = await requestVerificationUpload({
      ...validInput,
      contentType: "application/pdf",
      fileName: "doc.pdf",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.r2Key).toMatch(/\.pdf$/);
    }
  });

  it("happy path (webp) → accepted with .webp extension", async () => {
    const result = await requestVerificationUpload({
      ...validInput,
      contentType: "image/webp",
      fileName: "selfie.webp",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.r2Key).toMatch(/\.webp$/);
    }
  });

  it("happy path (png) → uses png extension", async () => {
    const result = await requestVerificationUpload({
      ...validInput,
      contentType: "image/png",
      fileName: "id.png",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.r2Key).toMatch(/\.png$/);
    }
  });

  it("scopes r2Key to authenticated user id", async () => {
    mockRequireUser.mockResolvedValueOnce({
      ...TEST_USER,
      id: "user_other_kyc",
    });

    const result = await requestVerificationUpload(validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.r2Key).toMatch(/^verification\/user_other_kyc\//);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getVerificationDocumentUrl
// ─────────────────────────────────────────────────────────────────────────────

describe("getVerificationDocumentUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdmin.mockResolvedValue(ADMIN_GUARD);
  });

  it("non-admin → returns guard error", async () => {
    mockRequireAdmin.mockResolvedValueOnce({ error: "Admin access required." });

    const result = await getVerificationDocumentUrl(
      "verification/user_kyc/doc.jpg",
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/admin/i);
    }
  });

  it("key not starting with verification/ → returns Invalid document key", async () => {
    const result = await getVerificationDocumentUrl("listings/user_x/1.webp");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/invalid document key/i);
    }
  });

  it("happy path → returns signed url", async () => {
    const result = await getVerificationDocumentUrl(
      "verification/user_kyc/doc.jpg",
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toMatch(/^https?:\/\//);
    }
  });

  it("happy path → writes audit log with admin user id and key", async () => {
    await getVerificationDocumentUrl("verification/user_kyc/doc.jpg");

    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ADMIN_GUARD.userId,
        action: "VERIFICATION_DOCUMENT_VIEWED",
        entityType: "VerificationApplication",
        metadata: expect.objectContaining({
          r2Key: "verification/user_kyc/doc.jpg",
        }),
      }),
    );
  });

  it("requireAdmin throws → returns safe fallback error", async () => {
    mockRequireAdmin.mockRejectedValueOnce(new Error("DB offline"));

    const result = await getVerificationDocumentUrl(
      "verification/user_kyc/doc.jpg",
    );

    expect(result.success).toBe(false);
  });

  it("does not leak raw error messages (safeActionError fallback)", async () => {
    mockRequireAdmin.mockRejectedValueOnce(
      new Error("ECONNREFUSED 127.0.0.1:5432"),
    );

    const result = await getVerificationDocumentUrl(
      "verification/user_kyc/doc.jpg",
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).not.toMatch(/ECONNREFUSED|127\.0\.0\.1/);
    }
  });
});
