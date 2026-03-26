import { NextResponse } from 'next/server';
import { requirePermission } from '@/shared/auth/requirePermission';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requirePermission('VIEW_REPORTS');
  } catch {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 403 });
  }

  const reports = await db.report.findMany({
    where: { status: 'OPEN' },
    orderBy: { createdAt: 'desc' },
    include: {
      reporter: { select: { username: true } },
    },
  });

  return NextResponse.json({ reports });
}
