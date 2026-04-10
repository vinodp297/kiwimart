// src/app/api/v1/me/nav-summary/route.ts
// GET /api/v1/me/nav-summary — batched navbar data (cart + notifications + user)
// Replaces three separate calls: /api/notifications, /api/cart, session.user

import { auth } from "@/lib/auth";
import { userService } from "@/modules/users/user.service";
import { cartRepository } from "@/modules/cart/cart.repository";
import { notificationRepository } from "@/modules/notifications/notification.repository";
import { apiOk, apiError } from "../../_helpers/response";
import { getCorsHeaders, withCors } from "../../_helpers/cors";
import { handleRouteError } from "@/server/lib/handle-route-error";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = request.headers.get("origin");

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return withCors(apiError("Unauthorised", 401), origin);
    }

    const userId = session.user.id;

    // Parallel fetch — all three are independent reads
    const [notifications, unreadCount, cart, user] = await Promise.all([
      notificationRepository.findByUser(userId, 10),
      notificationRepository.countUnread(userId),
      cartRepository.findByUserCount(userId),
      userService.getNavSummaryUser(userId),
    ]);

    // Cart count — 0 if no cart or expired
    const cartCount =
      cart && new Date(cart.expiresAt) >= new Date() ? cart._count.items : 0;

    const response = withCors(
      apiOk({
        cartCount,
        unreadNotificationCount: unreadCount,
        notifications,
        user: user
          ? {
              id: user.id,
              name: user.displayName,
              email: user.email,
              role: user.isAdmin ? "ADMIN" : "USER",
              avatarUrl: user.avatarKey ?? null,
              isAdmin: user.isAdmin,
              isSellerEnabled: user.isSellerEnabled,
              isMfaEnabled: user.isMfaEnabled,
            }
          : null,
      }),
      origin,
    );

    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (e) {
    return withCors(
      handleRouteError(e, { path: "/api/v1/me/nav-summary" }),
      origin,
    );
  }
}

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request.headers.get("origin")),
  });
}
