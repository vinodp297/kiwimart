"use client";
// src/app/(protected)/seller/onboarding/_components/BusinessDetailsSection.tsx

import { useState } from "react";
import { updateBusinessDetails } from "@/server/actions/business";
import type { UserProps } from "./types";

export function BusinessDetailsSection({ user }: { user: UserProps }) {
  const [isBusiness, setIsBusiness] = useState(!!user.nzbn);
  const [nzbn, setNzbn] = useState(user.nzbn ?? "");
  const [gstRegistered, setGstRegistered] = useState(user.gstRegistered);
  const [gstNumber, setGstNumber] = useState(user.gstNumber ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError("");
    setSaved(false);
    const result = await updateBusinessDetails({
      isBusinessSeller: isBusiness,
      nzbn: isBusiness ? nzbn : "",
      gstRegistered: isBusiness ? gstRegistered : false,
      gstNumber: isBusiness && gstRegistered ? gstNumber : "",
    });
    setSaving(false);
    if (result.success) {
      setSaved(true);
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
      <h3 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414] mb-1">
        Business Details
      </h3>
      <p className="text-[12.5px] text-[#73706A] mb-4">
        Optional — provide your business details for transparency and
        compliance.
      </p>

      {error && (
        <div className="mb-3 p-3 rounded-xl bg-red-50 border border-red-200 text-[12px] text-red-700">
          {error}
        </div>
      )}
      {saved && (
        <div className="mb-3 p-3 rounded-xl bg-green-50 border border-green-200 text-[12px] text-green-700">
          Business details saved.
        </div>
      )}

      {/* Toggle */}
      <label className="flex items-center gap-3 mb-4 cursor-pointer">
        <div
          onClick={() => setIsBusiness(!isBusiness)}
          className={`relative w-10 h-5 rounded-full transition-colors ${
            isBusiness ? "bg-[#D4A843]" : "bg-[#E3E0D9]"
          }`}
        >
          <div
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              isBusiness ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </div>
        <span className="text-[13px] text-[#141414] font-medium">
          I&apos;m selling as a business
        </span>
      </label>

      {isBusiness && (
        <div className="space-y-3 ml-1">
          {/* NZBN */}
          <div>
            <label className="block text-[11px] font-medium text-[#73706A] mb-1">
              NZBN (New Zealand Business Number)
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={nzbn}
              onChange={(e) =>
                setNzbn(e.target.value.replace(/\D/g, "").slice(0, 13))
              }
              placeholder="1234567890123"
              maxLength={13}
              className="w-full h-9 px-3 rounded-lg border border-[#E3E0D9] bg-[#FAFAF8]
                text-[13px] text-[#141414] font-mono tracking-wider
                placeholder:text-[#C9C5BC] placeholder:tracking-normal placeholder:font-sans
                focus:outline-none focus:ring-2 focus:ring-[#D4A843]/40 focus:border-[#D4A843]"
            />
            <p className="text-[10.5px] text-[#9E9A91] mt-1">
              13-digit number from the{" "}
              <a
                href="https://www.nzbn.govt.nz"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#D4A843] hover:underline"
              >
                NZ Business Number register
              </a>
            </p>
          </div>

          {/* GST Registered */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={gstRegistered}
              onChange={(e) => setGstRegistered(e.target.checked)}
              className="w-4 h-4 accent-[#D4A843]"
            />
            <span className="text-[13px] text-[#141414]">GST Registered</span>
          </label>

          {/* GST Number */}
          {gstRegistered && (
            <div>
              <label className="block text-[11px] font-medium text-[#73706A] mb-1">
                GST Number
              </label>
              <input
                type="text"
                value={gstNumber}
                onChange={(e) => {
                  // Auto-format: XX-XXX-XXX
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 9);
                  let formatted = digits;
                  if (digits.length > 2)
                    formatted = digits.slice(0, 2) + "-" + digits.slice(2);
                  if (digits.length > 5)
                    formatted = formatted.slice(0, 6) + "-" + digits.slice(5);
                  setGstNumber(formatted);
                }}
                placeholder="XX-XXX-XXX"
                maxLength={10}
                className="w-full h-9 px-3 rounded-lg border border-[#E3E0D9] bg-[#FAFAF8]
                  text-[13px] text-[#141414] font-mono
                  placeholder:text-[#C9C5BC] placeholder:font-sans
                  focus:outline-none focus:ring-2 focus:ring-[#D4A843]/40 focus:border-[#D4A843]"
              />
            </div>
          )}

          {/* Info text */}
          <div className="bg-[#F8F7F4] border border-[#E3E0D9] rounded-lg p-3">
            <p className="text-[11px] text-[#73706A] leading-relaxed">
              Business sellers have obligations under the Consumer Guarantees
              Act. Providing your NZBN helps buyers identify you as a registered
              business.{" "}
              <a
                href="https://www.business.govt.nz/risks-and-compliance/consumer-law/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#D4A843] hover:underline"
              >
                Learn more about your obligations
              </a>
            </p>
          </div>

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={saving || (isBusiness && nzbn.length !== 13)}
            className="inline-flex items-center gap-2 text-[12.5px] font-semibold
              bg-[#141414] text-white px-4 py-2 rounded-lg
              hover:bg-[#2a2a2a] disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors"
          >
            {saving ? "Saving..." : "Save business details"}
          </button>
        </div>
      )}

      {/* Clear business details if toggle off */}
      {!isBusiness && user.nzbn && (
        <div>
          <p className="text-[11px] text-[#73706A] mb-2">
            Your business details will be removed.
          </p>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-[12px] text-red-600 hover:underline disabled:opacity-50"
          >
            {saving ? "Saving..." : "Clear business details"}
          </button>
        </div>
      )}
    </div>
  );
}
