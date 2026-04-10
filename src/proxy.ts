// src/proxy.ts  (Sprint 9 — fixed for Auth.js v5 beta JWT/DB session duality)
// ─── Next.js 16 Proxy (replaces middleware.ts) ────────────────────────────────
// Runs on Node.js runtime before every request (edge runtime not supported here).
//
// Auth.js v5 beta.30 uses JWT cookies for credentials sign-in regardless of
// strategy: 'database' in auth.ts.  The previous implementation read the raw
// session token and looked it up in the DB — which only worked for OAuth
// (database sessions), not for credentials (JWT cookies).
//
// Fix: use auth() as the proxy wrapper so Auth.js handles decoding the cookie
// itself (JWT decode for credentials, DB lookup for OAuth).  The decoded
// session is available as request.auth, so we no longer need a manual DB query
// for the auth check (though we still use DB for ban checks on DB sessions).

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import crypto from "crypto";
import { auth } from "@/lib/auth";
import { logger } from "@/shared/logger";
import { getSessionVersion } from "@/server/lib/sessionStore";
import { runWithRequestContext } from "@/lib/request-context";

/** Generate a cryptographically random nonce for CSP per-request. */
const generateNonce = () => crypto.randomBytes(16).toString("base64");

/**
 * Apply baseline security headers to middleware-generated redirect responses.
 * next.config.ts headers() only applies to route handler responses, NOT to
 * NextResponse.redirect() calls from middleware — so these must be set here.
 */
function withSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set("X-Content-Type-Options", "nosniff");
  return res;
}

// Paths that require a session. Matched with exact-segment logic so that
// /sell blocks /sell and /sell/* but NOT /sellers/* (public seller profiles).
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/admin",
  "/account",
  "/checkout",
  "/messages",
  "/sell",
  "/orders",
  "/reviews",
  "/notifications",
  "/cart",
  "/seller",
  "/welcome",
];

const AUTH_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
];

// Exact-segment prefix match: '/sell' matches '/sell' and '/sell/step2'
// but not '/sellers/john'. Prevents false positives from simple startsWith.
function matchesProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

// API v1 endpoints that work without session cookies
function isPublicApi(pathname: string, method: string): boolean {
  // Mobile auth endpoints (credentials/bearer, no cookies)
  if (pathname.startsWith("/api/v1/auth/")) return true;
  // Public GET-only endpoints
  if (method !== "GET") return false;
  return [
    "/api/v1/listings",
    "/api/v1/reviews",
    "/api/v1/search",
    "/api/v1/notifications", // Returns empty for unauthenticated
    "/api/v1/cart", // Returns { count: 0 } for unauthenticated
    "/api/v1/fees", // Public fee preview — no auth required
  ].some((p) => pathname.startsWith(p));
}

// auth() as a callback wrapper — request.auth is the decoded session
// (JWT for credentials, DB row for OAuth).  Auth.js handles both transparently.
export const proxy = auth(async function proxyHandler(
  request: NextRequest & {
    auth: {
      user?: {
        id?: string;
        isSellerEnabled?: boolean;
        isAdmin?: boolean;
        isBanned?: boolean;
        mfaPending?: boolean;
      };
    } | null;
  },
) {
  const requestStart = Date.now();
  const requestId = crypto.randomUUID();

  return runWithRequestContext({ correlationId: requestId }, async () => {
    const { pathname } = request.nextUrl;

    // ── Security headers (applied to all responses) ───────────────────────────
    const nonce = generateNonce();

    // Thread the correlation ID through to route handlers via a request header
    // so downstream code (logger, BullMQ jobs, Stripe metadata) can read it.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-correlation-id", requestId);

    const response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
    // Pass nonce to server components via request header
    response.headers.set("x-nonce", nonce);

    const csp = [
      "default-src 'self'",
      // script-src: nonce for inline/first-party scripts, 'strict-dynamic' so
      // nonce-approved scripts can load sub-resources.  Host allowlists are kept
      // as a fallback for older browsers that don't understand 'strict-dynamic'.
      // Turnstile, Stripe, and PostHog are listed explicitly so they work in both
      // nonce-aware and legacy browsers.
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com https://js.stripe.com https://us-assets.i.posthog.com https://app.posthog.com${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
      `style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com`,
      "img-src 'self' data: blob: https://images.unsplash.com https://*.cloudflare.com https://*.cloudflarestorage.com https://*.r2.dev https://r2.kiwimart.co.nz https://*.stripe.com",
      "font-src 'self' https://fonts.gstatic.com",
      "connect-src 'self' https://challenges.cloudflare.com https://api.stripe.com https://*.stripe.com https://us.i.posthog.com https://us-assets.i.posthog.com https://app.posthog.com wss://*.pusher.com https://*.pusher.com https://*.r2.cloudflarestorage.com",
      "frame-src 'self' https://challenges.cloudflare.com https://js.stripe.com https://hooks.stripe.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      // Prevents this site from being embedded in any iframe on any origin.
      // Stronger than X-Frame-Options (which some user agents ignore) and works
      // with both same-origin and cross-origin ancestors.
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ]
      .filter(Boolean)
      .join("; ");

    response.headers.set("Content-Security-Policy", csp);
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("X-XSS-Protection", "1; mode=block");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=(self)",
    );

    if (process.env.NODE_ENV === "production") {
      response.headers.set(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains; preload",
      );
    }

    // ── Cross-Origin isolation headers ────────────────────────────────────────
    // COOP: same-origin-allow-popups preserves isolation while allowing Google
    // OAuth to complete (it uses window.open which requires popup access).
    // COEP: unsafe-none is the safe fallback — require-corp would block
    // cross-origin Cloudflare R2 images that do not send CORP headers.
    // CORP: same-origin prevents other origins embedding our HTML responses.
    response.headers.set(
      "Cross-Origin-Opener-Policy",
      "same-origin-allow-popups",
    );
    response.headers.set("Cross-Origin-Embedder-Policy", "unsafe-none");
    response.headers.set("Cross-Origin-Resource-Policy", "same-origin");

    // ── No-store headers for protected pages ──────────────────────────────────
    // Prevents the browser bfcache from restoring a signed-in page after
    // sign-out. Must-revalidate + no-store forces the browser to always hit
    // the server, where the (now-missing) session cookie will trigger a
    // redirect to /login instead of showing a cached dashboard.
    if (matchesProtected(pathname)) {
      response.headers.set(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate",
      );
      response.headers.set("Pragma", "no-cache");
      response.headers.set("Expires", "0");
    }

    // ── Auth decision ─────────────────────────────────────────────────────────
    // request.auth is populated by auth() which runs the jwt() callback.
    // The jwt() callback already checks session version and jti blocklist —
    // if either fails it returns null, making request.auth null here.
    //
    // Defence-in-depth: for protected routes we also do a direct Redis
    // session-version check so that even if auth() somehow passes a stale
    // session through, the proxy will still catch it.
    const sessionUser = request.auth?.user ?? null;
    let isAuthenticated = !!sessionUser?.id && !sessionUser?.isBanned;

    const isProtected = matchesProtected(pathname);
    const isAuthPath = AUTH_PREFIXES.some((p) => pathname.startsWith(p));
    const isAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");

    // ── API route auth checks ─────────────────────────────────────────────
    // Returns 401 JSON for unauthenticated/MFA-pending API requests.
    // API clients expect JSON errors, not redirects.
    if (pathname.startsWith("/api/v1/") || pathname.startsWith("/api/admin/")) {
      if (isPublicApi(pathname, request.method)) return response;
      if (!isAuthenticated) {
        return NextResponse.json(
          { error: "Unauthorised", code: "AUTH_REQUIRED" },
          { status: 401 },
        );
      }
      if (sessionUser?.mfaPending) {
        return NextResponse.json(
          { error: "MFA verification required", code: "MFA_REQUIRED" },
          { status: 401 },
        );
      }
      return response;
    }

    // ── Proxy-level session version check (defence-in-depth) ────────────────
    // If the user appears authenticated on a protected route, verify the
    // session version stored in the cookie hasn't been superseded by a
    // sign-out.  This catches bfcache-restored pages where Chrome replayed
    // the original cookie before Auth.js had a chance to clear it.
    if (isProtected && isAuthenticated && sessionUser?.id) {
      try {
        const { getToken } = await import("next-auth/jwt");
        // IMPORTANT: use NEXTAUTH_SECRET — the variable validated in env.ts.
        // process.env.AUTH_SECRET would be undefined if only NEXTAUTH_SECRET is
        // set in Vercel, silently disabling this bfcache defence for all users.
        const jwtToken = await getToken({
          req: request,
          secret: process.env.NEXTAUTH_SECRET,
        });
        if (jwtToken && typeof jwtToken.sessionVersion === "number") {
          const currentVersion = await getSessionVersion(
            jwtToken.sub as string,
          );
          if (currentVersion > jwtToken.sessionVersion) {
            logger.info("proxy.session_version_stale", {
              userId: jwtToken.sub,
              tokenVersion: jwtToken.sessionVersion,
              currentVersion,
              path: pathname,
            });
            isAuthenticated = false;
            // Clear the stale cookie so the browser doesn't keep sending it
            const loginUrl = new URL("/login", request.url);
            loginUrl.searchParams.set("from", pathname);
            const redirectResponse = NextResponse.redirect(loginUrl);
            redirectResponse.cookies.delete("__Secure-authjs.session-token");
            redirectResponse.cookies.delete("authjs.session-token");
            withSecurityHeaders(redirectResponse);
            return redirectResponse;
          }
        }
      } catch {
        // Redis/getToken failure — fail open, let the normal auth flow handle it
      }
    }

    const isSellerEnabled = sessionUser?.isSellerEnabled ?? false;
    const isAdmin = sessionUser?.isAdmin ?? false;
    const defaultDashboard = isSellerEnabled
      ? "/dashboard/seller"
      : "/dashboard/buyer";

    if (isProtected && !isAuthenticated) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("from", pathname);
      return withSecurityHeaders(NextResponse.redirect(loginUrl));
    }

    // MFA pending: redirect to /mfa-verify before granting access
    // /mfa-verify itself is NOT in PROTECTED_PREFIXES so no infinite redirect
    if (isProtected && isAuthenticated && sessionUser?.mfaPending) {
      const mfaUrl = new URL("/mfa-verify", request.url);
      mfaUrl.searchParams.set("callbackUrl", pathname);
      return withSecurityHeaders(NextResponse.redirect(mfaUrl));
    }

    // Admin-only routes: redirect non-admins to buyer dashboard
    if (isAdminPath && isAuthenticated && !isAdmin) {
      return withSecurityHeaders(
        NextResponse.redirect(new URL("/dashboard/buyer", request.url)),
      );
    }

    if (isAuthPath && isAuthenticated) {
      return withSecurityHeaders(
        NextResponse.redirect(new URL(defaultDashboard, request.url)),
      );
    }

    // ── Request ID + correlation ID ───────────────────────────────────────────
    // x-request-id: internal tracing identifier (unchanged)
    // x-correlation-id: same UUID, exposed to clients so they can reference it
    //   in support requests and correlate with Stripe / BullMQ / Sentry traces.
    response.headers.set("x-request-id", requestId);
    response.headers.set("x-correlation-id", requestId);

    logger.info("http.request", {
      requestId,
      method: request.method,
      path: pathname,
      status: response.status,
      latencyMs: Date.now() - requestStart,
      userAgent: request.headers.get("user-agent")?.slice(0, 100) ?? undefined,
    });

    return response;
  }); // end runWithRequestContext
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp)).*)",
  ],
};
