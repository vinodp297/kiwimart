// src/app/(protected)/account/settings/page.tsx
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import db from '@/lib/db';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';
import SettingsForm from './SettingsForm';
import ProfileCompletion from '@/components/onboarding/ProfileCompletion';
import { UnblockButton } from '@/components/seller/UnblockButton';

export default async function AccountSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login?from=/account/settings');
  }

  const [user, blockedUsers] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      select: {
        displayName: true,
        username: true,
        email: true,
        emailVerified: true,
        region: true,
        bio: true,
        agreeMarketing: true,
      },
    }),
    db.blockedUser.findMany({
      where: { blockerId: session.user.id },
      include: {
        blocked: { select: { id: true, displayName: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  if (!user) redirect('/login');

  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <div className="max-w-2xl mx-auto px-4 py-12">
          <h1
            className="font-[family-name:var(--font-playfair)] text-[2rem]
              font-semibold text-[#141414] mb-2"
          >
            Account settings
          </h1>
          <p className="text-[14px] text-[#73706A] mb-8">
            Manage your profile, notifications and account preferences.
          </p>

          <div className="mb-6">
            <ProfileCompletion
              displayName={user.displayName}
              emailVerified={user.emailVerified}
              region={user.region}
              bio={user.bio}
            />
          </div>
          <SettingsForm user={user} />

          {blockedUsers.length > 0 && (
            <div className="border-t border-[#E3E0D9] pt-6 mt-6">
              <h3 className="font-semibold text-[14px] text-[#141414] mb-3">
                Blocked Users ({blockedUsers.length})
              </h3>
              <div className="space-y-2">
                {blockedUsers.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between py-2 px-3 bg-[#FAFAF8] rounded-xl"
                  >
                    <span className="text-[13px] text-[#141414]">{b.blocked.displayName}</span>
                    <UnblockButton targetUserId={b.blocked.id} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
