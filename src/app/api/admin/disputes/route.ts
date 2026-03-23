import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  const isAdmin = (session?.user as { isAdmin?: boolean } | undefined)?.isAdmin;
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorised' }, { status: 403 });

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
