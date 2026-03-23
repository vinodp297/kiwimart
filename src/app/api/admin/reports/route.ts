import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  const isAdmin = (session?.user as { isAdmin?: boolean } | undefined)?.isAdmin;
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorised' }, { status: 403 });

  const reports = await db.report.findMany({
    where: { status: 'OPEN' },
    orderBy: { createdAt: 'desc' },
    include: {
      reporter: { select: { username: true } },
    },
  });

  return NextResponse.json({ reports });
}
