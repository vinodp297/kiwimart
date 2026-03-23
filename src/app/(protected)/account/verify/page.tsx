'use client';
// src/app/(protected)/account/verify/page.tsx
// ─── Phone Verification Page ─────────────────────────────────────────────────

import { useState, useTransition } from 'react';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';
import { requestPhoneVerification, verifyPhoneCode } from '@/server/actions/verification';

type Step = 'phone' | 'code' | 'done';

export default function VerifyPhonePage() {
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleRequestCode() {
    setError('');
    startTransition(async () => {
      const result = await requestPhoneVerification({ phone });
      if (!result.success) {
        setError(result.error);
      } else {
        setStep('code');
      }
    });
  }

  function handleVerifyCode() {
    setError('');
    startTransition(async () => {
      const result = await verifyPhoneCode({ code });
      if (!result.success) {
        setError(result.error);
      } else {
        setStep('done');
      }
    });
  }

  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <div className="max-w-md mx-auto px-4 py-16">
          <div className="bg-white rounded-2xl border border-[#E3E0D9] p-8">
            {/* Header */}
            <div className="text-center mb-8">
              <div
                className="w-16 h-16 rounded-full bg-[#F5ECD4] flex items-center justify-center
                  mx-auto mb-4"
                aria-hidden
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#D4A843" strokeWidth="1.8">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
              </div>
              <h1 className="font-[family-name:var(--font-playfair)] text-[1.5rem] font-semibold text-[#141414] mb-2">
                {step === 'done' ? 'Phone verified!' : 'Verify your phone'}
              </h1>
              <p className="text-[13.5px] text-[#73706A]">
                {step === 'phone' && 'Add your NZ mobile number for enhanced account security.'}
                {step === 'code' && `We sent a 6-digit code to ${phone}. Enter it below.`}
                {step === 'done' && 'Your phone number has been verified successfully.'}
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700">
                {error}
              </div>
            )}

            {/* Step: Phone input */}
            {step === 'phone' && (
              <div className="space-y-4">
                <div>
                  <label htmlFor="phone" className="block text-[12.5px] font-semibold text-[#141414] mb-1.5">
                    NZ mobile number
                  </label>
                  <input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="021 123 4567"
                    className="w-full h-11 px-4 rounded-xl border border-[#E3E0D9] bg-[#FAFAF8]
                      text-[14px] text-[#141414] placeholder:text-[#C9C5BC]
                      focus:outline-none focus:ring-2 focus:ring-[#D4A843]/40 focus:border-[#D4A843]"
                  />
                </div>
                <button
                  onClick={handleRequestCode}
                  disabled={isPending || !phone}
                  className="w-full h-11 rounded-full bg-[#141414] text-white font-semibold
                    text-[14px] hover:bg-[#D4A843] transition-colors disabled:opacity-50"
                >
                  {isPending ? 'Sending...' : 'Send verification code'}
                </button>
              </div>
            )}

            {/* Step: Code input */}
            {step === 'code' && (
              <div className="space-y-4">
                <div>
                  <label htmlFor="code" className="block text-[12.5px] font-semibold text-[#141414] mb-1.5">
                    Verification code
                  </label>
                  <input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    maxLength={6}
                    className="w-full h-11 px-4 rounded-xl border border-[#E3E0D9] bg-[#FAFAF8]
                      text-[14px] text-[#141414] text-center tracking-[0.5em] font-mono
                      placeholder:text-[#C9C5BC] placeholder:tracking-[0.5em]
                      focus:outline-none focus:ring-2 focus:ring-[#D4A843]/40 focus:border-[#D4A843]"
                  />
                </div>
                <button
                  onClick={handleVerifyCode}
                  disabled={isPending || code.length !== 6}
                  className="w-full h-11 rounded-full bg-[#141414] text-white font-semibold
                    text-[14px] hover:bg-[#D4A843] transition-colors disabled:opacity-50"
                >
                  {isPending ? 'Verifying...' : 'Verify'}
                </button>
                <button
                  onClick={() => { setStep('phone'); setCode(''); setError(''); }}
                  className="w-full text-[13px] text-[#73706A] hover:text-[#141414] transition-colors"
                >
                  Use a different number
                </button>
              </div>
            )}

            {/* Step: Done */}
            {step === 'done' && (
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </div>
                <a
                  href="/account"
                  className="inline-flex items-center justify-center h-11 px-7 rounded-full
                    bg-[#141414] text-white font-semibold text-[14px] hover:bg-[#D4A843]
                    transition-colors"
                >
                  Back to account
                </a>
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
