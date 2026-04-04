"use client";
// src/app/(auth)/mfa-verify/page.tsx
// ─── MFA Verification Page ──────────────────────────────────────────────────
// Shown after password login when user has TOTP MFA enabled.

import { useState } from "react";
import Link from "next/link";
import { verifyMfaLoginAction } from "@/server/actions/mfaLogin";

export default function MfaVerifyPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [useBackupCode, setUseBackupCode] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await verifyMfaLoginAction({ code: code.trim() });

    if (!result.success) {
      setError(result.error);
      setLoading(false);
      return;
    }

    // MFA verified — redirect to dashboard
    window.location.href = "/dashboard/buyer";
  }

  return (
    <main className="min-h-screen bg-[#FAFAF8] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-[420px]">
        <Link
          href="/"
          className="flex items-center justify-center gap-2 mb-8 group"
        >
          <div className="w-8 h-8 rounded-full bg-[#141414] flex items-center justify-center text-[#D4A843] text-sm font-bold group-hover:bg-[#D4A843] group-hover:text-[#141414] transition-colors">
            K
          </div>
          <span className="font-[family-name:var(--font-playfair)] text-[1.3rem] text-[#141414] tracking-tight">
            Kiwi<em className="not-italic text-[#D4A843]">Mart</em>
          </span>
        </Link>

        <div className="bg-white rounded-2xl border border-[#E3E0D9] shadow-sm p-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-[#F5ECD4] flex items-center justify-center text-lg">
              🔐
            </div>
            <div>
              <h1 className="font-[family-name:var(--font-playfair)] text-[1.3rem] font-semibold text-[#141414]">
                Two-factor authentication
              </h1>
            </div>
          </div>
          <p className="text-[13.5px] text-[#73706A] mb-6">
            {useBackupCode
              ? "Enter one of your backup codes to continue."
              : "Enter the 6-digit code from your authenticator app."}
          </p>

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {useBackupCode ? (
              <div>
                <label
                  htmlFor="backup-code"
                  className="block text-[12.5px] font-semibold text-[#141414] mb-1.5"
                >
                  Backup code
                </label>
                <input
                  id="backup-code"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="XXXXXXXX"
                  maxLength={20}
                  autoFocus
                  className="w-full h-11 px-4 rounded-xl border border-[#E3E0D9] bg-[#FAFAF8]
                    text-[14px] text-[#141414] tracking-wider font-mono
                    focus:outline-none focus:ring-2 focus:ring-[#D4A843]/40 focus:border-[#D4A843]"
                  required
                />
              </div>
            ) : (
              <div>
                <label
                  htmlFor="totp-code"
                  className="block text-[12.5px] font-semibold text-[#141414] mb-1.5"
                >
                  Authentication code
                </label>
                <input
                  id="totp-code"
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="000000"
                  maxLength={6}
                  autoFocus
                  className="w-full h-11 px-4 rounded-xl border border-[#E3E0D9] bg-[#FAFAF8]
                    text-[18px] text-[#141414] text-center tracking-[0.4em] font-mono
                    focus:outline-none focus:ring-2 focus:ring-[#D4A843]/40 focus:border-[#D4A843]"
                  required
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !code}
              className="w-full h-11 rounded-full bg-[#141414] text-white font-semibold
                text-[14px] hover:bg-[#D4A843] transition-colors disabled:opacity-50"
            >
              {loading ? "Verifying..." : "Verify"}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              onClick={() => {
                setUseBackupCode(!useBackupCode);
                setCode("");
                setError("");
              }}
              className="text-[12.5px] text-[#D4A843] hover:underline"
            >
              {useBackupCode
                ? "Use authenticator code instead"
                : "Use a backup code instead"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
