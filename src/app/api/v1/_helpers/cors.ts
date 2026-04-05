// src/app/api/v1/_helpers/cors.ts
// ─── CORS Headers for Mobile API ─────────────────────────────────────────────
// getAllowedOrigins() is intentionally NOT called at module level — it must
// only run inside request handlers so that missing env vars throw at
// request time (not at build/bundle evaluation time on Vercel).

function getAllowedOrigins(): string[] {
  const origins = process.env.ALLOWED_ORIGINS;
  if (!origins) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "ALLOWED_ORIGINS env var is required in production. Set it to a comma-separated list of allowed origins.",
      );
    }
    return ["*"];
  }
  return origins.split(",").map((o) => o.trim());
}

/** Build the full CORS header map. Called at request time, never at module init. */
export function getCorsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": getAllowedOrigins()[0] ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export function withCors(response: Response): Response {
  for (const [key, value] of Object.entries(getCorsHeaders())) {
    response.headers.set(key, value);
  }
  return response;
}
