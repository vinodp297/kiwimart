'use server';
import { safeActionError } from '@/shared/errors'
// src/server/actions/verification.ts — thin wrapper
// Business logic delegated to UserService.

import { headers } from 'next/headers';
import { requireUser } from '@/server/lib/requireUser';
import { getClientIp } from '@/server/lib/rateLimit';
import { userService } from '@/modules/users/user.service';
import type { ActionResult } from '@/types';

export async function requestPhoneVerification(params: {
  phone: string;
}): Promise<ActionResult<{ expiresAt: string }>> {
  try {
    const reqHeaders = await headers();
    // Use getClientIp() — x-forwarded-for is client-controllable and spoofable.
    const ip = getClientIp(reqHeaders as unknown as Headers);
    const user = await requireUser();

    const result = await userService.requestPhoneVerification(user.id, params.phone, ip);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: safeActionError(err) };
  }
}

export async function verifyPhoneCode(params: {
  code: string;
}): Promise<ActionResult<void>> {
  try {
    const reqHeaders = await headers();
    // Use getClientIp() — x-forwarded-for is client-controllable and spoofable.
    const ip = getClientIp(reqHeaders as unknown as Headers);
    const user = await requireUser();

    await userService.verifyPhoneCode(user.id, params.code, ip);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: safeActionError(err) };
  }
}
