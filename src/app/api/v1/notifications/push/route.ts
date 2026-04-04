// src/app/api/v1/notifications/push/route.ts
// ─── Push Token Registration ──────────────────────────────────────────────────
// POST /api/v1/notifications/push — register a device push token
//
// TODO: Add PushToken model to prisma/schema.prisma to persist tokens:
//   model PushToken {
//     id        String   @id @default(cuid())
//     userId    String
//     token     String   @unique
//     platform  String   // ios | android
//     deviceId  String
//     createdAt DateTime @default(now())
//     updatedAt DateTime @updatedAt
//     user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
//     @@index([userId])
//   }
// Then replace logger.info with: db.pushToken.upsert({ where: { token }, update: { updatedAt: new Date() }, create: { userId, token, platform, deviceId } })

import { z } from "zod";
import { logger } from "@/shared/logger";
import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
} from "../../_helpers/response";
import { corsHeaders } from "../../_helpers/cors";

const pushTokenSchema = z.object({
  token: z.string().min(1).max(512),
  platform: z.enum(["ios", "android"]),
  deviceId: z.string().min(1).max(255),
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(request);

    const body = await request.json().catch(() => null);
    if (!body) {
      return apiError("Invalid request body", 400, "VALIDATION_ERROR");
    }

    const parsed = pushTokenSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("Validation failed", 400, "VALIDATION_ERROR");
    }

    const { token, platform, deviceId } = parsed.data;

    // TODO: persist via db.pushToken.upsert() once PushToken model is added to schema
    logger.info("push.token.registered", {
      userId: user.id,
      platform,
      deviceId,
      tokenPrefix: token.slice(0, 8),
    });

    return apiOk({ registered: true });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
