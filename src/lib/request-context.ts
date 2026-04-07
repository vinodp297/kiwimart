// src/lib/request-context.ts
// ─── Per-request context via AsyncLocalStorage ────────────────────────────────
// Provides a way to thread correlationId through the async call stack without
// passing it explicitly to every function.
//
// Usage pattern:
//   // In a route handler or server action entry point:
//   return runWithRequestContext({ correlationId }, async () => {
//     // All code called from here can access the context
//     await someService.doWork();
//   });
//
//   // Inside any called function:
//   const { correlationId } = getRequestContext() ?? {};

import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  correlationId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs fn() within a request context. All synchronous and async calls made
 * within fn() (and their callees) can read the context via getRequestContext().
 */
export function runWithRequestContext<T>(
  context: RequestContext,
  fn: () => T,
): T {
  return storage.run(context, fn);
}

/**
 * Returns the current request context, or undefined if not within a
 * runWithRequestContext() call.
 */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
