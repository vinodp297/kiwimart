"use client";

// src/components/pickup/OTPEntryForm.tsx
// ─── OTP Entry Form ─────────────────────────────────────────────────────────
// 6-digit code input with auto-advance and paste support.

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/primitives";
import { confirmPickupOTP } from "@/server/actions/pickup.actions";

interface OTPEntryFormProps {
  orderId: string;
  onSuccess: () => void;
}

export function OTPEntryForm({ orderId, onSuccess }: OTPEntryFormProps) {
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = useCallback(
    (index: number, value: string) => {
      // Only allow digits
      const digit = value.replace(/\D/g, "").slice(-1);
      const newDigits = [...digits];
      newDigits[index] = digit;
      setDigits(newDigits);
      setError(null);

      // Auto-advance to next input
      if (digit && index < 5) {
        inputRefs.current[index + 1]?.focus();
      }
    },
    [digits],
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Backspace" && !digits[index] && index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
    },
    [digits],
  );

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, 6);
    if (pasted.length === 6) {
      const newDigits = pasted.split("");
      setDigits(newDigits);
      inputRefs.current[5]?.focus();
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    const code = digits.join("");
    if (code.length !== 6) {
      setError("Please enter all 6 digits.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await confirmPickupOTP(orderId, code);
      if (result.success) {
        onSuccess();
      } else {
        setError(result.error ?? "Invalid code. Please try again.");
        setShake(true);
        setTimeout(() => setShake(false), 500);
        // Clear the digits on error
        setDigits(["", "", "", "", "", ""]);
        inputRefs.current[0]?.focus();
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [digits, orderId, onSuccess]);

  return (
    <div className="space-y-3">
      <div
        className={`flex gap-2 ${shake ? "animate-[shake_0.5s_ease-in-out]" : ""}`}
        onPaste={handlePaste}
      >
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={(el) => {
              inputRefs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            className={`
              w-10 h-12 text-center text-lg font-bold rounded-lg border-2
              focus:outline-none focus:ring-2 focus:ring-purple-500
              ${error ? "border-red-400 bg-red-50" : "border-[#C9C5BC] bg-white"}
            `}
          />
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button
        size="sm"
        variant="gold"
        onClick={handleSubmit}
        loading={loading}
        disabled={digits.some((d) => !d)}
      >
        Confirm Pickup
      </Button>
    </div>
  );
}
