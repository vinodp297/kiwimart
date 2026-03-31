"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/admin.ts — thin wrapper
// Business logic delegated to AdminService.

import { requirePermission } from "@/shared/auth/requirePermission";
import { adminService } from "@/modules/admin/admin.service";
import type { ActionResult } from "@/types";
import {
  banUserSchema as BanUserSchema,
  resolveReportSchema as ResolveReportSchema,
  resolveDisputeSchema as ResolveDisputeSchema,
  partialRefundSchema as PartialRefundSchema,
  overrideSchema as OverrideSchema,
  requestInfoSchema as RequestInfoSchema,
  flagFraudSchema as FlagFraudSchema,
} from "@/server/validators";

export async function banUser(
  userId: string,
  reason: string,
): Promise<ActionResult<void>> {
  const parsed = BanUserSchema.safeParse({ userId, reason });
  if (!parsed.success)
    return {
      success: false,
      error:
        parsed.error.issues[0]?.message ??
        "Please check your input and try again.",
    };
  try {
    const admin = await requirePermission("BAN_USERS");
    await adminService.banUser(
      parsed.data.userId,
      parsed.data.reason,
      admin.id,
    );
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "The ban action failed. Please try again."),
    };
  }
}

export async function unbanUser(userId: string): Promise<ActionResult<void>> {
  if (!userId || typeof userId !== "string")
    return { success: false, error: "Invalid user ID." };
  try {
    const admin = await requirePermission("UNBAN_USERS");
    await adminService.unbanUser(userId, admin.id);
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "The unban action failed. Please try again."),
    };
  }
}

export async function toggleSellerEnabled(
  userId: string,
): Promise<ActionResult<void>> {
  try {
    const admin = await requirePermission("APPROVE_SELLERS");
    await adminService.toggleSellerEnabled(userId, admin.id);
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "The seller status change failed. Please try again.",
      ),
    };
  }
}

export async function resolveReport(
  reportId: string,
  action: "dismiss" | "remove" | "ban",
): Promise<ActionResult<void>> {
  const parsed = ResolveReportSchema.safeParse({ reportId, action });
  if (!parsed.success)
    return {
      success: false,
      error:
        parsed.error.issues[0]?.message ??
        "Please check your input and try again.",
    };
  try {
    const admin = await requirePermission("MODERATE_CONTENT");
    await adminService.resolveReport(
      parsed.data.reportId,
      parsed.data.action,
      admin.id,
    );
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "The report couldn't be resolved. Please try again.",
      ),
    };
  }
}

export async function resolveDispute(
  orderId: string,
  favour: "buyer" | "seller",
): Promise<ActionResult<void>> {
  const parsed = ResolveDisputeSchema.safeParse({ orderId, favour });
  if (!parsed.success)
    return {
      success: false,
      error:
        parsed.error.issues[0]?.message ??
        "Please check your input and try again.",
    };
  try {
    const admin = await requirePermission("RESOLVE_DISPUTES");
    await adminService.resolveDispute(
      parsed.data.orderId,
      parsed.data.favour,
      admin.id,
    );
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "The dispute couldn't be resolved. Please try again.",
      ),
    };
  }
}

export async function resolveDisputePartialRefund(
  raw: unknown,
): Promise<ActionResult<void>> {
  const parsed = PartialRefundSchema.safeParse(raw);
  if (!parsed.success)
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  try {
    const admin = await requirePermission("RESOLVE_DISPUTES");
    await adminService.resolveDisputePartialRefund(
      parsed.data.orderId,
      parsed.data.amountCents,
      parsed.data.reason,
      admin.id,
    );
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "Partial refund failed. Please try again."),
    };
  }
}

export async function overrideAutoResolution(
  raw: unknown,
): Promise<ActionResult<void>> {
  const parsed = OverrideSchema.safeParse(raw);
  if (!parsed.success)
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  try {
    const admin = await requirePermission("RESOLVE_DISPUTES");
    await adminService.overrideAutoResolution(
      parsed.data.orderId,
      parsed.data.newDecision,
      parsed.data.reason,
      admin.id,
      parsed.data.partialAmountCents,
    );
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "Override failed. Please try again."),
    };
  }
}

export async function requestMoreInfo(
  raw: unknown,
): Promise<ActionResult<void>> {
  const parsed = RequestInfoSchema.safeParse(raw);
  if (!parsed.success)
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  try {
    const admin = await requirePermission("RESOLVE_DISPUTES");
    await adminService.requestMoreInfo(
      parsed.data.orderId,
      parsed.data.target,
      parsed.data.message,
      admin.id,
    );
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "Request failed. Please try again."),
    };
  }
}

export async function flagUserForFraud(
  raw: unknown,
): Promise<ActionResult<void>> {
  const parsed = FlagFraudSchema.safeParse(raw);
  if (!parsed.success)
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  try {
    const admin = await requirePermission("RESOLVE_DISPUTES");
    await adminService.flagUserForFraud(
      parsed.data.userId,
      parsed.data.orderId,
      parsed.data.reason,
      admin.id,
    );
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "Flag failed. Please try again."),
    };
  }
}
