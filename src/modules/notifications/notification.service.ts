// src/modules/notifications/notification.service.ts
// ─── In-App Notification Service ─────────────────────────────────────────────
// Framework-free. Only imports db + logger.
// All callers must wrap this in fire-and-forget (non-blocking):
//   createNotification({...}).catch(() => {})

import {
  notificationRepository,
  type PushPlatform,
} from "./notification.repository";
import { logger } from "@/shared/logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotificationType =
  | "ORDER_PLACED"
  | "ORDER_DISPATCHED"
  | "ORDER_COMPLETED"
  | "ORDER_DISPUTED"
  | "MESSAGE_RECEIVED"
  | "OFFER_RECEIVED"
  | "OFFER_ACCEPTED"
  | "OFFER_DECLINED"
  | "PRICE_DROP"
  | "WATCHLIST_SOLD"
  | "ID_VERIFIED"
  | "LISTING_APPROVED"
  | "LISTING_NEEDS_CHANGES"
  | "LISTING_REJECTED"
  | "LISTING_UNDER_REVIEW"
  | "SYSTEM";

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  listingId?: string;
  orderId?: string;
  link?: string;
}

// ── Icon map (used by NavBar and /notifications page) ─────────────────────────

export const NOTIF_ICONS: Record<NotificationType, string> = {
  ORDER_PLACED: "🛍️",
  ORDER_DISPATCHED: "📦",
  ORDER_COMPLETED: "✅",
  ORDER_DISPUTED: "⚠️",
  MESSAGE_RECEIVED: "💬",
  OFFER_RECEIVED: "💰",
  OFFER_ACCEPTED: "🎉",
  OFFER_DECLINED: "❌",
  PRICE_DROP: "📉",
  WATCHLIST_SOLD: "🔔",
  ID_VERIFIED: "✅",
  LISTING_APPROVED: "✅",
  LISTING_NEEDS_CHANGES: "📝",
  LISTING_REJECTED: "🚫",
  LISTING_UNDER_REVIEW: "🔍",
  SYSTEM: "ℹ️",
};

export function getNotifIcon(type: string): string {
  return NOTIF_ICONS[type as NotificationType] ?? "🔔";
}

// ── createNotification ────────────────────────────────────────────────────────

export async function createNotification(
  input: CreateNotificationInput,
): Promise<void> {
  try {
    await notificationRepository.create({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      listingId: input.listingId ?? null,
      orderId: input.orderId ?? null,
      link: input.link ?? null,
      isRead: false,
    });
  } catch (err) {
    // Non-blocking — never fail main operation due to notification error
    logger.error("notification.create.failed", {
      userId: input.userId,
      type: input.type,
      error: err,
    });
  }
}

// ── Push token registration ───────────────────────────────────────────────────

/**
 * Register (or re-activate) a device push token for a user.
 * Uses upsert — safe to call on every app launch even if the token hasn't
 * changed. Tokens are never logged in full; only the first 8 characters
 * appear in diagnostics.
 */
export async function registerPushToken(
  userId: string,
  token: string,
  platform: PushPlatform,
  deviceId?: string,
): Promise<{ success: true }> {
  await notificationRepository.upsertPushToken(
    userId,
    token,
    platform,
    deviceId,
  );

  logger.info("push.token.registered", {
    userId,
    platform,
    deviceId,
    tokenPrefix: token.slice(0, 8),
  });

  return { success: true };
}

/**
 * Deactivate a push token (soft delete).
 * Called on sign-out or when the device unregisters.
 * The token row is retained for 90 days then purged by the cleanup job.
 */
export async function unregisterPushToken(
  token: string,
): Promise<{ success: true }> {
  await notificationRepository.deactivatePushToken(token);

  logger.info("push.token.unregistered", {
    tokenPrefix: token.slice(0, 8),
  });

  return { success: true };
}
