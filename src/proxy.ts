// src/proxy.ts  (Sprint 3 — real auth guard)
// ─── Next.js 16 Proxy (replaces middleware.ts) ────────────────────────────────
// Runs on Node.js runtime before every request (edge runtime not supported here).
//
// Sprint 3 additions:
//   • Real Auth.js JWT/session token verification (getToken from next-auth/jwt)
//   • Protected path redirects with ?from= parameter
//   • Auth page redirects for already-authenticated users

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

// Paths that require a session. Matched with exact-segment logic so that
// /sell blocks /sell and /sell/* but NOT /sellers/* (public seller profiles).
const PROTECTED_PREFIXES = [
  '/dashboard',
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

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // ── Security headers (applied to all responses) ───────────────────────────
  const response = NextResponse.next();

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://js.stripe.com ${process.env.NODE_ENV === 'development' ? "'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://images.unsplash.com https://*.cloudflare.com https://r2.kiwimart.co.nz https://*.stripe.com",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' https://challenges.cloudflare.com https://api.stripe.com https://*.stripe.com",
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

  // ── Auth.js JWT verification ──────────────────────────────────────────────
  // Now using JWT sessions (strategy: 'jwt'), so getToken() works correctly.
  // We read sellerEnabled from the token to make smart redirects.
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET!,
    cookieName:
      process.env.NODE_ENV === 'production'
        ? '__Secure-authjs.session-token'
        : 'authjs.session-token',
  });

  const isAuthenticated = !!token;
  const sellerEnabled = !!(token as { sellerEnabled?: boolean } | null)?.sellerEnabled;
  const defaultDashboard = sellerEnabled ? '/dashboard/seller' : '/dashboard/buyer';

  const isProtected = matchesProtected(pathname);
  const isAuthPath  = AUTH_PREFIXES.some((p) => pathname.startsWith(p));

  if (isProtected && !isAuthenticated) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthPath && isAuthenticated) {
    return NextResponse.redirect(new URL(defaultDashboard, request.url));
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp)).*)',
  ],
};
