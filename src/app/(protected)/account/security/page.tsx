"use client";
// src/app/(protected)/account/security/page.tsx
// ─── Account Security Page ───────────────────────────────────────────────────

import { useState, useEffect, useTransition } from "react";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import { changePassword } from "@/server/actions/account";
import {
  initMfaSetup,
  confirmMfaSetup,
  disableMfaAction,
  getMfaStatus,
} from "@/server/actions/mfa";

// ── MFA Setup Section ─────────────────────────────────────────────────────────

function MfaSection() {
  const [status, setStatus] = useState<{
    enabled: boolean;
    backupCodesRemaining: number;
  } | null>(null);
  const [setupData, setSetupData] = useState<{
    secret: string;
    qrCodeUrl: string;
    backupCodes: string[];
  } | null>(null);
  const [setupCode, setSetupCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showBackupCodes, setShowBackupCodes] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    getMfaStatus().then((r) => {
      if (r.success) setStatus(r.data);
    });
  }, []);

  function handleStartSetup() {
    setError("");
    setSuccess("");
    startTransition(async () => {
      const result = await initMfaSetup();
      if (result.success) {
        setSetupData(result.data);
      } else {
        setError(result.error);
      }
    });
  }

  function handleConfirmSetup() {
    setError("");
    startTransition(async () => {
      const result = await confirmMfaSetup({ code: setupCode });
      if (result.success) {
        setStatus({ enabled: true, backupCodesRemaining: 10 });
        setSuccess("Two-factor authentication has been enabled.");
        setSetupData(null);
        setSetupCode("");
      } else {
        setError(result.error);
      }
    });
  }

  function handleDisable() {
    setError("");
    setSuccess("");
    startTransition(async () => {
      const result = await disableMfaAction({ code: disableCode });
      if (result.success) {
        setStatus({ enabled: false, backupCodesRemaining: 0 });
        setSuccess("Two-factor authentication has been disabled.");
        setDisableCode("");
      } else {
        setError(result.error);
      }
    });
  }

  if (!status) return null;

  return (
    <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
      <h2 className="font-semibold text-[#141414] text-[15px] mb-2">
        Two-factor authentication
      </h2>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[13px] text-emerald-700">
          {success}
        </div>
      )}

      {status.enabled ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <p className="text-[13px] text-green-700 font-medium">
              2FA is active
            </p>
          </div>
          <p className="text-[12px] text-[#73706A]">
            {status.backupCodesRemaining} backup codes remaining
          </p>

          {/* Disable form */}
          <div className="pt-3 border-t border-[#F0EDE8]">
            <p className="text-[12px] text-[#73706A] mb-2">
              Enter your current authenticator code to disable 2FA:
            </p>
            <div className="flex items-end gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={disableCode}
                onChange={(e) =>
                  setDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="000000"
                maxLength={6}
                className="w-32 h-9 px-3 rounded-lg border border-[#E3E0D9] bg-[#FAFAF8]
                  text-[13px] text-[#141414] text-center tracking-[0.3em] font-mono
                  focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400"
              />
              <button
                onClick={handleDisable}
                disabled={isPending || disableCode.length !== 6}
                className="h-9 px-4 rounded-lg border border-red-300 text-red-600 text-[12px]
                  font-semibold hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                {isPending ? "Disabling..." : "Disable 2FA"}
              </button>
            </div>
          </div>
        </div>
      ) : setupData ? (
        /* MFA Setup in progress */
        <div className="space-y-4">
          <p className="text-[13px] text-[#73706A]">
            Scan this QR code with your authenticator app (Google Authenticator,
            Authy, 1Password, etc):
          </p>

          {/* QR Code — render as an image via a QR code API */}
          <div className="flex justify-center">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(setupData.qrCodeUrl)}`}
              alt="MFA QR Code"
              className="w-48 h-48 rounded-xl border border-[#E3E0D9]"
            />
          </div>

          {/* Manual entry */}
          <details className="text-[12px]">
            <summary className="text-[#D4A843] cursor-pointer hover:underline">
              Can&apos;t scan? Enter manually
            </summary>
            <div className="mt-2 p-3 rounded-lg bg-[#F8F7F4] border border-[#E3E0D9]">
              <p className="text-[11px] text-[#73706A] mb-1">Secret key:</p>
              <code className="text-[13px] font-mono text-[#141414] break-all select-all">
                {setupData.secret}
              </code>
            </div>
          </details>

          {/* Backup codes */}
          <div>
            <button
              onClick={() => setShowBackupCodes(!showBackupCodes)}
              className="text-[12px] text-[#D4A843] hover:underline"
            >
              {showBackupCodes ? "Hide" : "Show"} backup codes
            </button>
            {showBackupCodes && (
              <div className="mt-2 p-4 rounded-lg bg-[#F8F7F4] border border-[#E3E0D9]">
                <p className="text-[11px] text-[#73706A] mb-2">
                  Save these codes somewhere safe. Each can only be used once:
                </p>
                <div className="grid grid-cols-2 gap-1">
                  {setupData.backupCodes.map((c) => (
                    <code
                      key={c}
                      className="text-[13px] font-mono text-[#141414] py-0.5"
                    >
                      {c}
                    </code>
                  ))}
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(
                      setupData.backupCodes.join("\n"),
                    );
                  }}
                  className="mt-3 text-[11px] text-[#D4A843] hover:underline"
                >
                  Copy all codes
                </button>
              </div>
            )}
          </div>

          {/* Verify code to enable */}
          <div className="pt-3 border-t border-[#F0EDE8]">
            <p className="text-[12px] text-[#73706A] mb-2">
              Enter the 6-digit code from your authenticator app to confirm:
            </p>
            <div className="flex items-end gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={setupCode}
                onChange={(e) =>
                  setSetupCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="000000"
                maxLength={6}
                className="w-32 h-9 px-3 rounded-lg border border-[#E3E0D9] bg-[#FAFAF8]
                  text-[13px] text-[#141414] text-center tracking-[0.3em] font-mono
                  focus:outline-none focus:ring-2 focus:ring-[#D4A843]/40 focus:border-[#D4A843]"
              />
              <button
                onClick={handleConfirmSetup}
                disabled={isPending || setupCode.length !== 6}
                className="h-9 px-4 rounded-lg bg-[#141414] text-white text-[12px]
                  font-semibold hover:bg-[#2a2a2a] disabled:opacity-50 transition-colors"
              >
                {isPending ? "Verifying..." : "Enable 2FA"}
              </button>
            </div>
          </div>

          <button
            onClick={() => {
              setSetupData(null);
              setSetupCode("");
            }}
            className="text-[12px] text-[#73706A] hover:text-[#141414] transition-colors"
          >
            Cancel setup
          </button>
        </div>
      ) : (
        /* MFA not enabled */
        <div>
          <p className="text-[13px] text-[#73706A] mb-4">
            Add an extra layer of security to your account with a time-based
            one-time password (TOTP) from an authenticator app.
          </p>
          <button
            onClick={handleStartSetup}
            disabled={isPending}
            className="inline-flex items-center justify-center h-9 px-5 rounded-full
              bg-[#141414] text-white text-[13px] font-semibold
              hover:bg-[#D4A843] transition-colors disabled:opacity-50"
          >
            {isPending ? "Setting up..." : "Enable 2FA"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SecurityPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
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
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      }
    });
  }

  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <div className="max-w-lg mx-auto px-4 py-16">
          <h1
            className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold
            text-[#141414] mb-2"
          >
            Account Security
          </h1>
          <p className="text-[14px] text-[#73706A] mb-8">
            Manage your password and security settings.
          </p>

          {/* Change Password */}
          <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
            <h2 className="font-semibold text-[#141414] text-[15px] mb-4">
              Change password
            </h2>

            {error && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700">
                {error}
              </div>
            )}

            {success && (
              <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[13px] text-emerald-700">
                Password changed successfully. All other sessions have been
                signed out.
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="current"
                  className="block text-[12.5px] font-semibold text-[#141414] mb-1.5"
                >
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
                <label
                  htmlFor="new"
                  className="block text-[12.5px] font-semibold text-[#141414] mb-1.5"
                >
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
                  Min 12 characters, must include uppercase, lowercase, and a
                  number.
                </p>
              </div>

              <div>
                <label
                  htmlFor="confirm"
                  className="block text-[12.5px] font-semibold text-[#141414] mb-1.5"
                >
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
                {isPending ? "Updating..." : "Update password"}
              </button>
            </form>
          </div>

          {/* Two-Factor Authentication */}
          <div className="mt-4">
            <MfaSection />
          </div>

          {/* Phone Verification Link */}
          <div className="mt-4 bg-white rounded-2xl border border-[#E3E0D9] p-6">
            <h2 className="font-semibold text-[#141414] text-[15px] mb-2">
              Phone verification
            </h2>
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
