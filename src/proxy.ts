// src/proxy.ts  (Sprint 9 — database sessions)
// ─── Next.js 16 Proxy (replaces middleware.ts) ────────────────────────────────
// Runs on Node.js runtime before every request (edge runtime not supported here).
//
// With database sessions (not JWT), we read the session token from the cookie
// and look up the session + user directly in the DB. This means:
//   * Ban checks happen at the proxy level — banned users are blocked immediately
//   * Admin/seller status is always fresh from DB — no stale JWT claims
//   * Only routes that need auth decisions trigger a DB lookup

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import db from '@/lib/db';
import { logger } from '@/shared/logger';

// Paths that require a session. Matched with exact-segment logic so that
// /sell blocks /sell and /sell/* but NOT /sellers/* (public seller profiles).
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/admin',
  '/account',
  '/checkout',
  '/messages',
  '/sell',
  '/orders',
  '/reviews',
];

const AUTH_PREFIXES = ['/login', '/register', '/forgot-password', '/reset-password'];

// Exact-segment prefix match: '/sell' matches '/sell' and '/sell/step2'
// but not '/sellers/john'. Prevents false positives from simple startsWith.
function matchesProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );
}

// Session cookie name varies by environment (Auth.js convention)
function getSessionCookieName(): string {
  return process.env.NODE_ENV === 'production'
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';
}

// Look up session + user from DB. Only called on routes that need auth decisions.
async function getSessionUser(sessionToken: string) {
  try {
    const session = await db.session.findUnique({
      where: { sessionToken },
      select: {
        expires: true,
        user: {
          select: {
            id: true,
            sellerEnabled: true,
            isAdmin: true,
            isBanned: true,
          },
        },
      },
    });

    // Validate session is not expired and user is not banned
    if (!session || session.expires <= new Date()) return null;
    if (session.user.isBanned) return null;

    return session.user;
  } catch {
    // DB error — fail open for public pages, closed for protected
    return null;
  }
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const requestStart = Date.now();
  const requestId = crypto.randomUUID();
  const { pathname } = request.nextUrl;

  // ── Security headers (applied to all responses) ───────────────────────────
  const response = NextResponse.next();

  const csp = [
    "default-src 'self'",
    // PostHog loads its main bundle from us-assets.i.posthog.com and app.posthog.com;
    // Stripe and Cloudflare Turnstile also need script access.
    `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://js.stripe.com https://us-assets.i.posthog.com https://app.posthog.com${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://images.unsplash.com https://*.cloudflare.com https://r2.kiwimart.co.nz https://*.stripe.com",
    "font-src 'self' https://fonts.gstatic.com",
    // PostHog sends analytics to us.i.posthog.com & us-assets; Pusher needs both WS and HTTPS.
    "connect-src 'self' https://challenges.cloudflare.com https://api.stripe.com https://*.stripe.com https://us.i.posthog.com https://us-assets.i.posthog.com https://app.posthog.com wss://*.pusher.com https://*.pusher.com",
    "frame-src https://challenges.cloudflare.com https://js.stripe.com https://hooks.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].filter(Boolean).join('; ');

  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(self)'
  );

  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }

  // ── Database session verification ──────────────────────────────────────────
  // With database sessions, the cookie contains a session token (not a JWT).
  // We only do a DB lookup on routes that actually need auth decisions.
  const sessionToken = request.cookies.get(getSessionCookieName())?.value;

  const isProtected = matchesProtected(pathname);
  const isAuthPath = AUTH_PREFIXES.some((p) => pathname.startsWith(p));
  const isAdminPath = pathname === '/admin' || pathname.startsWith('/admin/');

  // Only do DB lookup when the route needs an auth decision
  const needsAuthCheck = isProtected || isAuthPath;
  let sessionUser: { id: string; sellerEnabled: boolean; isAdmin: boolean; isBanned: boolean } | null = null;

  if (sessionToken && needsAuthCheck) {
    sessionUser = await getSessionUser(sessionToken);
  }

  const isAuthenticated = !!sessionUser;
  const sellerEnabled = sessionUser?.sellerEnabled ?? false;
  const isAdmin = sessionUser?.isAdmin ?? false;
  const defaultDashboard = sellerEnabled ? '/dashboard/seller' : '/dashboard/buyer';

  if (isProtected && !isAuthenticated) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Admin-only routes: redirect non-admins to buyer dashboard
  if (isAdminPath && isAuthenticated && !isAdmin) {
    return NextResponse.redirect(new URL('/dashboard/buyer', request.url));
  }

  if (isAuthPath && isAuthenticated) {
    return NextResponse.redirect(new URL(defaultDashboard, request.url));
  }

  // ── Request ID + structured logging ──────────────────────────────────────
  response.headers.set('x-request-id', requestId);

  logger.info('http.request', {
    requestId,
    method: request.method,
    path: pathname,
    status: response.status,
    latencyMs: Date.now() - requestStart,
    userAgent: request.headers.get('user-agent')?.slice(0, 100) ?? undefined,
  });

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp)).*)',
  ],
};
