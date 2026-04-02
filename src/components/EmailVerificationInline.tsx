"use client";
// src/components/EmailVerificationInline.tsx
// ─── Inline Verification Block (Hard Gate) ──────────────────────────────────
// Rendered inside the checkout form or create listing form when the user
// hasn't verified their email. Not dismissible — blocks the action entirely.

import { useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Button, Alert } from "@/components/ui/primitives";
import { resendVerificationEmail } from "@/server/actions/auth";
import { toast } from "sonner";

interface Props {
  onVerified: () => void;
}

export default function EmailVerificationInline({ onVerified }: Props) {
  const { data: session, update } = useSession();
  const [resendCooldown, setResendCooldown] = useState(0);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const email = session?.user?.email ?? "";

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

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5 w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#D4A843"
            strokeWidth="2"
          >
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-amber-900">
            Email verification required
          </p>
          <p className="text-[13px] text-amber-800 mt-1 leading-relaxed">
            You need to verify your email before you can proceed. We sent a link
            to <span className="font-medium">{email}</span>.
          </p>

          {error && (
            <Alert variant="error" className="mt-3">
              {error}
            </Alert>
          )}

          <div className="flex items-center gap-3 mt-3">
            <Button
              variant="gold"
              size="sm"
              onClick={handleCheckVerified}
              loading={checking}
            >
              I've verified — refresh
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleResend}
              disabled={resendCooldown > 0}
            >
              {resendCooldown > 0
                ? `Resend (${resendCooldown}s)`
                : "Resend email"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
