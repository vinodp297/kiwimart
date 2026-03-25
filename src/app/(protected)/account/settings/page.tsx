// src/app/(protected)/account/settings/page.tsx
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import db from '@/lib/db';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';
import SettingsForm from './SettingsForm';

export default async function AccountSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login?from=/account/settings');
  }

  const user = await db.user.findUnique({
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
  });

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

          <SettingsForm user={user} />
        </div>
      </main>
      <Footer />
    </>
  );
}
