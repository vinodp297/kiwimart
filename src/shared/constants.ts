// src/shared/constants.ts
// ─── Shared Constants ────────────────────────────────────────────────────────
// Values used by both server actions and client components.
// NOT a "use server" file — safe to export plain values.

export const VALID_COURIERS = [
  "NZ Post",
  "CourierPost",
  "Aramex",
  "Post Haste",
  "Castle Parcels",
  "Other",
] as const;
