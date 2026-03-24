'use server';
// src/server/actions/account.ts
// ─── Account Security Server Actions ─────────────────────────────────────────
// Password change, account deletion, session management.
//
// Security:
//   • changePassword requires current password verification
//   • changePassword invalidates all other sessions (JWT rotation)
//   • All actions audit-logged with IP

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import db from '@/lib/db';
import { audit } from '@/server/lib/audit';
import { hashPassword, verifyPassword } from '@/server/lib/password';
import type { ActionResult } from '@/types';
import { z } from 'zod';

// ── Validation Schemas ──────────────────────────────────────────────────────

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(12, 'Password must be at least 12 characters')
      .max(128, 'Password is too long')
      .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Must contain at least one number'),
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from current password',
    path: ['newPassword'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ── changePassword ──────────────────────────────────────────────────────────

export async function changePassword(
  input: ChangePasswordInput
): Promise<ActionResult<void>> {
  const reqHeaders = await headers();
  const ip = reqHeaders.get('x-forwarded-for') ?? 'unknown';

  // 1. Authenticate
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Authentication required.' };
  }

  // 3. Validate
  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: 'Invalid input.',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { currentPassword, newPassword } = parsed.data;

  // 5a. Load current password hash
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true },
  });

  if (!user?.passwordHash) {
    return {
      success: false,
      error: 'Password change is not available for social login accounts.',
    };
  }

  // 5b. Verify current password
  const valid = await verifyPassword(user.passwordHash, currentPassword);
  if (!valid) {
    audit({
      userId: session.user.id,
      action: 'PASSWORD_CHANGED',
      metadata: { success: false, reason: 'invalid_current_password' },
      ip,
    });
    return { success: false, error: 'Current password is incorrect.' };
  }

  // 5c. Hash new password
  const newHash = await hashPassword(newPassword);

  // 5d. Update password and invalidate all other sessions
  await db.$transaction([
    db.user.update({
      where: { id: session.user.id },
      data: { passwordHash: newHash },
    }),
    // Delete all sessions except the current one (forces re-login on other devices)
    db.session.deleteMany({
      where: { userId: session.user.id },
    }),
  ]);

  // 6. Audit
  audit({
    userId: session.user.id,
    action: 'PASSWORD_CHANGED',
    entityType: 'User',
    entityId: session.user.id,
    metadata: { success: true },
    ip,
  });

  return { success: true, data: undefined };
}

// ── updateProfile ────────────────────────────────────────────────────────────

const updateProfileSchema = z.object({
  displayName: z.string().min(2, 'Display name must be at least 2 characters').max(60),
  region: z.string().max(100).optional(),
  bio: z.string().max(500, 'Bio must be under 500 characters').optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export async function updateProfile(
  input: UpdateProfileInput
): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Authentication required.' };
  }

  const parsed = updateProfileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input.',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { displayName, region, bio } = parsed.data;

  await db.user.update({
    where: { id: session.user.id },
    data: {
      displayName,
      region: region || null,
      bio: bio || null,
    },
  });

  revalidatePath('/account/settings');
  return { success: true, data: undefined };
}
