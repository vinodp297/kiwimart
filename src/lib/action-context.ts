// src/lib/action-context.ts
// ─── Server Action Context Helper ────────────────────────────────────────────
// Wraps a server action body in a runWithRequestContext call so that all
// downstream code (logger, BullMQ queue.add calls, service methods) can read
// the correlationId without it being threaded as an explicit parameter.
//
// Usage:
//   export async function myAction(raw: unknown): Promise<ActionResult<T>> {
//     return withActionContext(async () => {
//       // All code here can call getRequestContext()?.correlationId
//       const reqHeaders = await headers();
//       // ...
//     });
//   }
//
// The correlationId is sourced from the x-correlation-id request header that
// proxy.ts injects on every incoming request. If the header is absent (e.g.
// during tests or direct invocation) a fresh UUID is generated as a fallback.

import { headers } from "next/headers";
import crypto from "crypto";
import { runWithRequestContext } from "./request-context";

/**
 * Wraps a server action body in a request context carrying the correlationId
 * from the incoming x-correlation-id header (set by proxy.ts).
 *
 * Falls back to a fresh UUID when the header is absent — guarantees every
 * server action invocation has a traceable correlationId in logs.
 */
export async function withActionContext<T>(fn: () => Promise<T>): Promise<T> {
  const reqHeaders = await headers();
  const correlationId =
    reqHeaders.get("x-correlation-id") ?? crypto.randomUUID();
  return runWithRequestContext({ correlationId }, fn);
}
