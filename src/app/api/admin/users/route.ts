import { NextResponse } from 'next/server';
import { requirePermission } from '@/shared/auth/requirePermission';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await requirePermission('VIEW_USERS');
  } catch {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 403 });
  }

  try {
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'));
    const q = url.searchParams.get('q') ?? '';

    const where = q
      ? {
          OR: [
            { email: { contains: q, mode: 'insensitive' as const } },
            { username: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const users = await db.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
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
    console.error('[admin/users:GET]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
