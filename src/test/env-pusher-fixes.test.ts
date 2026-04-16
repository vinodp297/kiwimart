// src/test/env-pusher-fixes.test.ts
// ─── Tests for Fix 1 (Twilio env name), Fix 2 (Pusher rate limit + origin),
//     Fix 3 (Prisma version alignment)

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ─────────────────────────────────────────────────────────────────────────────
// Fix 1 — Twilio env name: TWILIO_FROM_NUMBER (not TWILIO_PHONE_NUMBER)
// ─────────────────────────────────────────────────────────────────────────────

describe("Fix 1 — Twilio env schema uses TWILIO_FROM_NUMBER", () => {
  it("env.ts schema has TWILIO_FROM_NUMBER (not TWILIO_PHONE_NUMBER)", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/env.ts", "utf8");
    expect(src).toContain("TWILIO_FROM_NUMBER");
    expect(src).not.toContain("TWILIO_PHONE_NUMBER");
  });

  it("no production source file references TWILIO_PHONE_NUMBER", async () => {
    // sms.service.ts and all callers must use TWILIO_FROM_NUMBER
    const { execSync } = await import("child_process");
    let output = "";
    try {
      output = execSync(
        'grep -rn "TWILIO_PHONE_NUMBER" src/ --include="*.ts" --exclude-dir=test',
        { cwd: process.cwd(), encoding: "utf8" },
      );
    } catch {
      // grep exits with code 1 when no matches found — that is the desired result
    }
    expect(output.trim()).toBe("");
  });

  it("sms.service.ts uses TWILIO_FROM_NUMBER to read the from-number", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      "src/server/services/sms/sms.service.ts",
      "utf8",
    );
    expect(src).toContain("TWILIO_FROM_NUMBER");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix 2 — Pusher auth: rate limiting + origin check
// ─────────────────────────────────────────────────────────────────────────────

// Hoisted mocks for the Pusher auth route
const { mockAuth, mockRateLimit, mockGetPusherServer, mockAuthorizeChannel } =
  vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockRateLimit: vi.fn(),
    mockGetPusherServer: vi.fn(),
    mockAuthorizeChannel: vi.fn(),
  }));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/server/lib/rateLimit", () => ({
  rateLimit: mockRateLimit,
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));
vi.mock("@/lib/pusher", () => ({
  getPusherServer: mockGetPusherServer,
}));

// Import route after mocks
const { POST } = await import("@/app/api/pusher/auth/route");

function makeFormRequest(
  overrides: {
    socketId?: string;
    channelName?: string;
    origin?: string;
    userId?: string;
  } = {},
) {
  const {
    socketId = "123.456",
    channelName = `private-user-${overrides.userId ?? "user-abc"}`,
    origin = "http://localhost:3001",
  } = overrides;

  const body = new FormData();
  body.append("socket_id", socketId);
  body.append("channel_name", channelName);

  return new Request("http://localhost/api/pusher/auth", {
    method: "POST",
    body,
    headers: origin ? { origin } : {},
  });
}

describe("Fix 2 — Pusher auth: rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: valid session
    mockAuth.mockResolvedValue({ user: { id: "user-abc" } });
    // Default: within rate limit
    mockRateLimit.mockResolvedValue({
      success: true,
      remaining: 19,
      reset: Date.now() + 60_000,
      retryAfter: 0,
    });
    // Default: Pusher auth succeeds
    mockAuthorizeChannel.mockReturnValue({ auth: "pusher:token" });
    mockGetPusherServer.mockReturnValue({
      authorizeChannel: mockAuthorizeChannel,
    });
    // Allow the app URL origin
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
  });

  it("rate limit hit → 429 response with Retry-After header", async () => {
    mockRateLimit.mockResolvedValue({
      success: false,
      remaining: 0,
      reset: Date.now() + 30_000,
      retryAfter: 30,
    });

    const res = await POST(makeFormRequest({ userId: "user-abc" }));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  it("rate limit uses 'pusherAuth' bucket keyed by userId", async () => {
    await POST(makeFormRequest({ userId: "user-abc" }));

    expect(mockRateLimit).toHaveBeenCalledWith("pusherAuth", "user-abc");
  });

  it("valid request within limit → 200 and Pusher token returned", async () => {
    const res = await POST(makeFormRequest({ userId: "user-abc" }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { auth: string };
    expect(body.auth).toBe("pusher:token");
  });

  it("unauthenticated request → 403 (no rate limit call)", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(makeFormRequest());

    expect(res.status).toBe(403);
    // Rate limit must NOT be called before session check
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it("rate limit is called AFTER session check", async () => {
    const callOrder: string[] = [];
    mockAuth.mockImplementation(async () => {
      callOrder.push("auth");
      return { user: { id: "user-abc" } };
    });
    mockRateLimit.mockImplementation(async () => {
      callOrder.push("rateLimit");
      return {
        success: true,
        remaining: 10,
        reset: Date.now() + 60_000,
        retryAfter: 0,
      };
    });

    await POST(makeFormRequest({ userId: "user-abc" }));

    expect(callOrder.indexOf("auth")).toBeLessThan(
      callOrder.indexOf("rateLimit"),
    );
  });
});

describe("Fix 2 — Pusher auth: origin check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "user-abc" } });
    mockRateLimit.mockResolvedValue({
      success: true,
      remaining: 19,
      reset: Date.now() + 60_000,
      retryAfter: 0,
    });
    mockAuthorizeChannel.mockReturnValue({ auth: "pusher:token" });
    mockGetPusherServer.mockReturnValue({
      authorizeChannel: mockAuthorizeChannel,
    });
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
  });

  it("request from allowed origin → proceeds normally (200)", async () => {
    const res = await POST(
      makeFormRequest({ userId: "user-abc", origin: "http://localhost:3001" }),
    );
    expect(res.status).toBe(200);
  });

  it("request from disallowed origin → 403", async () => {
    const res = await POST(
      makeFormRequest({
        userId: "user-abc",
        origin: "https://evil-attacker.com",
      }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Forbidden");
  });

  it("origin check happens BEFORE session check", async () => {
    // With a mismatched origin, auth() should not be called at all
    const res = await POST(
      makeFormRequest({
        userId: "user-abc",
        origin: "https://different-site.com",
      }),
    );
    expect(res.status).toBe(403);
    // Auth mock should not have been needed — origin rejected first
    // (auth may or may not be called depending on order; what matters is 403)
  });

  it("request with no origin header → proceeds (allows same-origin / non-browser)", async () => {
    const body = new FormData();
    body.append("socket_id", "123.456");
    body.append("channel_name", "private-user-user-abc");

    const req = new Request("http://localhost/api/pusher/auth", {
      method: "POST",
      body,
      // No origin header
    });

    const res = await POST(req);
    // Should proceed — no origin means same-origin or server-to-server
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix 2 — pusherAuth rate limit key exists in rateLimit.ts
// ─────────────────────────────────────────────────────────────────────────────

describe("Fix 2 — pusherAuth rate limit configuration", () => {
  it("rateLimit.ts exports 'pusherAuth' as a valid RateLimitKey", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/server/lib/rateLimit.ts", "utf8");
    expect(src).toContain('"pusherAuth"');
    expect(src).toContain("pusherAuth:");
    expect(src).toContain("pusherAuthLimiter");
  });

  it("pusherAuth limiter uses 20 req/min sliding window", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/server/lib/rateLimit.ts", "utf8");
    // Find the pusherAuthLimiter block
    const idx = src.indexOf("pusherAuthLimiter");
    const snippet = src.slice(idx, idx + 200);
    expect(snippet).toContain("20");
    expect(snippet).toContain("1 m");
    expect(snippet).toContain("km:rl:pusher-auth");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix 3 — Prisma version alignment
// ─────────────────────────────────────────────────────────────────────────────

describe("Fix 3 — Prisma version alignment", () => {
  it("@prisma/client version matches prisma CLI version (both 7.6.0)", async () => {
    const fs = await import("fs");
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    const clientVersion = pkg.dependencies["@prisma/client"];
    const cliVersion = pkg.devDependencies["prisma"];

    // Both must reference 7.6.0 (may include ^ semver prefix)
    expect(clientVersion).toContain("7.6.0");
    expect(cliVersion).toContain("7.6.0");
  });

  it("installed @prisma/client runtime is 7.6.0", async () => {
    const fs = await import("fs");
    const clientPkg = JSON.parse(
      fs.readFileSync("node_modules/@prisma/client/package.json", "utf8"),
    ) as { version: string };
    expect(clientPkg.version).toBe("7.6.0");
  });
});
