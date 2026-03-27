'use server';
import { safeActionError } from '@/shared/errors'
// src/server/actions/blocks.ts
// ─── Block User Actions ───────────────────────────────────────────────────────

import { revalidatePath } from 'next/cache';
import db from '@/lib/db';
import { requireUser } from '@/server/lib/requireUser';
import type { ActionResult } from '@/types';

export async function blockUser(
  targetUserId: string
): Promise<ActionResult<{ message: string }>> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    return { success: false, error: safeActionError(err, 'Sign in to block users.') };
  }

  if (user.id === targetUserId) {
    return { success: false, error: 'Cannot block yourself.' };
  }

  const target = await db.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, displayName: true },
  });

  if (!target) {
    return { success: false, error: 'User not found.' };
  }

  await db.blockedUser.upsert({
    where: { blockerId_blockedId: { blockerId: user.id, blockedId: targetUserId } },
    create: { blockerId: user.id, blockedId: targetUserId },
    update: {},
  });

  revalidatePath('/account/settings');
  return { success: true, data: { message: `${target.displayName} blocked.` } };
}

export async function unblockUser(
  targetUserId: string
): Promise<ActionResult<void>> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    return { success: false, error: safeActionError(err, 'Sign in to unblock users.') };
  }

  await db.blockedUser.deleteMany({
    where: { blockerId: user.id, blockedId: targetUserId },
  });

  revalidatePath('/account/settings');
  return { success: true, data: undefined };
}
