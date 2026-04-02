"use client";
// src/components/EmailVerificationModal.tsx
// ─── Reusable Verification Gate (Modal) ─────────────────────────────────────
// Shown when an unverified user attempts a soft-gated action (watchlist, cart,
// message seller). Dismissible — user stays on the page.

import { useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Button, Alert } from "@/components/ui/primitives";
import { resendVerificationEmail } from "@/server/actions/auth";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  onVerified: () => void;
}

export default function EmailVerificationModal({
  open,
  onClose,
  onVerified,
}: Props) {
  const { data: session, update } = useSession();
  const [resendCooldown, setResendCooldown] = useState(0);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const email = session?.user?.email ?? "";

  // ── Resend email (60 s cooldown) ───────────────────────────────────────────
  const handleResend = useCallback(async () => {
    setError(null);
    const result = await resendVerificationEmail();
    if (result.success) {
      toast.success("Verification email sent!");
      setResendCooldown(60);
      const interval = setInterval(() => {
        setResendCooldown((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setError(result.error);
    }
  }, []);

  // ── Refresh session and check emailVerified ────────────────────────────────
  const handleCheckVerified = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const updated = await update();
      if (updated?.user?.emailVerified) {
        toast.success("Email verified!");
        onVerified();
      } else {
        setError(
          "We couldn't confirm your verification yet. Please check your email and try again.",
        );
      }
    } catch {
      setError("Something went wrong refreshing your session.");
    }
    setChecking(false);
  }, [update, onVerified]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[500] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl border border-[#E3E0D9] shadow-xl w-full max-w-md p-6">
        {/* Header */}
        <div className="flex items-start gap-3 mb-4">
          <div className="shrink-0 mt-0.5 w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#D4A843"
              strokeWidth="2"
            >
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-[#141414]">
              Verify your email to continue
            </h2>
            <p className="text-[13px] text-[#73706A] mt-0.5 leading-relaxed">
              We sent a verification link to{" "}
              <span className="font-medium text-[#141414]">{email}</span>.
              Please check your inbox and click the link.
            </p>
          </div>
        </div>

        {error && (
          <Alert variant="error" className="mb-4">
            {error}
          </Alert>
        )}

        {/* Actions */}
        <div className="space-y-2">
          <Button
            variant="gold"
            fullWidth
            onClick={handleCheckVerified}
            loading={checking}
          >
            I've verified — try again
          </Button>
          <Button
            variant="secondary"
            fullWidth
            onClick={handleResend}
            disabled={resendCooldown > 0}
          >
            {resendCooldown > 0
              ? `Resend email (${resendCooldown}s)`
              : "Resend verification email"}
          </Button>
          <button
            onClick={onClose}
            className="w-full text-center text-[12.5px] text-[#9E9A91] hover:text-[#141414] transition-colors py-1"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
