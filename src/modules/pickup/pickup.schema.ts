import { z } from "zod";

// ---------------------------------------------------------------------------
// Pickup API schemas — validates all request bodies at the API boundary.
// Field names match the existing route contracts; do not rename without
// updating the corresponding route handler.
// ---------------------------------------------------------------------------

export const proposePickupSchema = z.object({
  orderId: z.string().cuid(),
  proposedTime: z.string().datetime(),
});

export const acceptPickupSchema = z.object({
  orderId: z.string().cuid(),
  rescheduleRequestId: z.string().cuid().optional(),
});

export const cancelPickupSchema = z.object({
  orderId: z.string().cuid(),
  reason: z.string().min(1).max(500),
});

export const reschedulePickupSchema = z.object({
  orderId: z.string().cuid(),
  proposedTime: z.string().datetime(),
  sellerReason: z.string().optional(),
  buyerReason: z.string().optional(),
  reasonNote: z.string().max(1000).optional(),
});

export const rescheduleRespondSchema = z.object({
  orderId: z.string().cuid(),
  rescheduleRequestId: z.string().cuid(),
  response: z.enum(["ACCEPT", "REJECT", "PROPOSE_ALTERNATIVE"]),
  alternativeTime: z.string().datetime().optional(),
  responseNote: z.string().max(1000).optional(),
});
