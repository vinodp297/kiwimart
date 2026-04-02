"use client";
// src/components/onboarding/WelcomeWizard.tsx
// ─── 3-Step First-Run Wizard ───────────────────────────────────────────────────
// Step 1 — Intent (Buy / Sell / Both)
// Step 2 — Region
// Step 3 — Done

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeOnboarding } from "@/server/actions/onboarding";

const NZ_REGIONS_DEFAULT = [
  "Auckland",
  "Wellington",
  "Canterbury",
  "Waikato",
  "Bay of Plenty",
  "Otago",
  "Hawke's Bay",
  "Manawatū-Whanganui",
  "Northland",
  "Tasman",
  "Nelson",
  "Marlborough",
  "Southland",
  "Taranaki",
  "Gisborne",
  "West Coast",
];

type Intent = "BUY" | "SELL" | "BOTH";

interface WelcomeWizardProps {
  displayName: string;
  regions?: string[];
}

const INTENTS: {
  value: Intent;
  emoji: string;
  title: string;
  subtitle: string;
}[] = [
  {
    value: "BUY",
    emoji: "🛍",
    title: "Buy items",
    subtitle: "I want to find great deals from NZ sellers",
  },
  {
    value: "SELL",
    emoji: "📦",
    title: "Sell items",
    subtitle: "I want to list items and earn money",
  },
  {
    value: "BOTH",
    emoji: "🔄",
    title: "Buy & sell",
    subtitle: "I want to do both — buy and sell",
  },
];

export default function WelcomeWizard({
  displayName,
  regions,
}: WelcomeWizardProps) {
  const NZ_REGIONS = regions ?? NZ_REGIONS_DEFAULT;
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [region, setRegion] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const firstName = displayName.split(" ")[0] ?? displayName;

  // ── Step 1: Intent ──────────────────────────────────────────────────────────
  function handleIntentSelect(value: Intent) {
    setIntent(value);
  }

  function handleIntentNext() {
    if (!intent) {
      setError("Please choose an option to continue.");
      return;
    }
    setError("");
    setStep(2);
  }

  // ── Step 2: Region ──────────────────────────────────────────────────────────
  function handleRegionNext() {
    // Region is optional — skip is allowed
    setError("");
    startTransition(async () => {
      const result = await completeOnboarding({
        intent: intent!,
        region: region || undefined,
      });
      if (result.success) {
        setStep(3);
      } else {
        setError(result.error);
      }
    });
  }

  // ── Step 3: Done ─────────────────────────────────────────────────────────────
  function handleFinish() {
    router.push("/dashboard/buyer");
  }

  return (
    <main className="min-h-screen bg-[#FAFAF8] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-[520px]">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-full bg-[#141414] flex items-center justify-center text-[#D4A843] text-sm font-bold">
            K
          </div>
          <span className="font-[family-name:var(--font-playfair)] text-[1.3rem] text-[#141414] tracking-tight">
            Kiwi<em className="not-italic text-[#D4A843]">Mart</em>
          </span>
        </div>

        {/* Progress bar */}
        {step < 3 && (
          <div className="flex gap-1.5 mb-8">
            {[1, 2].map((s) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  s <= step ? "bg-[#D4A843]" : "bg-[#E3E0D9]"
                }`}
              />
            ))}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-[#E3E0D9] shadow-sm p-8">
          {/* ── Step 1: Intent ────────────────────────────────────────────── */}
          {step === 1 && (
            <>
              <h1 className="font-[family-name:var(--font-playfair)] text-[1.5rem] font-semibold text-[#141414] mb-1">
                Welcome, {firstName}! 🥝
              </h1>
              <p className="text-[13.5px] text-[#73706A] mb-6">
                Let&apos;s personalise your{" "}
                {process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"} experience. What
                brings you here?
              </p>

              {error && (
                <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700">
                  {error}
                </div>
              )}

              <div className="space-y-3 mb-6">
                {INTENTS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleIntentSelect(opt.value)}
                    className={`w-full flex items-center gap-4 px-5 py-4 rounded-xl border-2 text-left transition-all ${
                      intent === opt.value
                        ? "border-[#D4A843] bg-[#FFF9EC]"
                        : "border-[#E3E0D9] hover:border-[#D4A843]/50 hover:bg-[#FAFAF8]"
                    }`}
                  >
                    <span className="text-2xl shrink-0">{opt.emoji}</span>
                    <div>
                      <p className="font-semibold text-[14px] text-[#141414]">
                        {opt.title}
                      </p>
                      <p className="text-[12.5px] text-[#73706A] mt-0.5">
                        {opt.subtitle}
                      </p>
                    </div>
                    {intent === opt.value && (
                      <svg
                        className="ml-auto text-[#D4A843] shrink-0"
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={handleIntentNext}
                className="w-full h-12 rounded-xl bg-[#141414] text-white font-semibold text-[14px] hover:bg-[#2A2A2A] transition-colors"
              >
                Continue →
              </button>
            </>
          )}

          {/* ── Step 2: Region ────────────────────────────────────────────── */}
          {step === 2 && (
            <>
              <h1 className="font-[family-name:var(--font-playfair)] text-[1.5rem] font-semibold text-[#141414] mb-1">
                Where are you based?
              </h1>
              <p className="text-[13.5px] text-[#73706A] mb-6">
                We&apos;ll show you listings and sellers near you. You can
                change this later.
              </p>

              {error && (
                <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700">
                  {error}
                </div>
              )}

              <div className="mb-6">
                <label className="block text-[12.5px] font-semibold text-[#141414] mb-1.5">
                  Region{" "}
                  <span className="text-[#9E9A91] font-normal">(optional)</span>
                </label>
                <select
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="w-full h-12 px-4 rounded-xl border border-[#E3E0D9] bg-[#FAFAF8]
                    text-[14px] text-[#141414] focus:outline-none
                    focus:ring-2 focus:ring-[#D4A843]/30 focus:border-[#D4A843] transition"
                >
                  <option value="">Skip — I&apos;ll set this later</option>
                  {NZ_REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="h-12 px-6 rounded-xl border border-[#E3E0D9] text-[14px] font-medium text-[#73706A] hover:bg-[#F8F7F4] transition-colors"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleRegionNext}
                  disabled={isPending}
                  className="flex-1 h-12 rounded-xl bg-[#141414] text-white font-semibold text-[14px] hover:bg-[#2A2A2A] transition-colors disabled:opacity-60"
                >
                  {isPending ? "Saving..." : region ? "Continue →" : "Skip →"}
                </button>
              </div>
            </>
          )}

          {/* ── Step 3: Done ──────────────────────────────────────────────── */}
          {step === 3 && (
            <div className="text-center">
              <div className="w-16 h-16 bg-[#F0FDF4] rounded-full flex items-center justify-center mx-auto mb-5">
                <span className="text-3xl">🎉</span>
              </div>
              <h1 className="font-[family-name:var(--font-playfair)] text-[1.5rem] font-semibold text-[#141414] mb-2">
                You&apos;re all set!
              </h1>
              <p className="text-[13.5px] text-[#73706A] mb-6 leading-relaxed">
                Your {process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"} account is
                ready. Start exploring thousands of listings from NZ sellers or
                list your first item in minutes.
              </p>

              <div className="bg-[#FAFAF8] border border-[#E3E0D9] rounded-xl p-4 text-left text-[13px] text-[#73706A] space-y-2 mb-6">
                {(intent === "SELL" || intent === "BOTH") && (
                  <p>
                    📦 <strong className="text-[#141414]">List an item</strong>{" "}
                    — sell in under 2 minutes, $0 listing fee
                  </p>
                )}
                {(intent === "BUY" || intent === "BOTH") && (
                  <p>
                    🔍{" "}
                    <strong className="text-[#141414]">Browse listings</strong>{" "}
                    — find great deals near you
                  </p>
                )}
                <p>
                  🛡{" "}
                  <strong className="text-[#141414]">Buyer protection</strong> —
                  every purchase backed up to{" "}
                  {process.env.NEXT_PUBLIC_BUYER_PROTECTION_DISPLAY ?? "$3,000"}
                </p>
              </div>

              <button
                type="button"
                onClick={handleFinish}
                className="w-full h-12 rounded-xl bg-[#D4A843] text-[#141414] font-semibold text-[14px] hover:bg-[#B8912E] hover:text-white transition-colors"
              >
                Go to my dashboard →
              </button>
            </div>
          )}
        </div>

        <p className="mt-5 text-center text-[11.5px] text-[#C9C5BC]">
          Your data is stored in NZ.{" "}
          {process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"} will never sell your
          personal information.
        </p>
      </div>
    </main>
  );
}
