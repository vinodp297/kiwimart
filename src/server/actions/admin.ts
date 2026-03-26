'use server';
// src/server/actions/admin.ts — thin wrapper
// Business logic delegated to AdminService.

import { requirePermission } from '@/shared/auth/requirePermission';
import { adminService } from '@/modules/admin/admin.service';
import type { ActionResult } from '@/types';
import { z } from 'zod';

const BanUserSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  reason: z.string().min(10, 'Ban reason must be at least 10 characters').max(500),
});

const ResolveReportSchema = z.object({
  reportId: z.string().min(1, 'Report ID is required'),
  action: z.enum(['dismiss', 'remove', 'ban']),
});

const ResolveDisputeSchema = z.object({
  orderId: z.string().min(1, 'Order ID is required'),
  favour: z.enum(['buyer', 'seller']),
});

export async function banUser(
  userId: string,
  reason: string
): Promise<ActionResult<void>> {
  const parsed = BanUserSchema.safeParse({ userId, reason });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };
  try {
    const admin = await requirePermission('BAN_USERS');
    await adminService.banUser(parsed.data.userId, parsed.data.reason, admin.id);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred.' };
  }
}

export async function unbanUser(userId: string): Promise<ActionResult<void>> {
  if (!userId || typeof userId !== 'string') return { success: false, error: 'Invalid user ID.' };
  try {
    const admin = await requirePermission('UNBAN_USERS');
    await adminService.unbanUser(userId, admin.id);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred.' };
  }
}

export async function toggleSellerEnabled(
  userId: string
): Promise<ActionResult<void>> {
  try {
    const admin = await requirePermission('APPROVE_SELLERS');
    await adminService.toggleSellerEnabled(userId, admin.id);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred.' };
  }
}

export async function resolveReport(
  reportId: string,
  action: 'dismiss' | 'remove' | 'ban'
): Promise<ActionResult<void>> {
  const parsed = ResolveReportSchema.safeParse({ reportId, action });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };
  try {
    const admin = await requirePermission('MODERATE_CONTENT');
    await adminService.resolveReport(parsed.data.reportId, parsed.data.action, admin.id);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred.' };
  }
}

export async function resolveDispute(
  orderId: string,
  favour: 'buyer' | 'seller'
): Promise<ActionResult<void>> {
  const parsed = ResolveDisputeSchema.safeParse({ orderId, favour });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };
  try {
    const admin = await requirePermission('RESOLVE_DISPUTES');
    await adminService.resolveDispute(parsed.data.orderId, parsed.data.favour, admin.id);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred.' };
  }
}
