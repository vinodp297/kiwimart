"use client";
// src/app/(protected)/seller/onboarding/_components/InlinePhoneVerification.tsx

import { useState, useTransition } from "react";
import {
  requestPhoneVerification,
  verifyPhoneCode,
} from "@/server/actions/verification";

type PhoneStep = "input" | "code" | "done";

export function InlinePhoneVerification({
  onVerified,
}: {
  onVerified: () => void;
}) {
  const [step, setStep] = useState<PhoneStep>("input");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSendCode() {
    setError("");
    startTransition(async () => {
      const result = await requestPhoneVerification({ phone });
      if (!result.success) {
        setError(result.error);
      } else {
        setStep("code");
      }
    });
  }

  function handleVerify() {
    setError("");
    startTransition(async () => {
      const result = await verifyPhoneCode({ code });
      if (!result.success) {
        setError(result.error);
      } else {
        setStep("done");
        onVerified();
      }
    });
  }

  if (step === "done") {
    return (
      <div className="flex items-center gap-2 text-[12.5px] text-green-700">
        <span className="text-green-500">✓</span> Phone verified!
      </div>
    );
  }

  return (
    <div className="space-y-3 mt-2">
      {error && (
        <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      {step === "input" && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-[11px] font-medium text-[#73706A] mb-1">
              NZ mobile number
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="021 123 4567"
              className="w-full h-9 px-3 rounded-lg border border-[#E3E0D9] bg-[#FAFAF8]
                text-[13px] text-[#141414] placeholder:text-[#C9C5BC]
                focus:outline-none focus:ring-2 focus:ring-[#D4A843]/40 focus:border-[#D4A843]"
            />
          </div>
          <button
            onClick={handleSendCode}
            disabled={isPending || !phone}
            className="h-9 px-4 rounded-lg bg-[#141414] text-white text-[12px] font-semibold
              hover:bg-[#2a2a2a] disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {isPending ? "Sending..." : "Send code"}
          </button>
        </div>
      )}
      {step === "code" && (
        <div className="space-y-2">
          <p className="text-[11px] text-[#73706A]">
            We sent a 6-digit code to {phone}.
          </p>
          <div className="flex items-end gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="000000"
              maxLength={6}
              className="w-32 h-9 px-3 rounded-lg border border-[#E3E0D9] bg-[#FAFAF8]
                text-[13px] text-[#141414] text-center tracking-[0.3em] font-mono
                placeholder:text-[#C9C5BC]
                focus:outline-none focus:ring-2 focus:ring-[#D4A843]/40 focus:border-[#D4A843]"
            />
            <button
              onClick={handleVerify}
              disabled={isPending || code.length !== 6}
              className="h-9 px-4 rounded-lg bg-[#141414] text-white text-[12px] font-semibold
                hover:bg-[#2a2a2a] disabled:opacity-50 transition-colors"
            >
              {isPending ? "Verifying..." : "Verify"}
            </button>
          </div>
          <button
            onClick={() => {
              setStep("input");
              setCode("");
              setError("");
            }}
            className="text-[11px] text-[#73706A] hover:text-[#141414] transition-colors"
          >
            Use a different number
          </button>
        </div>
      )}
    </div>
  );
}
