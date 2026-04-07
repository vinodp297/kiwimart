// src/test/nav-summary.test.ts
// ─── Tests for GET /api/v1/me/nav-summary ────────────────────────────────────
// Verifies the batched navbar endpoint returns cart count, notification data,
// and user info in a single request.

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

// ── Mock auth ────────────────────────────────────────────────────────────────
const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({
  auth: () => mockAuth(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

// ── Mock notification repository ─────────────────────────────────────────────
const mockFindByUser = vi.fn().mockResolvedValue([]);
const mockCountUnread = vi.fn().mockResolvedValue(0);

vi.mock("@/modules/notifications/notification.repository", () => ({
  notificationRepository: {
    findByUser: (...args: unknown[]) => mockFindByUser(...args),
    countUnread: (...args: unknown[]) => mockCountUnread(...args),
    markAllRead: vi.fn(),
    markRead: vi.fn(),
    create: vi.fn(),
    findRecentReminder: vi.fn(),
    notifyAdmins: vi.fn(),
  },
}));

import db from "@/lib/db";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function callGET() {
  const { GET } = await import("@/app/api/v1/me/nav-summary/route");
  const req = new Request("http://localhost:3000/api/v1/me/nav-summary");
  const res = await GET(req);
  return { status: res.status, body: await res.json() };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/v1/me/nav-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default resolved values (clearAllMocks only clears call history)
    mockFindByUser.mockResolvedValue([]);
    mockCountUnread.mockResolvedValue(0);
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const { status, body } = await callGET();
    expect(status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/Unauthorised/i);
  });

  it("returns cart count, notifications, and user data when authenticated", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u-1", name: "Test User", email: "t@t.com" },
    });

    // Cart with 3 items, not expired
    vi.mocked(db.cart.findUnique).mockResolvedValue({
      expiresAt: new Date(Date.now() + 3_600_000),
      _count: { items: 3 },
    } as never);

    // User record
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u-1",
      displayName: "Test User",
      email: "t@t.com",
      avatarKey: null,
      isAdmin: false,
      isSellerEnabled: true,
      isMfaEnabled: false,
    } as never);

    // 2 notifications, 1 unread
    mockFindByUser.mockResolvedValue([
      {
        id: "n-1",
        type: "ORDER_PLACED",
        title: "Order placed",
        body: "Your order was placed",
        isRead: false,
        link: "/orders/o-1",
        createdAt: new Date().toISOString(),
      },
      {
        id: "n-2",
        type: "SYSTEM",
        title: "Welcome",
        body: "Welcome to Buyzi",
        isRead: true,
        link: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    mockCountUnread.mockResolvedValue(1);

    const { status, body } = await callGET();

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.cartCount).toBe(3);
    expect(body.data.unreadNotificationCount).toBe(1);
    expect(body.data.notifications).toHaveLength(2);
    expect(body.data.user).toEqual({
      id: "u-1",
      name: "Test User",
      email: "t@t.com",
      role: "USER",
      avatarUrl: null,
      isAdmin: false,
      isSellerEnabled: true,
      isMfaEnabled: false,
    });
  });

  it("returns zero cart count when user has no cart", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u-2", name: "No Cart", email: "nc@t.com" },
    });

    vi.mocked(db.cart.findUnique).mockResolvedValue(null as never);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u-2",
      displayName: "No Cart",
      email: "nc@t.com",
      avatarKey: null,
      isAdmin: false,
      isSellerEnabled: false,
      isMfaEnabled: false,
    } as never);

    const { status, body } = await callGET();

    expect(status).toBe(200);
    expect(body.data.cartCount).toBe(0);
    expect(body.data.unreadNotificationCount).toBe(0);
    expect(body.data.notifications).toEqual([]);
  });

  it("returns zero cart count when cart is expired", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u-3", name: "Expired", email: "e@t.com" },
    });

    vi.mocked(db.cart.findUnique).mockResolvedValue({
      expiresAt: new Date(Date.now() - 3_600_000), // expired 1h ago
      _count: { items: 5 },
    } as never);

    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u-3",
      displayName: "Expired",
      email: "e@t.com",
      avatarKey: null,
      isAdmin: false,
      isSellerEnabled: false,
      isMfaEnabled: false,
    } as never);

    const { status, body } = await callGET();

    expect(status).toBe(200);
    expect(body.data.cartCount).toBe(0);
  });

  it("returns correct unread count when user has unread notifications", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u-4", name: "Unread", email: "ur@t.com" },
    });

    vi.mocked(db.cart.findUnique).mockResolvedValue(null as never);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u-4",
      displayName: "Unread",
      email: "ur@t.com",
      avatarKey: null,
      isAdmin: false,
      isSellerEnabled: true,
      isMfaEnabled: false,
    } as never);

    mockCountUnread.mockResolvedValue(7);
    mockFindByUser.mockResolvedValue([
      {
        id: "n-10",
        type: "OFFER_RECEIVED",
        title: "New offer",
        body: "$50 offer",
        isRead: false,
        link: "/offers/o-10",
        createdAt: new Date().toISOString(),
      },
    ]);

    const { status, body } = await callGET();

    expect(status).toBe(200);
    expect(body.data.unreadNotificationCount).toBe(7);
    expect(body.data.notifications).toHaveLength(1);
  });
});
