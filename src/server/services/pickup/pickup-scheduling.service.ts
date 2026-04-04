// src/server/services/pickup/pickup-scheduling.service.ts
// ─── Re-export barrel ─────────────────────────────────────────────────────────
// All pickup scheduling logic has been split into focused service files.
// This barrel preserves backwards compatibility for any remaining import paths.

export type { PickupResult } from "./pickup-scheduling.types";
export { proposePickupTime, acceptPickupTime } from "./pickup-proposal.service";
export { requestReschedule } from "./pickup-reschedule.service";
export { respondToReschedule } from "./pickup-reschedule-respond.service";
export { cancelPickupOrder } from "./pickup-cancel.service";
