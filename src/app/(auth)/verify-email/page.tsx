'use client';
// src/app/(auth)/verify-email/page.tsx
// ─── Email Verification Waiting Page ─────────────────────────────────────────

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

function VerifyEmailContent() {
  const params = useSearchParams();
  const email = params.get('email') ?? '';
  const error = params.get('error');

  if (error === 'invalid') {
    return (
      <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-[#E3E0D9] shadow-sm p-8 max-w-md w-full text-center">
          <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">❌</span>
          </div>
          <h1 className="font-[family-name:var(--font-playfair)] text-[1.3rem] font-semibold text-[#141414] mb-2">
            Link expired or invalid
          </h1>
          <p className="text-[#73706A] text-[14px] mb-6 leading-relaxed">
            This verification link has expired or has already been used.
            Please register again to get a new link.
          </p>
          <Link
            href="/register"
            className="inline-block bg-[#141414] text-white px-6 py-2.5 rounded-xl text-[14px] font-medium hover:bg-[#2A2A2A] transition-colors"
          >
            Register again
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-[#E3E0D9] shadow-sm p-8 max-w-md w-full text-center">
        {/* Logo */}
        <Link href="/" className="flex items-center justify-center gap-2 mb-6 group">
          <div className="w-8 h-8 rounded-full bg-[#141414] flex items-center justify-center text-[#D4A843] text-sm font-bold group-hover:bg-[#D4A843] group-hover:text-[#141414] transition-colors">K</div>
          <span className="font-[family-name:var(--font-playfair)] text-[1.2rem] text-[#141414] tracking-tight">
            Kiwi<em className="not-italic text-[#D4A843]">Mart</em>
          </span>
        </Link>

        <div className="w-16 h-16 bg-[#FFF9EC] rounded-full flex items-center justify-center mx-auto mb-5">
          <span className="text-3xl">📧</span>
        </div>

        <h1 className="font-[family-name:var(--font-playfair)] text-[1.4rem] font-semibold text-[#141414] mb-2">
          Check your email
        </h1>

        {email ? (
          <>
            <p className="text-[#73706A] text-[13.5px] mb-1">We sent a verification link to</p>
            <p className="font-semibold text-[#141414] text-[15px] mb-5">{email}</p>
          </>
        ) : (
          <p className="text-[#73706A] text-[13.5px] mb-5">
            We sent you a verification link. Please check your inbox.
          </p>
        )}

        <div className="bg-[#FAFAF8] border border-[#E3E0D9] rounded-xl p-4 text-left text-[13px] text-[#73706A] space-y-2 mb-6">
          <p>📬 Check your spam/junk folder if not in inbox</p>
          <p>⏱ Link is valid for 24 hours</p>
          <p>🛍 You can browse KiwiMart while waiting</p>
        </div>

        <div className="flex flex-col gap-3">
          <Link
            href="/"
            className="inline-block bg-[#141414] text-white px-6 py-3 rounded-xl text-[14px] font-medium hover:bg-[#2A2A2A] transition-colors"
          >
            Browse KiwiMart
          </Link>
          <Link
            href="/login"
            className="text-[13px] text-[#73706A] hover:text-[#141414] transition-colors"
          >
            Already verified? Sign in →
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#D4A843] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  );
}
