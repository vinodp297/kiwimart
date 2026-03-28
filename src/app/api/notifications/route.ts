// src/app/api/notifications/route.ts
// ─── Notifications API ────────────────────────────────────────────────────────
// GET  /api/notifications   — latest 10 for NavBar dropdown
// PATCH /api/notifications  — mark all as read

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import db from '@/lib/db';
import { logger } from '@/shared/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ notifications: [] });
    }

    const notifications = await db.notification.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        read: true,
        link: true,
        listingId: true,
        orderId: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ notifications });
  } catch (e) {
    logger.error('api.error', { path: '/api/notifications', error: e instanceof Error ? e.message : e });
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function PATCH() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    await db.notification.updateMany({
      where: { userId: session.user.id, read: false },
      data: { read: true },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    logger.error('api.error', { path: '/api/notifications', error: e instanceof Error ? e.message : e });
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
