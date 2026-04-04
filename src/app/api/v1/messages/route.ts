// src/app/api/v1/messages/route.ts
// ─── Messages API ────────────────────────────────────────────────────────────

import { z } from "zod";
import { messageService } from "@/modules/messaging/message.service";
import { threadsQuerySchema } from "@/modules/messaging/message.schema";
import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
  checkApiRateLimit,
} from "../_helpers/response";

export async function GET(request: Request) {
  // Rate limit: reuse message limiter (20/min)
  const rateLimited = await checkApiRateLimit(request, "message");
  if (rateLimited) return rateLimited;

  try {
    const user = await requireApiUser();
    const { searchParams } = new URL(request.url);

    let query: z.infer<typeof threadsQuerySchema>;
    try {
      query = threadsQuerySchema.parse(Object.fromEntries(searchParams));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return apiError("Validation failed", 400, "VALIDATION_ERROR");
      }
      throw err;
    }

    const result = await messageService.getMyThreads(user.id, {
      cursor: query.cursor,
      limit: query.limit,
    });
    return apiOk(result);
  } catch (e) {
    return handleApiError(e);
  }
}
