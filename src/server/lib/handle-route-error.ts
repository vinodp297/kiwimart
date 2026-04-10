// src/server/lib/handle-route-error.ts
// ─── API Route Error Handler ──────────────────────────────────────────────────
// Consolidates the repeated logger + apiError pattern across API route catch
// blocks. Replaces 11+ manually-written catch blocks that each did:
//
//   logger.error("api.error", { path, error })
//   return apiError("...", 500)
//
// Two branches:
//
//   AppError — expected domain errors (validation, not found, unauthorised, etc.)
//     • Logged as WARN — expected failures, not indicative of a system problem
//     • Status code and error code flow through from the AppError itself
//
//   Unknown / unexpected errors — programming errors, network failures, etc.
//     • Logged as ERROR with the full stringified error for diagnosis
//     • Returns a generic 500 to avoid leaking implementation details to clients

import { AppError } from "@/shared/errors";
import { apiError } from "@/app/api/v1/_helpers/response";
import { logger } from "@/shared/logger";

/**
 * Handles a caught error in an API route and returns the appropriate Response.
 *
 * @param error   The unknown value caught in the catch block.
 * @param context Must include `path`; any extra fields are merged into the log.
 *
 * @example
 * } catch (err) {
 *   return handleRouteError(err, { path: '/api/v1/listings' })
 * }
 *
 * @example With a deprecation wrapper
 * } catch (err) {
 *   return withDeprecation(handleRouteError(err, { path: '/api/admin/reports' }), SUNSET)
 * }
 */
export function handleRouteError(
  error: unknown,
  context: { path: string; [key: string]: unknown },
): Response {
  if (error instanceof AppError) {
    logger.warn("route.app_error", {
      ...context,
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
    });
    return apiError(error.message, error.statusCode, error.code);
  }

  logger.error("route.unexpected_error", {
    ...context,
    error: String(error),
  });
  return apiError("Something went wrong", 500);
}
