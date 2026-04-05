// src/app/api/v1/_helpers/cors.ts
// ─── CORS Headers for Mobile API ─────────────────────────────────────────────

function resolveAllowedOrigins(): string {
  if (!process.env.ALLOWED_ORIGINS && process.env.NODE_ENV === "production") {
    throw new Error(
      "ALLOWED_ORIGINS env var is required in production. Set it to a comma-separated list of allowed origins.",
    );
  }
  return process.env.ALLOWED_ORIGINS ?? "*";
}

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": resolveAllowedOrigins(),
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function withCors(response: Response): Response {
  for (const [key, value] of Object.entries(corsHeaders)) {
    response.headers.set(key, value);
  }
  return response;
}
