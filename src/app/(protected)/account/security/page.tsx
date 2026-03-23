'use client';
// src/app/(protected)/account/security/page.tsx
// ─── Account Security Page ───────────────────────────────────────────────────

import { useState, useTransition } from 'react';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';
import { changePassword } from '@/server/actions/account';

export default function SecurityPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess(false);

    startTransition(async () => {
      const result = await changePassword({
        currentPassword,
        newPassword,
        confirmPassword,
      });
      if (!result.success) {
        setError(result.error);
      } else {
        setSuccess(true);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    });
  }

  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <div className="max-w-lg mx-auto px-4 py-16">
          <h1 className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold
            text-[#141414] mb-2">
            Account Security
          </h1>
          <p className="text-[14px] text-[#73706A] mb-8">
            Manage your password and security settings.
          </p>

          {/* Change Password */}
          <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
            <h2 className="font-semibold text-[#141414] text-[15px] mb-4">Change password</h2>

            {error && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700">
                {error}
              </div>
            )}

            {success && (
              <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[13px] text-emerald-700">
                Password changed successfully. All other sessions have been signed out.
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="current" className="block text-[12.5px] font-semibold text-[#141414] mb-1.5">
                  Current password
                </label>
                <input
                  id="current"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full h-11 px-4 rounded-xl border border-[#E3E0D9] bg-[#FAFAF8]
                    text-[14px] text-[#141414]
                    focus:outline-none focus:ring-2 focus:ring-[#D4A843]/40 focus:border-[#D4A843]"
                  required
                />
              </div>

              <div>
                <label htmlFor="new" className="block text-[12.5px] font-semibold text-[#141414] mb-1.5">
                  New password
                </label>
                <input
                  id="new"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full h-11 px-4 rounded-xl border border-[#E3E0D9] bg-[#FAFAF8]
                    text-[14px] text-[#141414]
                    focus:outline-none focus:ring-2 focus:ring-[#D4A843]/40 focus:border-[#D4A843]"
                  required
                  minLength={12}
                />
                <p className="text-[11px] text-[#9E9A91] mt-1">
                  Min 12 characters, must include uppercase, lowercase, and a number.
                </p>
              </div>

              <div>
                <label htmlFor="confirm" className="block text-[12.5px] font-semibold text-[#141414] mb-1.5">
                  Confirm new password
                </label>
                <input
                  id="confirm"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full h-11 px-4 rounded-xl border border-[#E3E0D9] bg-[#FAFAF8]
                    text-[14px] text-[#141414]
                    focus:outline-none focus:ring-2 focus:ring-[#D4A843]/40 focus:border-[#D4A843]"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={isPending}
                className="w-full h-11 rounded-full bg-[#141414] text-white font-semibold
                  text-[14px] hover:bg-[#D4A843] transition-colors disabled:opacity-50"
              >
                {isPending ? 'Updating...' : 'Update password'}
              </button>
            </form>
          </div>

          {/* Phone Verification Link */}
          <div className="mt-4 bg-white rounded-2xl border border-[#E3E0D9] p-6">
            <h2 className="font-semibold text-[#141414] text-[15px] mb-2">Phone verification</h2>
            <p className="text-[13px] text-[#73706A] mb-4">
              Add a verified NZ phone number for enhanced security and trust.
            </p>
            <a
              href="/account/verify"
              className="inline-flex items-center justify-center h-9 px-5 rounded-full
                border border-[#E3E0D9] text-[13px] font-semibold text-[#141414]
                hover:border-[#D4A843] hover:text-[#D4A843] transition-colors"
            >
              Verify phone number
            </a>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
