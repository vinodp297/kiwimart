"use client";
// src/app/(protected)/dashboard/buyer/_components/EmailVerifyBanner.tsx

import { useState } from "react";
import { resendVerificationEmail } from "@/server/actions/auth";

export function EmailVerifyBanner() {
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">(
    "idle",
  );
  const [countdown, setCountdown] = useState(0);

  const handleResend = async () => {
    setStatus("loading");
    try {
      const result = await resendVerificationEmail();
      if (result.success) {
        setStatus("sent");
        setCountdown(60);
        const interval = setInterval(() => {
          setCountdown((prev) => {
            if (prev <= 1) {
              clearInterval(interval);
              setStatus("idle");
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        setStatus("error");
        setTimeout(() => setStatus("idle"), 4000);
      }
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 4000);
    }
  };

  return (
    <div className="bg-[#FFF9EC] border border-[#D4A843]/30 rounded-2xl p-4 mb-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <span className="text-xl">📧</span>
        <div>
          <p className="font-semibold text-[14px] text-[#141414]">
            Please verify your email address
          </p>
          <p className="text-[12px] text-[#73706A] mt-0.5">
            Check your inbox for a verification link from{" "}
            {process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"}.
          </p>
        </div>
      </div>
      {status === "sent" ? (
        <span className="text-[12px] text-[#16a34a] font-medium whitespace-nowrap">
          ✅ Sent!{countdown > 0 && ` (${countdown}s)`}
        </span>
      ) : (
        <button
          onClick={handleResend}
          disabled={status === "loading" || countdown > 0}
          className="text-[13px] text-[#D4A843] hover:underline disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold whitespace-nowrap"
        >
          {status === "loading"
            ? "Sending…"
            : status === "error"
              ? "Try again"
              : "Resend email"}
        </button>
      )}
    </div>
  );
}
