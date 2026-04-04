"use client";
// src/app/(protected)/seller/onboarding/SellerOnboardingClient.tsx
// ─── Seller Onboarding Client ──────────────────────────────────────────────────

import { useState } from "react";
import { acceptSellerTerms } from "@/server/actions/seller";
import type { SellerTier, SellerTierName } from "@/lib/seller-tiers";

import { TermsModal } from "./_components/TermsModal";
import { BusinessDetailsSection } from "./_components/BusinessDetailsSection";
import { CurrentTierCard, StripeCta } from "./_components/CurrentTierCard";
import { TierProgressionList } from "./_components/TierProgressionList";
import type { UserProps, VerificationAppProps } from "./_components/types";

interface Props {
  user: UserProps;
  verificationApp: VerificationAppProps | null;
  currentTierName: SellerTierName;
  tiers: SellerTier[];
}

export default function SellerOnboardingClient({
  user,
  verificationApp,
  currentTierName,
  tiers,
}: Props) {
  const [termsAccepted, setTermsAccepted] = useState(
    !!user.sellerTermsAcceptedAt,
  );
  const [termsAcceptedAt, setTermsAcceptedAt] = useState(
    user.sellerTermsAcceptedAt,
  );
  const [phoneVerified, setPhoneVerified] = useState(user.phoneVerified);
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [showTermsModal, setShowTermsModal] = useState(false);

  async function handleAcceptTerms() {
    setLoading("terms");
    setMessage(null);
    try {
      const result = await acceptSellerTerms();
      setLoading(null);
      if (result.success) {
        setTermsAccepted(true);
        setTermsAcceptedAt(new Date().toISOString());
        setShowTermsModal(false);
        setMessage({
          type: "success",
          text: "Seller terms accepted! You can now create listings.",
        });
      } else {
        setMessage({
          type: "error",
          text:
            result.error ?? "We couldn't accept the terms. Please try again.",
        });
      }
    } catch {
      setLoading(null);
      setMessage({
        type: "error",
        text: "We couldn't save your acceptance. Please check your connection and try again.",
      });
    }
  }

  return (
    <div className="space-y-6">
      {/* Flash message */}
      {message && (
        <div
          className={`rounded-xl border px-4 py-3 text-[13.5px] ${
            message.type === "success"
              ? "bg-green-50 border-green-200 text-green-700"
              : "bg-red-50 border-red-200 text-red-700"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* ── Seller Terms — shown at TOP ────────────────────────────────────── */}
      {termsAccepted ? (
        <div className="bg-[#F0FDF4] border border-[#16a34a]/20 rounded-xl p-4 flex items-start gap-3">
          <span className="text-[#16a34a] text-xl flex-shrink-0">✅</span>
          <div className="flex-1">
            <p className="font-semibold text-[14px] text-[#141414]">
              Seller terms accepted
            </p>
            <p className="text-[12px] text-[#73706A] mt-0.5">
              {termsAcceptedAt && (
                <>
                  Accepted on{" "}
                  {new Date(termsAcceptedAt).toLocaleDateString("en-NZ", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                  {" · "}
                </>
              )}
              <button
                onClick={() => setShowTermsModal(true)}
                className="text-[#D4A843] hover:underline text-[12px]"
              >
                View terms →
              </button>
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-white border-2 border-[#D4A843] rounded-2xl overflow-hidden">
          <div className="bg-[#141414] px-5 py-4 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-white text-[15px]">
                📋 Seller Terms & Conditions
              </h2>
              <p className="text-[#888] text-[12px] mt-0.5">
                Required before you can sell
              </p>
            </div>
            <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
              Action required
            </span>
          </div>
          <div className="p-5">
            <p className="text-[13px] text-[#73706A] leading-relaxed mb-4">
              Before listing items on{" "}
              {process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"}, you must read and
              accept our seller terms. These cover your obligations as a seller,
              fee structure, prohibited items, and dispute resolution.
            </p>
            <button
              onClick={() => setShowTermsModal(true)}
              className="w-full border-2 border-[#141414] text-[#141414] py-2.5 rounded-xl font-medium text-[14px] hover:bg-[#141414] hover:text-white transition-colors mb-3"
            >
              📄 Read Seller Terms & Conditions
            </button>
            <p className="text-[11px] text-[#C9C5BC] text-center">
              You must read the terms before you can accept them
            </p>
          </div>
        </div>
      )}

      <CurrentTierCard currentTierName={currentTierName} tiers={tiers} />

      <TierProgressionList
        user={user}
        verificationApp={verificationApp}
        currentTierName={currentTierName}
        tiers={tiers}
        termsAccepted={termsAccepted}
        phoneVerified={phoneVerified}
        onPhoneVerified={() => {
          setPhoneVerified(true);
          setMessage({
            type: "success",
            text: "Phone verified! Your tier has been upgraded.",
          });
        }}
        onIdSubmitted={() => {
          setMessage({
            type: "success",
            text: "ID verification submitted. We'll review it within 1\u20132 business days.",
          });
        }}
      />

      <StripeCta stripeOnboarded={user.stripeOnboarded} />

      <BusinessDetailsSection user={user} />

      {/* Terms Modal */}
      {showTermsModal && (
        <TermsModal
          onAccept={handleAcceptTerms}
          onClose={() => setShowTermsModal(false)}
          loading={loading === "terms"}
          readOnly={termsAccepted}
        />
      )}
    </div>
  );
}
