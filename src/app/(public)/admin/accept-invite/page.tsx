// src/app/(public)/admin/accept-invite/page.tsx
// ─── Accept Admin Invitation ──────────────────────────────────────────────────

import { redirect } from 'next/navigation';
import Link from 'next/link';
import crypto from 'crypto';
import db from '@/lib/db';
import { auth } from '@/lib/auth';
import { getRoleDisplayName } from '@/lib/permissions';
import type { Metadata } from 'next';
import type { AdminRole } from '@prisma/client';

export const metadata: Metadata = { title: 'Accept Invitation — Admin' };

interface Props {
  searchParams: Promise<{ token?: string }>;
}

export default async function AcceptInvitePage({ searchParams }: Props) {
  const { token } = await searchParams;

  if (!token) {
    return <ErrorPage message="Invalid or missing invitation token." />;
  }

  // Hash the raw token from the URL to look up the stored hash.
  // The raw token is never stored in the DB — only the SHA-256 hash.
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const invitation = await db.adminInvitation.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      email: true,
      adminRole: true,
      expiresAt: true,
      acceptedAt: true,
      inviter: { select: { displayName: true } },
    },
  });

  if (!invitation) {
    return <ErrorPage message="Invitation not found. It may have been cancelled or replaced." />;
  }

  if (invitation.acceptedAt) {
    return <ErrorPage message="This invitation has already been accepted." />;
  }

  if (invitation.expiresAt < new Date()) {
    return <ErrorPage message="This invitation has expired. Please request a new one." />;
  }

  // Check if the current user is logged in
  const session = await auth();

  if (session?.user?.id) {
    // User is logged in — apply the role to their account
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { email: true },
    });

    if (user?.email === invitation.email) {
      // Email matches — grant admin access
      await db.$transaction([
        db.user.update({
          where: { id: session.user.id },
          data: { isAdmin: true, adminRole: invitation.adminRole },
        }),
        db.adminInvitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date() },
        }),
      ]);

      redirect('/admin');
    }
  }

  // Not logged in or wrong account — show info page
  return (
    <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl border border-[#E3E0D9] p-8 max-w-md w-full text-center shadow-sm">
        <div className="w-12 h-12 rounded-full bg-[#FFF9EC] flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">🥝</span>
        </div>
        <h1 className="font-[family-name:var(--font-playfair)] text-[1.4rem] font-semibold text-[#141414] mb-2">
          Admin Invitation
        </h1>
        <p className="text-[13.5px] text-[#73706A] mb-1">
          <strong>{invitation.inviter.displayName}</strong> has invited you to join the KiwiMart
          admin team.
        </p>
        <div className="my-4 p-4 bg-[#FFF9EC] rounded-xl border border-[#F5ECD4] text-left">
          <p className="text-[12px] text-[#141414]">
            <strong>Email:</strong> {invitation.email}
          </p>
          <p className="text-[12px] text-[#141414] mt-1">
            <strong>Role:</strong> {getRoleDisplayName(invitation.adminRole as AdminRole)}
          </p>
          <p className="text-[12px] text-[#141414] mt-1">
            <strong>Expires:</strong>{' '}
            {invitation.expiresAt.toLocaleDateString('en-NZ', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </p>
        </div>
        <p className="text-[12.5px] text-[#9E9A91] mb-5">
          To accept this invitation, please sign in with the email address{' '}
          <strong>{invitation.email}</strong>, then visit this link again.
        </p>
        <Link
          href={`/login?from=/admin/accept-invite?token=${token}`}
          className="block w-full py-2.5 rounded-xl bg-[#141414] text-white text-[13px] font-semibold hover:bg-[#2a2a2a] transition-colors text-center"
        >
          Sign in to accept →
        </Link>
      </div>
    </div>
  );
}

function ErrorPage({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl border border-[#E3E0D9] p-8 max-w-md w-full text-center">
        <div className="text-4xl mb-3">⚠️</div>
        <h1 className="font-[family-name:var(--font-playfair)] text-[1.2rem] font-semibold text-[#141414] mb-2">
          Invitation Error
        </h1>
        <p className="text-[13.5px] text-[#73706A] mb-5">{message}</p>
        <Link
          href="/"
          className="inline-block px-5 py-2.5 rounded-xl border border-[#E3E0D9] text-[13px] font-semibold text-[#141414] hover:border-[#141414] transition-colors"
        >
          ← Back to KiwiMart
        </Link>
      </div>
    </div>
  );
}
