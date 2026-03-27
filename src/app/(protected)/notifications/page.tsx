// src/app/(protected)/notifications/page.tsx
// ─── Notifications Full Page ──────────────────────────────────────────────────
// Server component — fetches all notifications, marks unread as read on load.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import db from '@/lib/db';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';
import { getNotifIcon } from '@/modules/notifications/notification.service';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Notifications',
};

function formatDate(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  const diff = Math.floor((today.getTime() - date.getTime()) / 86_400_000);
  if (diff < 7) return 'This week';
  return date.toLocaleDateString('en-NZ', { month: 'long', year: 'numeric' });
}

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  <  1) return 'Just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  <  7) return `${days}d ago`;
  return date.toLocaleDateString('en-NZ');
}

export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login?from=/notifications');
  }

  const userId = session.user.id;

  const [notifications] = await Promise.all([
    db.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    // Mark all unread as read
    db.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    }),
  ]);

  // Group by date label
  const groups = new Map<string, typeof notifications>();
  for (const n of notifications) {
    const label = formatDate(n.createdAt);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(n);
  }

  return (
    <>
      <NavBar />
      <main className="min-h-screen bg-[#FAFAF8]">
        <div className="max-w-2xl mx-auto px-4 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h1 className="font-[family-name:var(--font-playfair)] text-2xl font-semibold text-[#141414]">
              Notifications
            </h1>
          </div>

          {notifications.length === 0 ? (
            /* Empty state */
            <div className="text-center py-16">
              <div className="text-4xl mb-4">🥝</div>
              <p className="text-[#73706A] text-[15px]">You&apos;re all caught up!</p>
              <p className="text-[#C9C5BC] text-[13px] mt-1">
                New notifications will appear here
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {Array.from(groups.entries()).map(([label, items]) => (
                <div key={label}>
                  <h2 className="text-[11.5px] font-semibold text-[#9E9A91] uppercase tracking-wide mb-2">
                    {label}
                  </h2>
                  <div className="bg-white rounded-2xl border border-[#E3E0D9] overflow-hidden divide-y divide-[#F0EDE8]">
                    {items.map((n) => (
                      <Link
                        key={n.id}
                        href={n.link ?? '/dashboard/buyer'}
                        className="flex items-start gap-4 px-5 py-4 hover:bg-[#FAFAF8] transition-colors"
                      >
                        <span className="text-xl shrink-0 mt-0.5">{getNotifIcon(n.type)}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-semibold text-[#141414] leading-snug">
                            {n.title}
                          </p>
                          <p className="text-[13px] text-[#73706A] mt-0.5 leading-relaxed">
                            {n.body}
                          </p>
                          <p className="text-[11px] text-[#C9C5BC] mt-1.5">
                            {relativeTime(n.createdAt)}
                          </p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-8 text-center">
            <Link
              href="/dashboard/buyer"
              className="text-[13px] text-[#73706A] hover:text-[#141414] transition-colors"
            >
              ← Back to dashboard
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
