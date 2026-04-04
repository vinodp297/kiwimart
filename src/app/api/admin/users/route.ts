import { z } from "zod";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/auth/requirePermission";
import { adminUsersQuerySchema } from "@/modules/admin/admin.schema";
import db from "@/lib/db";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requirePermission("VIEW_USERS");
  } catch {
    return NextResponse.json({ error: "Unauthorised" }, { status: 403 });
  }

  try {
    const url = new URL(request.url);

    let query: z.infer<typeof adminUsersQuerySchema>;
    try {
      query = adminUsersQuerySchema.parse(Object.fromEntries(url.searchParams));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json(
          { error: "Validation failed" },
          { status: 400 },
        );
      }
      throw err;
    }

    const { page, q } = query;

    const where = q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" as const } },
            { username: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {};

    const users = await db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 20,
      skip: (page - 1) * 20,
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        region: true,
        sellerEnabled: true,
        idVerified: true,
        isBanned: true,
        createdAt: true,
        _count: {
          select: { listings: true, buyerOrders: true },
        },
      },
    });

    return NextResponse.json({ users });
  } catch (e) {
    logger.error("api.error", {
      path: "/api/admin/users",
      error: e instanceof Error ? e.message : e,
    });
    return NextResponse.json(
      { error: "Failed to load user list. Please refresh." },
      { status: 500 },
    );
  }
}
