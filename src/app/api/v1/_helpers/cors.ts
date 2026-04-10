// src/app/api/v1/_helpers/cors.ts
// ─── CORS Headers for Mobile API ─────────────────────────────────────────────
// getCorsHeaders() is intentionally NOT called at module level — it must
// only run inside request handlers so that missing env vars throw at
// request time (not at build/bundle evaluation time on Vercel).
//
// Origin reflection: we never use wildcard (*). For each request we check the
// incoming Origin header against the ALLOWED_ORIGINS allowlist and reflect it
// back only if it matches. Non-matching origins receive no CORS headers.
//
// Vary: Origin is always included when CORS headers are set so CDNs cache
// responses separately per origin and do not serve one origin's CORS response
// to a different origin (cache-poisoning prevention).

function getAllowedOrigins(): string[] {
  const origins = process.env.ALLOWED_ORIGINS;
  if (!origins) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "ALLOWED_ORIGINS env var is required in production. Set it to a comma-separated list of allowed origins.",
      );
    }
    // Fail closed in non-production too — no ALLOWED_ORIGINS means no CORS.
    return [];
  }
  return origins
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Build the CORS header map for the given request origin.
 * Called at request time, never at module init.
 *
 * @param origin - The value of the incoming `Origin` request header.
 * @returns Header map with CORS headers if origin is allowed, empty object otherwise.
 */
export function getCorsHeaders(
  origin: string | null | undefined,
): Record<string, string> {
  if (!origin) return {};

  const allowed = getAllowedOrigins();
  const matched = allowed.find((a) => a.toLowerCase() === origin.toLowerCase());
  if (!matched) return {};

  return {
    "Access-Control-Allow-Origin": matched,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    // Cache preflight for 10 minutes (600 s) so the browser does not send an
    // OPTIONS request before every actual API call.
    "Access-Control-Max-Age": "600",
    // Vary: Origin is mandatory when reflecting a single origin from an
    // allowlist — CDNs must cache responses separately per-origin to prevent
    // one origin's CORS response being served to a different origin.
    Vary: "Origin",
  };
}

export function withCors(
  response: Response,
  origin: string | null | undefined,
): Response {
  for (const [key, value] of Object.entries(getCorsHeaders(origin))) {
    response.headers.set(key, value);
  }
  return response;
}
