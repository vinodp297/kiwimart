// src/shared/types/action-result.ts
// ─── Standardised ActionResult<T> ────────────────────────────────────────────
// Return type for all server actions and services.
// The ok() / fail() / fromError() helpers eliminate boilerplate.
//
// NOTE: Existing server actions still import ActionResult from '@/types'.
// This file is the canonical definition for new code going forward.

import { AppError } from '@/shared/errors'

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string }

// ── Constructors ──────────────────────────────────────────────────────────────

export function ok(): ActionResult<void>
export function ok<T>(data: T): ActionResult<T>
export function ok<T>(data?: T): ActionResult<T | void> {
  return { success: true, data: data as T }
}

export function fail(error: string, code?: string): ActionResult<never> {
  return { success: false, error, code }
}

export function fromError(e: unknown): ActionResult<never> {
  if (e instanceof AppError) {
    return fail(e.message, e.code)
  }
  if (e instanceof Error) {
    return fail(e.message)
  }
  return fail('An unexpected error occurred')
}
