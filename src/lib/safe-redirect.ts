// src/lib/safe-redirect.ts
// ─── Safe redirect utility ────────────────────────────────────────────────────
// Validates a redirect target so that open-redirect attacks cannot send users
// to external sites via the `?from=` query parameter on the login page.
//
// Accepted:   /dashboard/buyer   /orders/123   /search?q=bike
// Rejected:   //evil.com         https://evil.com   javascript:alert(1)

/**
 * Returns `to` when it is a safe relative path, otherwise returns `fallback`.
 *
 * A path is safe when it:
 *   • starts with `/`
 *   • does NOT start with `//` (protocol-relative URL)
 *   • contains no `:` (excludes absolute URLs such as https://)
 */
export function safeRedirect(
  to: string | null | undefined,
  fallback = "/",
): string {
  if (!to) return fallback;
  if (to.startsWith("/") && !to.startsWith("//") && !to.includes(":")) {
    return to;
  }
  return fallback;
}
