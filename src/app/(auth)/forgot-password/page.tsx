'use client';
// src/app/(auth)/forgot-password/page.tsx  (Sprint 3 — wired to server action)

import { useState } from 'react';
import Link from 'next/link';
import { requestPasswordReset } from '@/server/actions/auth';
import { Button, Input, Alert } from '@/components/ui/primitives';

export default function ForgotPasswordPage() {
  const [email, setEmail]       = useState('');
  const [emailError, setEmailError] = useState('');
  const [loading, setLoading]   = useState(false);
  const [sent, setSent]         = useState(false);
  const [serverError, setServerError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) { setEmailError('Email is required.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError('Enter a valid email address.');
      return;
    }
    setEmailError('');
    setServerError('');
    setLoading(true);

    const result = await requestPasswordReset({ email: email.toLowerCase().trim(), turnstileToken: '' });
    setLoading(false);

    if (!result.success) {
      setServerError(result.error);
      return;
    }
    setSent(true);
  }

  return (
    <main className="min-h-screen bg-[#FAFAF8] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-[420px]">
        <Link href="/" className="flex items-center justify-center gap-2 mb-8 group">
          <div className="w-8 h-8 rounded-full bg-[#141414] flex items-center justify-center text-[#D4A843] text-sm font-bold group-hover:bg-[#D4A843] group-hover:text-[#141414] transition-colors">K</div>
          <span className="font-[family-name:var(--font-playfair)] text-[1.3rem] text-[#141414] tracking-tight">
            Kiwi<em className="not-italic text-[#D4A843]">Mart</em>
          </span>
        </Link>

        <div className="bg-white rounded-2xl border border-[#E3E0D9] shadow-sm p-8">
          {sent ? (
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              </div>
              <h2 className="font-[family-name:var(--font-playfair)] text-[1.25rem] font-semibold text-[#141414] mb-2">Check your inbox</h2>
              <p className="text-[13.5px] text-[#73706A] leading-relaxed mb-6 max-w-xs mx-auto">
                If <strong className="text-[#141414]">{email}</strong> is registered, you&apos;ll receive a reset link within a few minutes.
              </p>
              <Alert variant="info" className="text-left mb-5">
                The link expires in <strong>1 hour</strong>. Check your spam folder if you don&apos;t see it.
              </Alert>
              <Link href="/login"><Button variant="secondary" size="md" fullWidth>Back to sign in</Button></Link>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <div className="w-12 h-12 rounded-full bg-[#F5ECD4] flex items-center justify-center mb-4">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D4A843" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                </div>
                <h1 className="font-[family-name:var(--font-playfair)] text-[1.4rem] font-semibold text-[#141414] mb-1.5">Reset your password</h1>
                <p className="text-[13.5px] text-[#73706A]">Enter your email and we&apos;ll send you a secure reset link.</p>
              </div>

              {serverError && <Alert variant="error" className="mb-4">{serverError}</Alert>}

              <form onSubmit={handleSubmit} noValidate className="space-y-4">
                <Input
                  label="Email address"
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setEmailError(''); }}
                  placeholder="you@example.co.nz"
                  autoComplete="email"
                  required
                  error={emailError}
                />
                <Button type="submit" variant="primary" fullWidth size="md" loading={loading}>
                  Send reset link
                </Button>
              </form>

              <p className="mt-5 text-center text-[13px] text-[#73706A]">
                Remembered it?{' '}
                <Link href="/login" className="font-semibold text-[#D4A843] hover:text-[#B8912E] transition-colors">Back to sign in</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

