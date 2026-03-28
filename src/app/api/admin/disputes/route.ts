import { NextResponse } from 'next/server';
import { requirePermission } from '@/shared/auth/requirePermission';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requirePermission('VIEW_DISPUTES');
  } catch {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 403 });
  }

  try {
    const disputes = await db.order.findMany({
      where: { status: 'DISPUTED' },
      include: {
        buyer: { select: { username: true, email: true } },
        seller: { select: { username: true, email: true } },
        listing: { select: { title: true } },
      },
      orderBy: { updatedAt: 'asc' },
    });

    return NextResponse.json({ disputes });
  } catch (e) {
    console.error('[admin/disputes:GET]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
