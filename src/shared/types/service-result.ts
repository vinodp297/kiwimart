// src/shared/types/service-result.ts
// ─── Standardised ServiceResult<T> ──────────────────────────────────────────
// Discriminated-union return type for internal service methods.
// Uses `ok` (not `success`) to distinguish from ActionResult which is for
// server-action boundaries.
//
// Services that need extra failure metadata (e.g. cart price-drift) can
// intersect the failure branch:
//   type CartResult<T> = ServiceResult<T> & (
//     | { ok: true }
//     | { ok: false; requiresPriceConfirmation?: true; driftedItems?: DriftedItem[] }
//   );

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
