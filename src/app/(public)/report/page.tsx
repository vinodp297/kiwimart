"use client";
// src/app/(public)/report/page.tsx
// ─── Report Listing / User Form ───────────────────────────────────────────────

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createReport } from "@/server/actions/reports";

// Matches the enum in src/server/actions/reports.ts
const REPORT_REASONS = [
  {
    value: "SCAM",
    label: "Suspected scam",
    desc: "Seller is asking for payment outside the platform or seems fraudulent",
  },
  {
    value: "COUNTERFEIT",
    label: "Counterfeit / fake brand",
    desc: "Listing is selling counterfeit or fake branded goods",
  },
  {
    value: "PROHIBITED",
    label: "Prohibited item",
    desc: "Item is illegal or against KiwiMart policy",
  },
  {
    value: "OFFENSIVE",
    label: "Offensive content",
    desc: "Listing contains hateful, violent, or inappropriate content",
  },
  {
    value: "SPAM",
    label: "Spam or duplicate",
    desc: "Same item posted repeatedly or misleading listing",
  },
  {
    value: "OTHER",
    label: "Other",
    desc: "Something else not listed above",
  },
] as const;

function ReportForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const listingId = searchParams.get("listing") ?? undefined;
  const targetUserId = searchParams.get("user") ?? undefined;

  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-[#E3E0D9] p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-[#F0FDF4] rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">✅</span>
          </div>
          <h1 className="font-semibold text-[20px] text-[#141414] mb-2">
            Report submitted
          </h1>
          <p className="text-[#73706A] text-[14px] mb-6 leading-relaxed">
            Thank you for helping keep KiwiMart safe. Our moderation team will
            review this report within 24 hours.
          </p>
          <a
            href="/"
            className="inline-block bg-[#141414] text-white px-6 py-2.5 rounded-xl text-[14px] font-medium"
          >
            Back to KiwiMart
          </a>
        </div>
      </div>
    );
  }

  const handleSubmit = async () => {
    if (!reason) {
      setError("Please select a reason");
      return;
    }
    if (description.trim().length < 10) {
      setError("Please provide more details (minimum 10 characters)");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const result = await createReport({
        listingId,
        targetUserId,
        reason: reason as
          | "SCAM"
          | "COUNTERFEIT"
          | "PROHIBITED"
          | "OFFENSIVE"
          | "SPAM"
          | "OTHER",
        description: description.trim(),
      });
      if (result.success) {
        setSubmitted(true);
      } else {
        setError(
          result.error ??
            "Your report couldn't be submitted. Please try again.",
        );
        setLoading(false);
      }
    } catch {
      setError(
        "Your report couldn't be submitted. Please check your connection and try again.",
      );
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-[#E3E0D9] p-8 max-w-lg w-full">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-[#FEF2F2] rounded-xl flex items-center justify-center">
            <span className="text-xl">🚩</span>
          </div>
          <div>
            <h1 className="font-semibold text-[18px] text-[#141414]">
              {listingId
                ? "Report listing"
                : targetUserId
                  ? "Report user"
                  : "Report a problem"}
            </h1>
            <p className="text-[#73706A] text-[12px]">
              Help us keep KiwiMart safe
            </p>
          </div>
        </div>

        <div className="space-y-3 mb-6">
          <p className="text-[13px] font-semibold text-[#141414]">
            What is the issue?
          </p>
          {REPORT_REASONS.map((r) => (
            <label
              key={r.value}
              className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                reason === r.value
                  ? "border-[#D4A843] bg-[#FFF9EC]"
                  : "border-[#E3E0D9] hover:border-[#D4A843]/40"
              }`}
            >
              <input
                type="radio"
                name="reason"
                value={r.value}
                checked={reason === r.value}
                onChange={() => setReason(r.value)}
                className="mt-0.5 accent-[#D4A843]"
              />
              <div>
                <p className="font-medium text-[13px] text-[#141414]">
                  {r.label}
                </p>
                <p className="text-[12px] text-[#73706A] mt-0.5">{r.desc}</p>
              </div>
            </label>
          ))}
        </div>

        <div className="mb-6">
          <label className="block text-[13px] font-semibold text-[#141414] mb-2">
            Additional details <span className="text-[#dc2626]">*</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Please describe the issue in detail..."
            rows={4}
            maxLength={2000}
            className="w-full px-4 py-3 border border-[#E3E0D9] rounded-xl text-[14px] text-[#141414] resize-none focus:outline-none focus:border-[#D4A843] focus:ring-1 focus:ring-[#D4A843]"
          />
          <p className="text-[11px] text-[#C9C5BC] mt-1">
            {description.length}/2000 characters
          </p>
        </div>

        {error && (
          <div className="bg-[#FEF2F2] text-[#dc2626] text-[13px] px-4 py-3 rounded-xl mb-4">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => router.back()}
            className="flex-1 py-3 border border-[#E3E0D9] rounded-xl text-[14px] text-[#73706A] hover:bg-[#FAFAF8] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !reason}
            className="flex-1 py-3 bg-[#dc2626] text-white rounded-xl text-[14px] font-medium disabled:opacity-50 hover:bg-[#b91c1c] transition-colors"
          >
            {loading ? "Submitting..." : "Submit report"}
          </button>
        </div>

        <p className="text-[11px] text-[#C9C5BC] text-center mt-4">
          False reports may result in account restrictions.
        </p>
      </div>
    </div>
  );
}

export default function ReportPage() {
  return (
    <Suspense>
      <ReportForm />
    </Suspense>
  );
}
