"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/admin.ts — thin wrapper
// Business logic delegated to AdminService.

import { requirePermission } from "@/shared/auth/requirePermission";
import { requireStepUpAuth } from "@/server/lib/requireStepUpAuth";
import { rateLimit } from "@/server/lib/rateLimit";
import { logger } from "@/shared/logger";
import { adminService } from "@/modules/admin/admin.service";
import { userRepository } from "@/modules/users/user.repository";
import { audit } from "@/server/lib/audit";
import { createNotification } from "@/modules/notifications/notification.service";
import { fireAndForget } from "@/lib/fire-and-forget";
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
    if (parsed.data.userId === admin.id) {
      return { success: false, error: "You cannot ban your own account." };
    }
    // Rate limit — 10 ban/unban actions per hour per admin (keyed by admin ID)
    try {
      const limit = await rateLimit("adminBan", `admin:${admin.id}:banUser`);
      if (!limit.success) {
        return {
          success: false,
          error: "Too many requests. Please slow down.",
        };
      }
    } catch (rlErr) {
      logger.warn("admin:rate-limit-unavailable", {
        action: "banUser",
        adminId: admin.id,
        error: rlErr instanceof Error ? rlErr.message : String(rlErr),
      });
      // Fail open — allow the action if rate limiter is unavailable
    }
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
    // Rate limit — 10 ban/unban actions per hour per admin (keyed by admin ID)
    try {
      const limit = await rateLimit("adminBan", `admin:${admin.id}:unbanUser`);
      if (!limit.success) {
        return {
          success: false,
          error: "Too many requests. Please slow down.",
        };
      }
    } catch (rlErr) {
      logger.warn("admin:rate-limit-unavailable", {
        action: "unbanUser",
        adminId: admin.id,
        error: rlErr instanceof Error ? rlErr.message : String(rlErr),
      });
      // Fail open — allow the action if rate limiter is unavailable
    }
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
    await requireStepUpAuth(admin.id, "refund");
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

// ── Seller Tier Override ─────────────────────────────────────────────────────

export async function setSellerTierOverride(params: {
  userId: string;
  tier: string | null;
  reason: string;
}): Promise<ActionResult<void>> {
  try {
    const admin = await requirePermission("BAN_USERS");
    const { userId, tier, reason } = params;

    if (tier !== null && !["BRONZE", "SILVER", "GOLD"].includes(tier)) {
      return {
        success: false,
        error: "Invalid tier. Must be BRONZE, SILVER, or GOLD.",
      };
    }

    if (tier !== null && reason.trim().length < 20) {
      return {
        success: false,
        error: "Reason must be at least 20 characters.",
      };
    }

    const user = await userRepository.findForTierOverride(userId);

    if (!user) return { success: false, error: "User not found." };

    const previousOverride = user.sellerTierOverride;

    if (tier === null) {
      await userRepository.update(userId, {
        sellerTierOverride: null,
        sellerTierOverrideReason: null,
        sellerTierOverrideAt: null,
        sellerTierOverrideBy: null,
      });

      audit({
        userId: admin.id,
        action: "SELLER_TIER_OVERRIDE_REMOVED",
        entityType: "User",
        entityId: userId,
        metadata: { previousOverride, removedBy: admin.id },
      });

      fireAndForget(
        createNotification({
          userId,
          type: "SYSTEM",
          title: "Your seller tier has been restored",
          body: "Your seller tier has been restored. Contact support with any questions.",
          link: "/dashboard/seller",
        }),
        "admin.sellerTierOverride.removedNotification",
        { userId },
      );
    } else {
      await userRepository.update(userId, {
        sellerTierOverride: tier,
        sellerTierOverrideReason: reason.trim(),
        sellerTierOverrideAt: new Date(),
        sellerTierOverrideBy: admin.id,
      });

      audit({
        userId: admin.id,
        action: "SELLER_TIER_OVERRIDE_SET",
        entityType: "User",
        entityId: userId,
        metadata: {
          previousOverride,
          newOverride: tier,
          reason: reason.trim(),
        },
      });

      fireAndForget(
        createNotification({
          userId,
          type: "SYSTEM",
          title: "Your seller tier has been adjusted",
          body: `Your seller tier has been adjusted by our team. Reason: ${reason.trim()}`,
          link: "/dashboard/seller",
        }),
        "admin.sellerTierOverride.setNotification",
        { userId },
      );
    }

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "Failed to update tier override. Please try again.",
      ),
    };
  }
}
