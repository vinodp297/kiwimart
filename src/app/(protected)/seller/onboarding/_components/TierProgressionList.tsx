"use client";
// src/app/(protected)/seller/onboarding/_components/TierProgressionList.tsx

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SellerTier, SellerTierName } from "@/lib/seller-tiers";
import { InlinePhoneVerification } from "./InlinePhoneVerification";
import { IdVerificationSection } from "./IdVerificationSection";
import type { UserProps, VerificationAppProps } from "./types";

const TIER_ORDER: SellerTierName[] = ["basic", "phone_verified", "id_verified"];

export function TierProgressionList({
  user,
  verificationApp,
  currentTierName,
  tiers,
  termsAccepted,
  phoneVerified,
  onPhoneVerified,
  onIdSubmitted,
}: {
  user: UserProps;
  verificationApp: VerificationAppProps | null;
  currentTierName: SellerTierName;
  tiers: SellerTier[];
  termsAccepted: boolean;
  phoneVerified: boolean;
  onPhoneVerified: () => void;
  onIdSubmitted: () => void;
}) {
  const router = useRouter();
  const currentTierIndex = TIER_ORDER.indexOf(currentTierName);

  return (
    <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
      <h3 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414] mb-5">
        Seller Tiers
      </h3>

      <div className="space-y-4">
        {tiers.map((tier, i) => {
          const isActive = tier.name === currentTierName;
          const isCompleted = i < currentTierIndex;
          const isNext = i === currentTierIndex + 1;
          const isLocked = i > currentTierIndex + 1;

          return (
            <div
              key={tier.name}
              className={`rounded-xl border p-5 transition-all ${
                isActive
                  ? "border-[#D4A843] bg-[#F5ECD4]/30"
                  : isCompleted
                    ? "border-green-200 bg-green-50/50"
                    : "border-[#E3E0D9]"
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[12px] font-bold ${
                    isCompleted
                      ? "bg-green-500 text-white"
                      : isActive
                        ? "bg-[#D4A843] text-white"
                        : "bg-[#E3E0D9] text-[#9E9A91]"
                  }`}
                >
                  {isCompleted ? "✓" : i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-[14px] text-[#141414]">
                      {tier.label}
                    </p>
                    {isActive && (
                      <span className="text-[10.5px] bg-[#D4A843] text-white px-2 py-0.5 rounded-full font-medium">
                        Current
                      </span>
                    )}
                    {isCompleted && (
                      <span className="text-[10.5px] bg-green-500 text-white px-2 py-0.5 rounded-full font-medium">
                        Unlocked
                      </span>
                    )}
                    {isLocked && (
                      <span className="text-[10.5px] bg-[#E3E0D9] text-[#9E9A91] px-2 py-0.5 rounded-full font-medium">
                        Locked
                      </span>
                    )}
                  </div>
                  <p className="text-[12.5px] text-[#73706A] mt-0.5">
                    {tier.description}
                  </p>

                  {/* Actions for next tier */}
                  {isNext && (
                    <div className="mt-3 space-y-2">
                      {tier.name === "phone_verified" && (
                        <div>
                          {phoneVerified ? (
                            <p className="text-[12.5px] text-green-700">
                              <span className="text-green-500">✓</span> Phone
                              verified
                            </p>
                          ) : (
                            <>
                              <InlinePhoneVerification
                                onVerified={() => {
                                  onPhoneVerified();
                                  router.refresh();
                                }}
                              />
                              <p className="text-[10.5px] text-[#9E9A91] mt-2">
                                Phone verification is required for seller tier
                                progression.{" "}
                                <Link
                                  href="#"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    const el =
                                      document.getElementById("tier-id");
                                    el?.scrollIntoView({
                                      behavior: "smooth",
                                    });
                                  }}
                                  className="text-[#D4A843] hover:underline"
                                >
                                  Skip for now
                                </Link>
                              </p>
                            </>
                          )}
                        </div>
                      )}
                      {tier.name === "id_verified" && (
                        <div id="tier-id">
                          <IdVerificationSection
                            user={user}
                            verificationApp={verificationApp}
                            termsAccepted={termsAccepted}
                            onSubmitted={() => {
                              onIdSubmitted();
                              router.refresh();
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
