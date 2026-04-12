"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/interactions.ts
// ─── Order Interaction Server Actions ───────────────────────────────────────
// Cancellation requests, returns, partial refunds — all negotiation workflows.

import { requireUser } from "@/server/lib/requireUser";
import type { ActionResult } from "@/types";
import { interactionWorkflowService } from "@/modules/orders/interaction-workflow.instance";
import {
  requestCancellationSchema,
  respondToCancellationSchema,
  requestReturnSchema,
  respondToReturnSchema,
  requestPartialRefundSchema,
  respondToPartialRefundSchema,
  notifyShippingDelaySchema,
  respondToShippingDelaySchema,
} from "@/server/validators";

// ── requestCancellation ─────────────────────────────────────────────────────

export async function requestCancellation(
  raw: unknown,
): Promise<ActionResult<{ autoApproved: boolean; interactionId?: string }>> {
  try {
    const user = await requireUser();
    const parsed = requestCancellationSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    const result = await interactionWorkflowService.requestCancellation(
      user.id,
      parsed.data.orderId,
      parsed.data.reason,
    );

    if (!result.ok) return { success: false, error: result.error };
    return { success: true, data: result.data };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't process your cancellation request. Please try again.",
      ),
    };
  }
}

// ── respondToCancellation ───────────────────────────────────────────────────

export async function respondToCancellation(
  raw: unknown,
): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();
    const parsed = respondToCancellationSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    const result = await interactionWorkflowService.respondToCancellation(
      user.id,
      parsed.data.interactionId,
      parsed.data.action,
      parsed.data.responseNote,
    );

    if (!result.ok) return { success: false, error: result.error };
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't process your response. Please try again.",
      ),
    };
  }
}

// ── requestReturn ───────────────────────────────────────────────────────────

export async function requestReturn(
  raw: unknown,
): Promise<ActionResult<{ interactionId: string }>> {
  try {
    const user = await requireUser();
    const parsed = requestReturnSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    const result = await interactionWorkflowService.requestReturn(
      user.id,
      parsed.data.orderId,
      parsed.data.reason,
      parsed.data.details,
    );

    if (!result.ok) return { success: false, error: result.error };
    return { success: true, data: result.data };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't process your return request. Please try again.",
      ),
    };
  }
}

// ── respondToReturn ─────────────────────────────────────────────────────────

export async function respondToReturn(
  raw: unknown,
): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();
    const parsed = respondToReturnSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    const result = await interactionWorkflowService.respondToReturn(
      user.id,
      parsed.data.interactionId,
      parsed.data.action,
      parsed.data.responseNote,
    );

    if (!result.ok) return { success: false, error: result.error };
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't process your response. Please try again.",
      ),
    };
  }
}

// ── requestPartialRefund ────────────────────────────────────────────────────

export async function requestPartialRefund(
  raw: unknown,
): Promise<ActionResult<{ interactionId: string }>> {
  try {
    const user = await requireUser();
    const parsed = requestPartialRefundSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    const result = await interactionWorkflowService.requestPartialRefund(
      user.id,
      parsed.data.orderId,
      parsed.data.reason,
      parsed.data.amount,
    );

    if (!result.ok) return { success: false, error: result.error };
    return { success: true, data: result.data };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't process your partial refund request. Please try again.",
      ),
    };
  }
}

// ── respondToPartialRefund ──────────────────────────────────────────────────

export async function respondToPartialRefund(
  raw: unknown,
): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();
    const parsed = respondToPartialRefundSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    const result = await interactionWorkflowService.respondToPartialRefund(
      user.id,
      parsed.data.interactionId,
      parsed.data.action,
      parsed.data.responseNote,
      parsed.data.counterAmount,
    );

    if (!result.ok) return { success: false, error: result.error };
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't process your response. Please try again.",
      ),
    };
  }
}

// ── notifyShippingDelay ─────────────────────────────────────────────────────

export async function notifyShippingDelay(
  raw: unknown,
): Promise<ActionResult<{ interactionId: string }>> {
  try {
    const user = await requireUser();
    const parsed = notifyShippingDelaySchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    const result = await interactionWorkflowService.notifyShippingDelay(
      user.id,
      parsed.data.orderId,
      parsed.data.reason,
      parsed.data.estimatedNewDate,
    );

    if (!result.ok) return { success: false, error: result.error };
    return { success: true, data: result.data };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't process your shipping delay notification. Please try again.",
      ),
    };
  }
}

// ── respondToShippingDelay ──────────────────────────────────────────────────

export async function respondToShippingDelay(
  raw: unknown,
): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();
    const parsed = respondToShippingDelaySchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    const result = await interactionWorkflowService.respondToShippingDelay(
      user.id,
      parsed.data.interactionId,
      parsed.data.action,
      parsed.data.responseNote,
    );

    if (!result.ok) return { success: false, error: result.error };
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't process your response. Please try again.",
      ),
    };
  }
}

// ── getOrderInteractions ────────────────────────────────────────────────────

export interface InteractionData {
  id: string;
  type: string;
  status: string;
  initiatorRole: string;
  reason: string;
  details: Record<string, unknown> | null;
  responseNote: string | null;
  expiresAt: string;
  autoAction: string;
  resolvedAt: string | null;
  resolution: string | null;
  createdAt: string;
  initiator: { id: string; displayName: string | null; username: string };
  responder: {
    id: string;
    displayName: string | null;
    username: string;
  } | null;
}

export async function getOrderInteractions(
  orderId: string,
): Promise<ActionResult<InteractionData[]>> {
  try {
    const user = await requireUser();

    const result = await interactionWorkflowService.getOrderInteractions(
      orderId,
      user.id,
      user.isAdmin,
    );

    if (!result.ok) return { success: false, error: result.error };
    return { success: true, data: result.data };
  } catch {
    return {
      success: false,
      error: "Could not load order interactions.",
    };
  }
}
