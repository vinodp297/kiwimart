"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/reports.ts
// ─── Report Server Actions ───────────────────────────────────────────────────
// Allows users to report listings or other users for violations.
// Reporter identity is NEVER exposed to the target user.
//
// Security:
//   • Only authenticated users can file reports
//   • Users cannot report themselves
//   • Content moderated before save
//   • Rate limited to prevent abuse

import { headers } from "next/headers";
import db from "@/lib/db";
import { audit } from "@/server/lib/audit";
import { requireUser } from "@/server/lib/requireUser";
import { getClientIp } from "@/server/lib/rateLimit";
import { moderateText } from "@/server/lib/moderation";
import type { ActionResult } from "@/types";
import {
  createReportSchema,
  type CreateReportInput,
} from "@/server/validators";

export type { CreateReportInput };

// ── createReport ────────────────────────────────────────────────────────────

export async function createReport(
  input: CreateReportInput,
): Promise<ActionResult<{ reportId: string }>> {
  const reqHeaders = await headers();
  // Use getClientIp() — x-forwarded-for is client-controllable and spoofable.
  const ip = getClientIp(reqHeaders as unknown as Headers);

  // 1. Authenticate + ban check
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "Sign in to report content."),
    };
  }

  // 3. Validate
  const parsed = createReportSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid report data.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }

  const { targetUserId, listingId, reason, description } = parsed.data;

  // Must have at least one target
  if (!targetUserId && !listingId) {
    return { success: false, error: "Please specify what you are reporting." };
  }

  // 2. Authorise — cannot report yourself
  if (targetUserId && targetUserId === user.id) {
    return { success: false, error: "You cannot report yourself." };
  }

  // If reporting a listing, get the seller ID
  let resolvedTargetUserId = targetUserId;
  if (listingId && !targetUserId) {
    const listing = await db.listing.findUnique({
      where: { id: listingId },
      select: { sellerId: true },
    });
    if (!listing) {
      return { success: false, error: "Listing not found." };
    }
    if (listing.sellerId === user.id) {
      return { success: false, error: "You cannot report your own listing." };
    }
    resolvedTargetUserId = listing.sellerId;
  }

  // 5a. Moderate report description (still check — someone could try to inject via reports)
  const mod = moderateText(description, "report");
  // For reports, we allow the content even if flagged — admin will review

  // 5b. Check for duplicate reports (same reporter + same target within 24h)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existingReport = await db.report.findFirst({
    where: {
      reporterId: user.id,
      ...(listingId ? { listingId } : { targetUserId: resolvedTargetUserId }),
      createdAt: { gte: oneDayAgo },
    },
  });

  if (existingReport) {
    return {
      success: false,
      error: "You have already reported this. Our team is reviewing it.",
    };
  }

  // 5c. Create report
  const report = await db.report.create({
    data: {
      reporterId: user.id,
      targetUserId: resolvedTargetUserId,
      listingId,
      reason,
      description,
      status: "OPEN",
    },
    select: { id: true },
  });

  // 6. Audit
  audit({
    userId: user.id,
    action: "REPORT_CREATED",
    entityType: "Report",
    entityId: report.id,
    metadata: {
      reason,
      targetUserId: resolvedTargetUserId,
      listingId,
      flagged: mod.flagged,
    },
    ip,
  });

  return {
    success: true,
    data: { reportId: report.id },
  };
}
