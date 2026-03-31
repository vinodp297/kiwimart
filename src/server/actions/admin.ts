"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/admin.ts — thin wrapper
// Business logic delegated to AdminService.

import { requirePermission } from "@/shared/auth/requirePermission";
import { adminService } from "@/modules/admin/admin.service";
import type { ActionResult } from "@/types";
import { z } from "zod";

const BanUserSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  reason: z
    .string()
    .min(10, "Ban reason must be at least 10 characters")
    .max(500),
});

const ResolveReportSchema = z.object({
  reportId: z.string().min(1, "Report ID is required"),
  action: z.enum(["dismiss", "remove", "ban"]),
});

const ResolveDisputeSchema = z.object({
  orderId: z.string().min(1, "Order ID is required"),
  favour: z.enum(["buyer", "seller"]),
});

const PartialRefundSchema = z.object({
  orderId: z.string().min(1),
  amountCents: z.number().positive(),
  reason: z.string().min(5).max(500),
});

const OverrideSchema = z.object({
  orderId: z.string().min(1),
  newDecision: z.enum(["refund", "dismiss", "partial_refund"]),
  reason: z.string().min(5).max(500),
  partialAmountCents: z.number().positive().optional(),
});

const RequestInfoSchema = z.object({
  orderId: z.string().min(1),
  target: z.enum(["buyer", "seller", "both"]),
  message: z.string().min(10).max(1000),
});

const FlagFraudSchema = z.object({
  userId: z.string().min(1),
  orderId: z.string().min(1),
  reason: z.string().min(10).max(500),
});

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
