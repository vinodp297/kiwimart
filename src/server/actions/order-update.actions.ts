"use server";
// src/server/actions/order-update.actions.ts
// ─── Order state-transition server actions ────────────────────────────────────

import { safeActionError } from "@/shared/errors";
import { requireUser } from "@/server/lib/requireUser";
import type { ActionResult } from "@/types";
import { orderService } from "@/modules/orders/order.service";
import {
  confirmDeliverySchema as ConfirmDeliverySchema,
  markDispatchedSchema as MarkDispatchedSchema,
  cancelOrderSchema as CancelOrderSchema,
} from "@/server/validators";
import { getListValues } from "@/lib/dynamic-lists";

// ── confirmDelivery — releases escrow ────────────────────────────────────────

export async function confirmDelivery(
  orderId: string,
  feedback?: {
    itemAsDescribed: boolean;
    issueType?: string;
    deliveryPhotos?: string[];
    notes?: string;
  },
): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();
    const parsed = ConfirmDeliverySchema.safeParse({
      orderId,
      itemAsDescribed: feedback?.itemAsDescribed ?? true,
      issueType: feedback?.issueType,
      deliveryPhotos: feedback?.deliveryPhotos,
      notes: feedback?.notes,
    });
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    await orderService.confirmDelivery(parsed.data.orderId, user.id, {
      itemAsDescribed: parsed.data.itemAsDescribed,
      issueType: parsed.data.issueType,
      deliveryPhotos: parsed.data.deliveryPhotos,
      notes: parsed.data.notes,
    });
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't confirm delivery. Please try again.",
      ),
    };
  }
}

// ── cancelOrder — buyer/seller cancels order within time window ──────────────

export async function cancelOrder(params: {
  orderId: string;
  reason?: string;
}): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();
    const parsed = CancelOrderSchema.safeParse(params);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }
    await orderService.cancelOrder(
      parsed.data.orderId,
      user.id,
      parsed.data.reason,
    );
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't cancel this order. Please try again or contact support.",
      ),
    };
  }
}

// ── markDispatched — seller marks order dispatched ───────────────────────────

export async function markDispatched(params: {
  orderId: string;
  trackingNumber: string;
  courier: string;
  trackingUrl?: string;
  estimatedDeliveryDate: string;
  dispatchPhotos: string[];
}): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();
    const parsed = MarkDispatchedSchema.safeParse(params);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    const validCouriers = await getListValues("COURIERS");
    if (!validCouriers.includes(parsed.data.courier)) {
      return { success: false, error: "Invalid courier selection." };
    }

    await orderService.markDispatched(parsed.data, user.id);
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't update the dispatch status. Please try again.",
      ),
    };
  }
}
