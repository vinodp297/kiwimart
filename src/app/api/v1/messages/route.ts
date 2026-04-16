// src/app/api/v1/messages/route.ts
// ─── Messages API ────────────────────────────────────────────────────────────

import { z, ZodError } from "zod";
import { messageService } from "@/modules/messaging/message.service";
import { threadsQuerySchema } from "@/modules/messaging/message.schema";
import { sendMessageSchema } from "@/server/validators";
import {
  apiOk,
  apiError,
  handleApiError,
  requireApiUser,
  checkApiRateLimit,
} from "../_helpers/response";
import { getCorsHeaders, withCors } from "../_helpers/cors";

export async function GET(request: Request) {
  // Rate limit: reuse message limiter (20/min)
  const rateLimited = await checkApiRateLimit(request, "message");
  if (rateLimited) return rateLimited;

  try {
    const user = await requireApiUser(request);
    const { searchParams } = new URL(request.url);

    let query: z.infer<typeof threadsQuerySchema>;
    try {
      query = threadsQuerySchema.parse(Object.fromEntries(searchParams));
    } catch (err) {
      if (err instanceof ZodError) {
        return withCors(
          apiError("Validation failed", 400, "VALIDATION_ERROR"),
          request.headers.get("origin"),
        );
      }
      throw err;
    }

    const result = await messageService.getMyThreads(user.id, {
      cursor: query.cursor,
      limit: query.limit,
    });
    const res = withCors(apiOk(result), request.headers.get("origin"));
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (e) {
    return withCors(handleApiError(e), request.headers.get("origin"));
  }
}

export async function POST(request: Request) {
  const rateLimited = await checkApiRateLimit(request, "message");
  if (rateLimited) return rateLimited;

  try {
    const user = await requireApiUser(request);

    const body = await request.json().catch(() => null);
    if (!body) {
      return withCors(
        apiError("Invalid request body", 400, "VALIDATION_ERROR"),
        request.headers.get("origin"),
      );
    }

    const parsed = sendMessageSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(
        apiError("Validation failed", 400, "VALIDATION_ERROR"),
        request.headers.get("origin"),
      );
    }

    const result = await messageService.sendMessage(
      parsed.data,
      user.id,
      user.email,
    );
    return withCors(apiOk(result, 201), request.headers.get("origin"));
  } catch (e) {
    return withCors(handleApiError(e), request.headers.get("origin"));
  }
}

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request.headers.get("origin")),
  });
}
