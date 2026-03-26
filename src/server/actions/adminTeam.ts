'use server';
// src/server/actions/adminTeam.ts
// ─── Admin Team Management Actions ───────────────────────────────────────────

import { requireSuperAdmin } from '@/shared/auth/requirePermission';
import db from '@/lib/db';
import { getEmailClient, EMAIL_FROM } from '@/infrastructure/email/client';
import { logger } from '@/shared/logger';
import { getRoleDisplayName } from '@/lib/permissions';
import crypto from 'crypto';
import type { AdminRole } from '@prisma/client';
import type { ActionResult } from '@/types';

export async function inviteAdmin(
  email: string,
  role: AdminRole
): Promise<ActionResult<void>> {
  try {
    const admin = await requireSuperAdmin();

    // Check email not already an admin
    const existing = await db.user.findUnique({
      where: { email },
      select: { isAdmin: true },
    });
    if (existing?.isAdmin) {
      return { success: false, error: 'This user is already an admin' };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    // Upsert — replace any existing pending invitation for this email
    await db.adminInvitation.upsert({
      where: { email },
      create: { email, adminRole: role, invitedBy: admin.id, token, expiresAt },
      update: { adminRole: role, invitedBy: admin.id, token, expiresAt, acceptedAt: null },
    });

    // Send invitation email (non-blocking)
    sendInvitationEmail({
      to: email,
      inviterName: admin.displayName,
      role,
      token,
      expiresAt,
    }).catch((err) => logger.error('admin.invitation.email.failed', { err, email }));

    logger.info('admin.invitation.sent', { invitedEmail: email, role, invitedBy: admin.id });
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'An unexpected error occurred.',
    };
  }
}

export async function changeAdminRole(
  targetUserId: string,
  newRole: AdminRole
): Promise<ActionResult<void>> {
  try {
    const admin = await requireSuperAdmin();

    if (targetUserId === admin.id) {
      return { success: false, error: 'Cannot change your own role' };
    }

    await db.user.update({
      where: { id: targetUserId },
      data: { adminRole: newRole },
    });

    logger.info('admin.role.changed', { targetUserId, newRole, changedBy: admin.id });
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'An unexpected error occurred.',
    };
  }
}

export async function revokeAdminAccess(targetUserId: string): Promise<ActionResult<void>> {
  try {
    const admin = await requireSuperAdmin();

    if (targetUserId === admin.id) {
      return { success: false, error: 'Cannot revoke your own admin access' };
    }

    await db.user.update({
      where: { id: targetUserId },
      data: { isAdmin: false, adminRole: null },
    });

    logger.info('admin.access.revoked', { targetUserId, revokedBy: admin.id });
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'An unexpected error occurred.',
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

  const inviteUrl =
    `${process.env.NEXT_PUBLIC_APP_URL}/admin/accept-invite?token=${params.token}`;

  await resend.emails.send({
    from: EMAIL_FROM,
    to: params.to,
    subject: `You have been invited to join KiwiMart as ${getRoleDisplayName(params.role)}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <h2 style="color:#141414;">KiwiMart Team Invitation</h2>
        <p style="color:#73706A;">
          ${params.inviterName} has invited you to join the KiwiMart admin team as
          <strong>${getRoleDisplayName(params.role)}</strong>.
        </p>
        <div style="background:#FFF9EC;border-radius:12px;padding:20px;margin:20px 0;border-left:4px solid #D4A843;">
          <p style="margin:0;font-size:14px;color:#141414;">
            <strong>Role:</strong> ${getRoleDisplayName(params.role)}<br/>
            <strong>Invited by:</strong> ${params.inviterName}<br/>
            <strong>Expires:</strong> ${params.expiresAt.toLocaleDateString('en-NZ')}
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
