// src/app/api/_helpers/deprecation.ts
// ─── Deprecation header helper ────────────────────────────────────────────────
// Attaches RFC 8594-compliant deprecation headers to a Response.
// Use in legacy /api/* routes that have been superseded by /api/v1/*.
//
// Usage:
//   return withDeprecation(apiOk(data), new Date(Date.now() + 90 * MS_PER_DAY))
//   return withDeprecation(apiOk(data), sunset, '/api/v1/cart')

/**
 * Attach Deprecation, Sunset, and Link headers to a response.
 *
 * @param response   The Response to annotate (returned unchanged apart from headers).
 * @param sunset     Date after which the route will no longer be available.
 * @param alternative  Optional successor URL (defaults to /api/v1/).
 */
export function withDeprecation<T extends Response>(
  response: T,
  sunset: Date,
  alternative = "/api/v1/",
): T {
  response.headers.set("Deprecation", "true");
  response.headers.set("Sunset", sunset.toUTCString());
  response.headers.set("Link", `<${alternative}>; rel="successor-version"`);
  return response;
}
