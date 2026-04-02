// src/app/api/v1/pickup/propose/route.ts
// POST /api/v1/pickup/propose — Propose a pickup time

import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
  checkApiRateLimit,
} from "../../_helpers/response";
import { proposePickupTime } from "@/server/services/pickup/pickup-scheduling.service";
import db from "@/lib/db";

export async function POST(request: Request) {
  const rateLimited = await checkApiRateLimit(request, "order");
  if (rateLimited) return rateLimited;

  try {
    const user = await requireApiUser();
    const body = (await request.json()) as {
      orderId?: string;
      proposedTime?: string;
    };

    if (!body.orderId || !body.proposedTime) {
      return apiError("orderId and proposedTime are required.", 400);
    }

    const proposedTime = new Date(body.proposedTime);
    if (isNaN(proposedTime.getTime())) {
      return apiError("Invalid proposedTime format.", 400);
    }

    // Determine role
    const order = await db.order.findUnique({
      where: { id: body.orderId },
      select: { buyerId: true, sellerId: true },
    });

    if (!order) return apiError("Order not found.", 404);

    let role: "BUYER" | "SELLER";
    if (user.id === order.buyerId) role = "BUYER";
    else if (user.id === order.sellerId) role = "SELLER";
    else return apiError("You are not a party to this order.", 403);

    const result = await proposePickupTime({
      orderId: body.orderId,
      proposedById: user.id,
      proposedByRole: role,
      proposedTime,
    });

    if (!result.success) {
      return apiError(result.error!, 400);
    }

    return apiOk({ proposed: true });
  } catch (e) {
    return handleApiError(e);
  }
}
