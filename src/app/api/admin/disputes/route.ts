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
}
