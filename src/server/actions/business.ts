"use server";
// src/server/actions/business.ts
// ─── Business Details (NZBN/GST) Server Action ──────────────────────────────

import { headers } from "next/headers";
import { userRepository } from "@/modules/users/user.repository";
import { requireUser } from "@/server/lib/requireUser";
import { audit } from "@/server/lib/audit";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";
import { updateBusinessDetailsSchema } from "@/server/validators";
import { safeActionError } from "@/shared/errors";
import type { ActionResult } from "@/types";

export async function updateBusinessDetails(
  raw: unknown,
): Promise<ActionResult<void>> {
  try {
    let user: Awaited<ReturnType<typeof requireUser>>;
    try {
      user = await requireUser();
    } catch (err) {
      return { success: false, error: safeActionError(err, "Unauthorised.") };
    }

    if (!user.isSellerEnabled) {
      return {
        success: false,
        error: "Seller access is not enabled on your account.",
      };
    }

    const ip = getClientIp(await headers());
    const limit = await rateLimit("auth", `business:${user.id}`);
    if (!limit.success) {
      return {
        success: false,
        error: "Too many requests. Please try again in a few minutes.",
      };
    }

    const parsed = updateBusinessDetailsSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          "Please check your input and try again.",
      };
    }

    const { isBusinessSeller, nzbn, isGstRegistered, gstNumber } = parsed.data;

    if (isBusinessSeller) {
      if (!nzbn) {
        return {
          success: false,
          error: "NZBN is required for business sellers.",
        };
      }

      // Check NZBN uniqueness (another user may have it)
      if (nzbn) {
        const nzbnTaken = await userRepository.existsByNzbn(nzbn, user.id);
        if (nzbnTaken) {
          return {
            success: false,
            error: "This NZBN is already registered to another account.",
          };
        }
      }

      await userRepository.update(user.id, {
        nzbn,
        isGstRegistered,
        gstNumber: isGstRegistered && gstNumber ? gstNumber : null,
      });
    } else {
      // Clear business fields
      await userRepository.update(user.id, {
        nzbn: null,
        isGstRegistered: false,
        gstNumber: null,
      });
    }

    audit({
      userId: user.id,
      action: "BUSINESS_DETAILS_UPDATED" as const,
      entityType: "User",
      entityId: user.id,
      metadata: { isBusinessSeller, nzbn: nzbn || null, isGstRegistered },
      ip,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "Failed to update business details."),
    };
  }
}
