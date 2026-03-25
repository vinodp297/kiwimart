'use server';
// src/server/actions/verification.ts — thin wrapper
// Business logic delegated to UserService.

import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { userService } from '@/modules/users/user.service';
import type { ActionResult } from '@/types';

export async function requestPhoneVerification(params: {
  phone: string;
}): Promise<ActionResult<{ expiresAt: string }>> {
  try {
    const reqHeaders = await headers();
    const ip = reqHeaders.get('x-forwarded-for') ?? 'unknown';
    const session = await auth();
    if (!session?.user?.id) return { success: false, error: 'Authentication required.' };

    const result = await userService.requestPhoneVerification(session.user.id, params.phone, ip);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred.' };
  }
}

export async function verifyPhoneCode(params: {
  code: string;
}): Promise<ActionResult<void>> {
  try {
    const reqHeaders = await headers();
    const ip = reqHeaders.get('x-forwarded-for') ?? 'unknown';
    const session = await auth();
    if (!session?.user?.id) return { success: false, error: 'Authentication required.' };

    await userService.verifyPhoneCode(session.user.id, params.code, ip);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred.' };
  }
}
