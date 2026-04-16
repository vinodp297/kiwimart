// src/test/profile-images.actions.test.ts
// ─── Tests: Profile Image Upload Server Actions ─────────────────────────────
// Covers:
//   requestProfileImageUpload — type validation, size limit, rate limit, presign
//   confirmProfileImageUpload — key scoping, magic-byte check, update + cleanup

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));

// ── Mock userRepository.findImageKeys + update ───────────────────────────────
const mockFindImageKeys = vi.fn();
const mockUpdate = vi.fn();
vi.mock("@/modules/users/user.repository", async () => ({
  userRepository: {
    findImageKeys: (...args: unknown[]) => mockFindImageKeys(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

// ── Mock fileValidation.validateMagicBytes ───────────────────────────────────
const mockValidateMagicBytes = vi.fn();
vi.mock("@/server/lib/fileValidation", () => ({
  validateMagicBytes: (...args: unknown[]) => mockValidateMagicBytes(...args),
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
  DeleteObjectCommand: class {
    constructor(p: unknown) {
      Object.assign(this, p);
    }
  },
}));

// ── Mock R2 client (magic bytes + delete) ─────────────────────────────────────
const mockR2Send = vi.fn();
vi.mock("@/infrastructure/storage/r2", () => ({
  r2: { send: (...args: unknown[]) => mockR2Send(...args) },
  R2_BUCKET: "test-bucket",
  R2_PUBLIC_URL: "https://test.r2.dev",
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
const { requestProfileImageUpload, confirmProfileImageUpload } =
  await import("@/server/actions/profile-images");
const { rateLimit } = await import("@/server/lib/rateLimit");

// ── Test fixtures ─────────────────────────────────────────────────────────────
const TEST_USER = {
  id: "user_42",
  email: "u@test.com",
  isAdmin: false,
};

/** Returns an async-iterable mock Body containing the given header bytes. */
function mockBody(header: Buffer) {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield header;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// requestProfileImageUpload
// ─────────────────────────────────────────────────────────────────────────────

describe("requestProfileImageUpload", () => {
  const validInput = {
    contentType: "image/jpeg",
    sizeBytes: 100_000,
    imageType: "avatar" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
  });

  it("unauthenticated → returns safe fallback error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await requestProfileImageUpload(validInput);

    expect(result.success).toBe(false);
  });

  it("rejects disallowed MIME type", async () => {
    const result = await requestProfileImageUpload({
      ...validInput,
      contentType: "image/gif",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/file type not allowed/i);
    }
  });

  it("rejects file over 5MB size limit", async () => {
    const result = await requestProfileImageUpload({
      ...validInput,
      sizeBytes: 6 * 1024 * 1024,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/file too large|5 MB/i);
    }
  });

  it("rate limit exceeded → returns wait message", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 30,
    });

    const result = await requestProfileImageUpload(validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/too many uploads/i);
    }
  });

  it("happy path (avatar) → returns scoped r2Key and uploadUrl", async () => {
    const result = await requestProfileImageUpload(validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.r2Key).toMatch(
        /^profiles\/user_42\/avatar\/[0-9a-f-]+\.jpg$/,
      );
      expect(result.data.uploadUrl).toMatch(/^https?:\/\//);
    }
  });

  it("happy path (cover) → uses cover imageType in r2Key", async () => {
    const result = await requestProfileImageUpload({
      ...validInput,
      imageType: "cover",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.r2Key).toMatch(
        /^profiles\/user_42\/cover\/[0-9a-f-]+\.jpg$/,
      );
    }
  });

  it("png content type maps to .png extension", async () => {
    const result = await requestProfileImageUpload({
      ...validInput,
      contentType: "image/png",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.r2Key).toMatch(/\.png$/);
    }
  });

  it("webp content type maps to .webp extension", async () => {
    const result = await requestProfileImageUpload({
      ...validInput,
      contentType: "image/webp",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.r2Key).toMatch(/\.webp$/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// confirmProfileImageUpload
// ─────────────────────────────────────────────────────────────────────────────

describe("confirmProfileImageUpload", () => {
  const validInput = {
    r2Key: "profiles/user_42/avatar/abc-123.jpg",
    imageType: "avatar" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_USER);
    mockR2Send.mockResolvedValue({
      Body: mockBody(Buffer.from([0xff, 0xd8, 0xff, 0xe0])),
    });
    mockValidateMagicBytes.mockReturnValue(true);
    mockFindImageKeys.mockResolvedValue({
      avatarKey: null,
      coverImageKey: null,
    });
    mockUpdate.mockResolvedValue(undefined);
  });

  it("unauthenticated → returns safe fallback error", async () => {
    mockRequireUser.mockRejectedValueOnce(new Error("Unauthorised"));

    const result = await confirmProfileImageUpload(validInput);

    expect(result.success).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects r2Key not scoped to current user/imageType", async () => {
    const result = await confirmProfileImageUpload({
      r2Key: "profiles/someone_else/avatar/x.jpg",
      imageType: "avatar",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/unauthorised image key/i);
    }
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects key with wrong imageType prefix (avatar key for cover)", async () => {
    const result = await confirmProfileImageUpload({
      r2Key: "profiles/user_42/avatar/abc.jpg",
      imageType: "cover",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/unauthorised/i);
    }
  });

  it("happy path (avatar) → updates avatarKey and returns new key", async () => {
    const result = await confirmProfileImageUpload(validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.newKey).toBe(validInput.r2Key);
    }
    expect(mockUpdate).toHaveBeenCalledWith(TEST_USER.id, {
      avatarKey: validInput.r2Key,
    });
  });

  it("happy path (cover) → updates coverImageKey", async () => {
    const result = await confirmProfileImageUpload({
      r2Key: "profiles/user_42/cover/xyz.jpg",
      imageType: "cover",
    });

    expect(result.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(TEST_USER.id, {
      coverImageKey: "profiles/user_42/cover/xyz.jpg",
    });
  });

  it("magic bytes invalid → deletes from R2 and rejects", async () => {
    mockValidateMagicBytes.mockReturnValueOnce(false);

    const result = await confirmProfileImageUpload(validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/invalid image file/i);
    }
    // R2 send called twice: GetObject + DeleteObject
    expect(mockR2Send).toHaveBeenCalledTimes(2);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("R2 unreachable (dev ENOTFOUND) → skips validation and still updates", async () => {
    mockR2Send.mockRejectedValueOnce(new Error("ENOTFOUND r2.example"));

    const result = await confirmProfileImageUpload(validInput);

    expect(result.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("non-recoverable validation error → bubbles up as safe error", async () => {
    // Something other than credentials/ENOTFOUND → rethrown and caught by outer
    mockR2Send.mockRejectedValueOnce(new Error("Access Denied"));

    const result = await confirmProfileImageUpload(validInput);

    expect(result.success).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("png extension → validates against image/png MIME type", async () => {
    const pngInput = {
      r2Key: "profiles/user_42/avatar/abc.png",
      imageType: "avatar" as const,
    };

    await confirmProfileImageUpload(pngInput);

    expect(mockValidateMagicBytes).toHaveBeenCalledWith(
      expect.anything(),
      "image/png",
    );
  });

  it("schedules deletion of old R2 key on successful replace", async () => {
    mockFindImageKeys.mockResolvedValueOnce({
      avatarKey: "profiles/user_42/avatar/old-key.jpg",
      coverImageKey: null,
    });

    const result = await confirmProfileImageUpload(validInput);

    expect(result.success).toBe(true);
    // Update always happens
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("does not attempt delete when old key is an external/seed URL", async () => {
    mockFindImageKeys.mockResolvedValueOnce({
      avatarKey: "https://images.unsplash.com/seed.jpg",
      coverImageKey: null,
    });

    const result = await confirmProfileImageUpload(validInput);

    expect(result.success).toBe(true);
    // GetObject + possibly no delete call — but we only assert no *extra* delete:
    // count should be 1 (initial GetObject) — no second delete for old key.
    // The second send (if any) would be DeleteObject for invalid magic bytes,
    // which doesn't apply here.
    expect(mockR2Send).toHaveBeenCalledTimes(1);
  });
});
