// src/lib/auth-constants.ts
// ─── Shared Auth TTL Constants ────────────────────────────────────────────────
// Single source of truth for all auth-related time-to-live values.
// Import from here rather than hardcoding 60 * 60 * 24 * N anywhere.
//
// Why: mismatched TTL comments and values have caused incidents before
// (e.g. a "30-day" comment on a 7-day token). Centralising here makes
// discrepancies impossible to miss.

import { SECONDS_PER_DAY } from "@/lib/time";

/** Mobile JWT Bearer token lifetime — 7 days in seconds.
 *  Must match the `EXPIRY = "7d"` string in mobile-auth.ts. */
export const MOBILE_TOKEN_TTL_SECONDS = SECONDS_PER_DAY * 7; // 604 800

/** Redis session-version key lifetime — 30 days in seconds.
 *  Matches the longest-lived web session cookie supported by Auth.js. */
export const WEB_SESSION_TTL_SECONDS = SECONDS_PER_DAY * 30; // 2 592 000
