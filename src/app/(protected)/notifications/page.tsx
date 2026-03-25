// src/app/(protected)/notifications/page.tsx
// ─── Notifications Page ───────────────────────────────────────────────────────

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';

export const metadata = {
  title: 'Notifications — KiwiMart',
};

export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login?from=/notifications');
  }

  return (
    <>
      <NavBar />
      <main className="min-h-screen bg-[#FAFAF8]">
        <div className="max-w-2xl mx-auto px-4 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h1
              className="font-[family-name:var(--font-playfair)]
                text-2xl font-semibold text-[#141414]"
            >
              Notifications
            </h1>
          </div>

          {/* Empty state */}
          <div className="text-center py-16">
            <div className="text-4xl mb-4">🥝</div>
            <p className="text-[#73706A] text-[15px]">You&apos;re all caught up!</p>
            <p className="text-[#C9C5BC] text-[13px] mt-1">
              New notifications will appear here
            </p>
          </div>

          {/* Back link */}
          <div className="mt-8 text-center">
            <Link
              href="/dashboard/buyer"
              className="text-[13px] text-[#73706A] hover:text-[#141414]
                transition-colors"
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
