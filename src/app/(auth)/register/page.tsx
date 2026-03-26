'use client';
// src/app/(auth)/register/page.tsx

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn, signOut, useSession } from 'next-auth/react';
import { registerUser } from '@/server/actions/auth';
import { Button, Input, Alert, Divider, PasswordStrength } from '@/components/ui/primitives';

export default function RegisterPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [sessionCleared, setSessionCleared] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [showPw, setShowPw]       = useState(false);
  const [agreeTerms, setAgreeTerms]       = useState(false);
  const [agreeMarketing, setAgreeMarketing] = useState(false);
  const [loading, setLoading]     = useState(false);
  const [serverError, setServerError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  // Fix 1 — Sign out any existing session so a fresh account can be created
  useEffect(() => {
    if (status === 'loading') return;
    if (session) {
      signOut({ redirect: false }).then(() => setSessionCleared(true));
    } else {
      setSessionCleared(true);
    }
  }, [session, status]);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) return;
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    document.head.appendChild(script);
    script.onload = () => {
      if (turnstileRef.current && window.turnstile) {
        widgetId.current = window.turnstile.render(turnstileRef.current, {
          sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
          theme: 'light',
        });
      }
    };
    return () => { document.head.removeChild(script); };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setServerError('');

    // Client-side: confirm password must match before hitting the server
    if (password !== confirm) {
      setFieldErrors({ confirmPassword: ['Passwords do not match'] });
      return;
    }

    const turnstileToken = widgetId.current
      ? window.turnstile?.getResponse(widgetId.current) ?? ''
      : '';

    setLoading(true);
    try {
      const result = await registerUser({
        firstName,
        lastName,
        email,
        username: `${firstName}${lastName}`.toLowerCase().replace(/[^a-z0-9]/g, ''),
        password,
        confirmPassword: confirm,
        agreeTerms: agreeTerms as true,
        agreeMarketing,
        turnstileToken,
      });

      if (!result.success) {
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        else setServerError(result.error);
        if (widgetId.current) window.turnstile?.reset(widgetId.current);
        setLoading(false);
        return;
      }

      // Fix 2 — Sign in as the newly-created user (not any previous session)
      const signInResult = await signIn('credentials', {
        email: email.toLowerCase().trim(),
        password,
        turnstileToken: '',
        redirect: false,
      });

      const encodedEmail = encodeURIComponent(email.trim().toLowerCase());
      if (signInResult?.ok) {
        router.push(`/verify-email?email=${encodedEmail}`);
      } else {
        // Registration succeeded but auto-login failed (e.g. Turnstile in prod)
        router.push(`/login?registered=true&email=${encodedEmail}`);
      }
    } catch {
      setServerError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  const fe = (f: string) => fieldErrors[f]?.[0];
  const clear = (f: string) => setFieldErrors((prev) => { const n = { ...prev }; delete n[f]; return n; });

  // Show spinner while signing out existing session
  if (!sessionCleared) {
    return (
      <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#D4A843] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#FAFAF8] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-[460px]">
        <Link href="/" className="flex items-center justify-center gap-2 mb-8 group">
          <div className="w-8 h-8 rounded-full bg-[#141414] flex items-center justify-center text-[#D4A843] text-sm font-bold group-hover:bg-[#D4A843] group-hover:text-[#141414] transition-colors">K</div>
          <span className="font-[family-name:var(--font-playfair)] text-[1.3rem] text-[#141414] tracking-tight">
            Kiwi<em className="not-italic text-[#D4A843]">Mart</em>
          </span>
        </Link>

        <div className="bg-white rounded-2xl border border-[#E3E0D9] shadow-sm p-8">
          <h1 className="font-[family-name:var(--font-playfair)] text-[1.5rem] font-semibold text-[#141414] mb-1">
            Create your account
          </h1>
          <p className="text-[13.5px] text-[#73706A] mb-6">Free to join. Start buying and selling in minutes.</p>

          {serverError && <Alert variant="error" className="mb-5">{serverError}</Alert>}

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Input label="First name" type="text" value={firstName} onChange={(e) => { setFirstName(e.target.value); clear('firstName'); }} placeholder="Jane" autoComplete="given-name" required error={fe('firstName')} />
              <Input label="Last name" type="text" value={lastName} onChange={(e) => { setLastName(e.target.value); clear('lastName'); }} placeholder="Smith" autoComplete="family-name" required error={fe('lastName')} />
            </div>

            <Input label="Email address" type="email" value={email} onChange={(e) => { setEmail(e.target.value); clear('email'); }} placeholder="jane@example.co.nz" autoComplete="email" required error={fe('email')} />

            <div className="flex flex-col gap-1.5">
              <label className="text-[12.5px] font-semibold text-[#141414]">Password <span className="text-red-500">*</span></label>
              <Input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); clear('password'); }}
                placeholder="At least 12 characters"
                autoComplete="new-password"
                required
                error={fe('password')}
                rightAddon={
                  <button type="button" onClick={() => setShowPw((v) => !v)} className="hover:text-[#141414] transition-colors">
                    {showPw
                      ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    }
                  </button>
                }
              />
              <PasswordStrength password={password} />
            </div>

            <Input label="Confirm password" type="password" value={confirm} onChange={(e) => { setConfirm(e.target.value); clear('confirmPassword'); }} placeholder="Re-enter your password" autoComplete="new-password" required error={fe('confirmPassword') ?? (confirm.length > 0 && confirm !== password ? 'Passwords do not match' : undefined)} />

            <div className="space-y-3 pt-1">
              <div>
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input type="checkbox" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} className="w-4 h-4 mt-0.5 rounded border-[#C9C5BC] accent-[#D4A843] cursor-pointer" required />
                  <span className="text-[12.5px] text-[#73706A] leading-relaxed">
                    I agree to KiwiMart&apos;s{' '}
                    <Link href="/terms" className="text-[#141414] font-semibold underline-offset-2 hover:underline">Terms of Service</Link>{' '}
                    and{' '}
                    <Link href="/privacy" className="text-[#141414] font-semibold underline-offset-2 hover:underline">Privacy Policy</Link>
                  </span>
                </label>
                {fe('agreeTerms') && <p className="text-[11.5px] text-red-500 font-medium mt-1 ml-6">{fe('agreeTerms')}</p>}
              </div>
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={agreeMarketing} onChange={(e) => setAgreeMarketing(e.target.checked)} className="w-4 h-4 mt-0.5 rounded border-[#C9C5BC] accent-[#D4A843] cursor-pointer" />
                <span className="text-[12.5px] text-[#73706A] leading-relaxed">Send me occasional KiwiMart tips and offers (optional)</span>
              </label>
            </div>

            {process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && (
              <div ref={turnstileRef} />
            )}

            <Button type="submit" variant="gold" fullWidth size="lg" loading={loading} className="mt-2">
              Create free account
            </Button>
          </form>

          <Divider label="or" className="my-5" />

          <button
            type="button"
            onClick={() => signIn('google', { callbackUrl: '/dashboard/buyer?welcome=1' })}
            className="w-full h-11 rounded-xl border border-[#C9C5BC] flex items-center justify-center gap-3 text-[13.5px] font-medium text-[#141414] hover:bg-[#F8F7F4] transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Continue with Google
          </button>

          <p className="mt-6 text-center text-[13px] text-[#73706A]">
            Already have an account?{' '}
            <Link href="/login" className="font-semibold text-[#D4A843] hover:text-[#B8912E] transition-colors">Sign in</Link>
          </p>
        </div>

        <p className="mt-5 text-center text-[11px] text-[#C9C5BC] max-w-xs mx-auto">
          Your data is stored in NZ. KiwiMart will never sell your personal information.
        </p>
      </div>
    </main>
  );
}

