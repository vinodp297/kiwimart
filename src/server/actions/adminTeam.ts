"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/adminTeam.ts
// ─── Admin Team Management Actions ───────────────────────────────────────────

import { requireSuperAdmin } from "@/shared/auth/requirePermission";
import db from "@/lib/db";
import { getEmailClient, EMAIL_FROM } from "@/infrastructure/email/client";
import { logger } from "@/shared/logger";
import { getRoleDisplayName } from "@/lib/permissions";
import crypto from "crypto";
import type { AdminRole } from "@prisma/client";
import type { ActionResult } from "@/types";

export async function inviteAdmin(
  email: string,
  role: AdminRole,
): Promise<ActionResult<void>> {
  try {
    const admin = await requireSuperAdmin();

    // Check email not already an admin
    const existing = await db.user.findUnique({
      where: { email },
      select: { isAdmin: true },
    });
    if (existing?.isAdmin) {
      return { success: false, error: "This user is already an admin" };
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    // Upsert — replace any existing pending invitation for this email.
    // Store SHA-256 hash of the token; raw token sent in email only, never persisted.
    await db.adminInvitation.upsert({
      where: { email },
      create: {
        email,
        adminRole: role,
        invitedBy: admin.id,
        tokenHash,
        expiresAt,
      },
      update: {
        adminRole: role,
        invitedBy: admin.id,
        tokenHash,
        expiresAt,
        acceptedAt: null,
      },
    });

    // Send invitation email (non-blocking) — raw token in the URL, never stored in DB
    sendInvitationEmail({
      to: email,
      inviterName: admin.displayName,
      role,
      token: rawToken,
      expiresAt,
    }).catch((err) =>
      logger.error("admin.invitation.email.failed", { err, email }),
    );

    logger.info("admin.invitation.sent", {
      invitedEmail: email,
      role,
      invitedBy: admin.id,
    });
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "The invitation couldn't be sent. Please try again.",
      ),
    };
  }
}

export async function changeAdminRole(
  targetUserId: string,
  newRole: AdminRole,
): Promise<ActionResult<void>> {
  try {
    const admin = await requireSuperAdmin();

    if (targetUserId === admin.id) {
      return { success: false, error: "Cannot change your own role" };
    }

    await db.user.update({
      where: { id: targetUserId },
      data: { adminRole: newRole },
    });

    logger.info("admin.role.changed", {
      targetUserId,
      newRole,
      changedBy: admin.id,
    });
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "The role change couldn't be saved. Please try again.",
      ),
    };
  }
}

export async function revokeAdminAccess(
  targetUserId: string,
): Promise<ActionResult<void>> {
  try {
    const admin = await requireSuperAdmin();

    if (targetUserId === admin.id) {
      return { success: false, error: "Cannot revoke your own admin access" };
    }

    await db.user.update({
      where: { id: targetUserId },
      data: { isAdmin: false, adminRole: null },
    });

    logger.info("admin.access.revoked", { targetUserId, revokedBy: admin.id });
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "Access couldn't be revoked. Please try again.",
      ),
    };
  }
}

async function sendInvitationEmail(params: {
  to: string;
  inviterName: string;
  role: AdminRole;
  token: string;
  expiresAt: Date;
}) {
  const resend = getEmailClient();
  if (!resend) return;

  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/admin/accept-invite?token=${params.token}`;

  await resend.emails.send({
    from: EMAIL_FROM,
    to: params.to,
    subject: `You have been invited to join ${process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"} as ${getRoleDisplayName(params.role)}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <h2 style="color:#141414;">${process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"} Team Invitation</h2>
        <p style="color:#73706A;">
          ${params.inviterName} has invited you to join the ${process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"} admin team as
          <strong>${getRoleDisplayName(params.role)}</strong>.
        </p>
        <div style="background:#FFF9EC;border-radius:12px;padding:20px;margin:20px 0;border-left:4px solid #D4A843;">
          <p style="margin:0;font-size:14px;color:#141414;">
            <strong>Role:</strong> ${getRoleDisplayName(params.role)}<br/>
            <strong>Invited by:</strong> ${params.inviterName}<br/>
            <strong>Expires:</strong> ${params.expiresAt.toLocaleDateString("en-NZ")}
          </p>
        </div>
        <a href="${inviteUrl}"
          style="display:inline-block;background:#D4A843;color:#141414;padding:12px 24px;
            border-radius:50px;text-decoration:none;font-weight:600;margin-top:10px;">
          Accept Invitation →
        </a>
        <p style="color:#C9C5BC;font-size:12px;margin-top:20px;">
          This invitation expires in 48 hours. If you did not expect this email, please ignore it.
        </p>
      </div>
    `,
  });
}
