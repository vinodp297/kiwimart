// src/lib/client-logger.ts
// ─── Client-side error reporter ───────────────────────────────────────────────
// Posts to /api/client-errors in production.
// Falls back to console.warn in development only.
// Never throws — the logger itself must be silent on failure.

const IS_DEV = process.env.NODE_ENV === "development";

// Known PII field name substrings — redacted before any error is sent.
const PII_KEYS = [
  "email",
  "phone",
  "token",
  "password",
  "secret",
  "key",
  "name",
  "address",
];

/**
 * Strip known PII keys from client error context before sending to the server.
 * Only top-level keys are inspected — nested objects are passed through as-is
 * but will be JSON-stringified server-side with no further inspection.
 */
export function sanitiseClientContext(
  ctx: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    result[k] = PII_KEYS.some((p) => k.toLowerCase().includes(p))
      ? "[redacted]"
      : v;
  }
  return result;
}

/**
 * Client-side error reporter.
 *
 * Usage:
 *   clientError('upload.failed', { status: xhr.status })
 *   clientError('nav.fetchNavSummary.failed', { error: String(err) })
 *
 * Development: logs to console.warn for visibility without alarming devs.
 * Production:  POSTs to /api/client-errors (fire-and-forget, fail-silent).
 */
export function clientError(
  message: string,
  context?: Record<string, unknown>,
): void {
  const safeContext = context ? sanitiseClientContext(context) : undefined;

  if (IS_DEV) {
    console.warn("[client]", message, safeContext ?? "");
    return;
  }

  // Production: fire-and-forget POST — must never throw or block the caller.
  try {
    fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        context: safeContext,
        url:
          typeof window !== "undefined" ? window.location.pathname : undefined,
        timestamp: new Date().toISOString(),
      }),
    }).catch(() => {
      // Silently ignore async errors — the logger itself must never throw.
    });
  } catch {
    // Silently ignore synchronous errors (e.g. fetch not available in SSR).
  }
}
