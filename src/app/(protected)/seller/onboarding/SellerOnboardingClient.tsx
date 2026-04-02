"use client";
// src/app/(protected)/seller/onboarding/SellerOnboardingClient.tsx
// ─── Seller Onboarding Client ──────────────────────────────────────────────────

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { acceptSellerTerms } from "@/server/actions/seller";
import {
  requestPhoneVerification,
  verifyPhoneCode,
} from "@/server/actions/verification";
import {
  requestVerificationUpload,
  submitIdVerification,
} from "@/server/actions/verification.documents";
import { updateBusinessDetails } from "@/server/actions/business";
import type { SellerTier, SellerTierName } from "@/lib/seller-tiers";

interface UserProps {
  id: string;
  name: string | null;
  email: string;
  sellerTermsAcceptedAt: string | null;
  phoneVerified: boolean;
  idVerified: boolean;
  idVerifiedAt: string | null;
  idSubmittedAt: string | null;
  stripeOnboarded: boolean;
  nzbn: string | null;
  gstRegistered: boolean;
  gstNumber: string | null;
}

interface VerificationAppProps {
  status: string;
  documentType: string | null;
  adminNotes: string | null;
  appliedAt: string;
}

interface Props {
  user: UserProps;
  verificationApp: VerificationAppProps | null;
  currentTierName: SellerTierName;
  tiers: SellerTier[];
}

const TIER_ORDER: SellerTierName[] = ["basic", "phone_verified", "id_verified"];

// ─── Seller Terms Content ────────────────────────────────────────────────────

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi";

const SELLER_TERMS = `${APP_NAME} SELLER TERMS & CONDITIONS
Last updated: March 2026

1. ELIGIBILITY
You must be 18 years or older and a New Zealand resident or registered NZ business to sell on ${APP_NAME}.

2. LISTING REQUIREMENTS
- All listings must accurately represent the item being sold
- Photos must be of the actual item
- Price must be in NZD
- Condition must be accurately described
- Prohibited items must not be listed

3. PROHIBITED ITEMS
The following are not permitted on ${APP_NAME}:
- Weapons and ammunition
- Illegal goods or substances
- Counterfeit or replica branded items
- Adult content
- Stolen goods
- Items that violate intellectual property

4. FEES & PAYMENTS
- Listing is free
- ${APP_NAME} charges a transaction fee on completed sales
- All payments are processed through ${APP_NAME}'s secure escrow system
- Payouts are made within 3 business days of delivery confirmation

5. ESCROW & DELIVERY
- Payment is held in escrow until the buyer confirms receipt
- You must dispatch within 5 business days of receiving an order
- You must provide accurate tracking information

6. DISPUTES
- ${APP_NAME}'s dispute resolution decisions are final
- You must respond to disputes within 48 hours
- Failure to respond may result in automatic refund to the buyer

7. SELLER CONDUCT
- You must respond to buyer messages within a reasonable time
- You may not solicit off-platform payments
- You may not engage in price manipulation or fake listings

8. ACCOUNT SUSPENSION
${APP_NAME} reserves the right to suspend or terminate seller accounts for:
- Policy violations
- High dispute rates
- Negative buyer feedback patterns
- Fraudulent activity

9. CHANGES TO TERMS
${APP_NAME} may update these terms at any time. Continued use of the platform constitutes acceptance of updated terms.

By accepting, you agree to all terms above and confirm you are eligible to sell on ${APP_NAME}.`;

// ─── Terms Modal ─────────────────────────────────────────────────────────────

function TermsModal({
  onAccept,
  onClose,
  loading,
  readOnly = false,
}: {
  onAccept: () => void;
  onClose: () => void;
  loading: boolean;
  readOnly?: boolean;
}) {
  const [hasScrolled, setHasScrolled] = useState(false);
  const [checked, setChecked] = useState(false);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollTop + clientHeight >= scrollHeight - 30) {
      setHasScrolled(true);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex min-h-full items-center justify-center p-4 pt-8">
        <div className="bg-white rounded-2xl w-full max-w-lg flex flex-col shadow-2xl my-4 max-h-[90vh]">
          {/* Header */}
          <div className="bg-[#141414] px-6 py-4 flex items-center justify-between flex-shrink-0">
            <h2 className="font-semibold text-white text-[16px]">
              Seller Terms & Conditions
            </h2>
            <button
              onClick={onClose}
              className="text-white/60 hover:text-white text-xl leading-none transition-colors"
            >
              &times;
            </button>
          </div>

          {/* Scrollable terms */}
          <div
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto p-6 max-h-[60vh] text-[13px] text-[#73706A] leading-relaxed whitespace-pre-wrap bg-[#FAFAF8]"
          >
            {SELLER_TERMS}
          </div>

          {/* Scroll hint — only when accepting */}
          {!readOnly && !hasScrolled && (
            <div className="bg-[#FFF9EC] border-t border-[#E3E0D9] px-4 py-2 flex-shrink-0">
              <p className="text-[11px] text-[#D4A843] text-center font-medium">
                ↓ Scroll to the bottom to enable acceptance
              </p>
            </div>
          )}

          {/* Footer */}
          <div className="border-t border-[#E3E0D9] p-5 flex-shrink-0 bg-white">
            {readOnly ? (
              /* View-only mode — just a Close button, no checkbox */
              <button
                onClick={onClose}
                className="w-full py-2.5 border border-[#E3E0D9] text-[#73706A] rounded-xl text-[13px] hover:bg-[#F2EFE8] transition-colors"
              >
                Close
              </button>
            ) : (
              /* Accept mode — checkbox + Cancel / Accept */
              <>
                <label
                  className={`flex items-start gap-3 mb-4 cursor-pointer ${
                    !hasScrolled ? "opacity-40 pointer-events-none" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => setChecked(e.target.checked)}
                    disabled={!hasScrolled}
                    className="mt-0.5 w-4 h-4 accent-[#D4A843] flex-shrink-0"
                  />
                  <span className="text-[13px] text-[#141414] leading-relaxed">
                    I have read and agree to{" "}
                    {process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"}&apos;s Seller
                    Terms & Conditions
                  </span>
                </label>

                <div className="flex gap-3">
                  <button
                    onClick={onClose}
                    className="flex-1 py-2.5 border border-[#E3E0D9] text-[#73706A] rounded-xl text-[13px] hover:bg-[#F2EFE8] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={onAccept}
                    disabled={!checked || !hasScrolled || loading}
                    className="flex-[2] py-2.5 bg-[#D4A843] text-[#141414] rounded-xl font-semibold text-[13px] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#C49B35] transition-colors"
                  >
                    {loading ? "Accepting..." : "Accept Terms"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

// ─── Phone Verification Inline ──────────────────────────────────────────────

type PhoneStep = "input" | "code" | "done";

function InlinePhoneVerification({ onVerified }: { onVerified: () => void }) {
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

// ─── ID Document Upload ─────────────────────────────────────────────────────

const DOC_TYPES = [
  { value: "DRIVERS_LICENSE", label: "NZ Driver's Licence" },
  { value: "PASSPORT", label: "NZ Passport" },
  { value: "NZ_FIREARMS_LICENCE", label: "NZ Firearms Licence" },
  { value: "OTHER_GOV_ID", label: "Other Government ID" },
] as const;

function DocumentUploadButton({
  label,
  r2Key,
  onUploaded,
  disabled,
}: {
  label: string;
  r2Key: string | null;
  onUploaded: (key: string) => void;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError("");
    try {
      // Phase 1: Get presigned URL
      const result = await requestVerificationUpload({
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      if (!result.success) {
        setError(result.error);
        setUploading(false);
        return;
      }

      // Phase 2: Upload directly to R2
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", result.data.uploadUrl, true);
      xhr.setRequestHeader("Content-Type", file.type);
      await new Promise<void>((resolve, reject) => {
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error("Upload failed"));
        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.send(file);
      });

      onUploaded(result.data.r2Key);
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <label className="block text-[11px] font-medium text-[#73706A] mb-1">
        {label}
      </label>
      {r2Key ? (
        <div className="flex items-center gap-2 h-9 px-3 rounded-lg border border-green-200 bg-green-50 text-[12px] text-green-700">
          <span>✓</span> Uploaded
        </div>
      ) : (
        <label
          className={`flex items-center justify-center h-9 px-3 rounded-lg border border-dashed
            border-[#E3E0D9] bg-[#FAFAF8] text-[12px] text-[#73706A] cursor-pointer
            hover:border-[#D4A843] hover:text-[#D4A843] transition-colors
            ${disabled || uploading ? "opacity-50 pointer-events-none" : ""}`}
        >
          {uploading ? "Uploading..." : "Choose file"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleFileChange}
            disabled={disabled || uploading}
          />
        </label>
      )}
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </div>
  );
}

function IdVerificationSection({
  user,
  verificationApp,
  termsAccepted,
  onSubmitted,
}: {
  user: UserProps;
  verificationApp: VerificationAppProps | null;
  termsAccepted: boolean;
  onSubmitted: () => void;
}) {
  const [docType, setDocType] = useState<string>("");
  const [frontKey, setFrontKey] = useState<string | null>(null);
  const [backKey, setBackKey] = useState<string | null>(null);
  const [selfieKey, setSelfieKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // State 3: Approved
  if (user.idVerified) {
    return (
      <p className="text-[12.5px] text-green-700">
        ID verified on{" "}
        {user.idVerifiedAt
          ? new Date(user.idVerifiedAt).toLocaleDateString("en-NZ")
          : "\u2014"}
      </p>
    );
  }

  // State 2: Pending
  if (verificationApp?.status === "PENDING") {
    return (
      <div className="space-y-1">
        <p className="text-[12.5px] text-amber-700">
          Your documents are being reviewed. This usually takes 1-2 business
          days.
        </p>
        <p className="text-[11px] text-[#9E9A91]">
          Submitted{" "}
          {new Date(verificationApp.appliedAt).toLocaleDateString("en-NZ", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </p>
      </div>
    );
  }

  // State 4: Rejected
  const isRejected = verificationApp?.status === "REJECTED";

  async function handleSubmit() {
    if (!docType || !frontKey) return;
    setSubmitting(true);
    setError("");
    const result = await submitIdVerification({
      documentType: docType,
      documentFrontKey: frontKey,
      documentBackKey: backKey ?? undefined,
      selfieKey: selfieKey ?? undefined,
    });
    setSubmitting(false);
    if (result.success) {
      onSubmitted();
    } else {
      setError(result.error);
    }
  }

  const needsBack =
    docType === "DRIVERS_LICENSE" || docType === "NZ_FIREARMS_LICENCE";

  return (
    <div className="space-y-3 mt-2">
      {isRejected && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[12px] text-red-700">
          Your previous submission was not approved
          {verificationApp?.adminNotes && (
            <>
              :{" "}
              {verificationApp.adminNotes.split(": ").slice(1).join(": ") ||
                verificationApp.adminNotes}
            </>
          )}
          . You can resubmit below.
        </div>
      )}

      {!termsAccepted && (
        <p className="text-[12.5px] text-[#73706A]">
          Accept the seller terms first, then submit your ID.
        </p>
      )}

      <div>
        <label className="block text-[11px] font-medium text-[#73706A] mb-1">
          Document type
        </label>
        <select
          value={docType}
          onChange={(e) => {
            setDocType(e.target.value);
            setFrontKey(null);
            setBackKey(null);
            setSelfieKey(null);
          }}
          disabled={!termsAccepted}
          className="w-full h-9 px-3 rounded-lg border border-[#E3E0D9] bg-[#FAFAF8]
            text-[13px] text-[#141414] focus:outline-none focus:ring-2
            focus:ring-[#D4A843]/40 focus:border-[#D4A843] disabled:opacity-50"
        >
          <option value="">Select document type...</option>
          {DOC_TYPES.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      {docType && (
        <>
          <DocumentUploadButton
            label="Front of document (required)"
            r2Key={frontKey}
            onUploaded={setFrontKey}
            disabled={!termsAccepted}
          />
          {needsBack && (
            <DocumentUploadButton
              label="Back of document (required)"
              r2Key={backKey}
              onUploaded={setBackKey}
              disabled={!termsAccepted}
            />
          )}
          <DocumentUploadButton
            label="Selfie holding your ID (optional)"
            r2Key={selfieKey}
            onUploaded={setSelfieKey}
            disabled={!termsAccepted}
          />
          <p className="text-[10.5px] text-[#9E9A91]">
            Your documents are encrypted and stored securely. They are only
            visible to {process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"}&apos;s
            verification team.
          </p>
          {error && (
            <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <button
            onClick={handleSubmit}
            disabled={
              !termsAccepted ||
              !frontKey ||
              (needsBack && !backKey) ||
              submitting
            }
            className="inline-flex items-center gap-2 text-[12.5px] font-semibold
              bg-[#141414] text-white px-4 py-2 rounded-lg
              hover:bg-[#2a2a2a] disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors"
          >
            {submitting ? "Submitting\u2026" : "Submit for review"}
          </button>
        </>
      )}
    </div>
  );
}

// ─── Business Details Section ────────────────────────────────────────────────

function BusinessDetailsSection({ user }: { user: UserProps }) {
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

// ─── Main Component ──────────────────────────────────────────────────────────

export default function SellerOnboardingClient({
  user,
  verificationApp,
  currentTierName,
  tiers,
}: Props) {
  const router = useRouter();
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

  const currentTierIndex = TIER_ORDER.indexOf(currentTierName);

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

      {/* Current tier badge */}
      <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[11px] text-[#9E9A91] font-medium uppercase tracking-wide mb-1">
              Your Current Tier
            </p>
            <h2 className="font-[family-name:var(--font-playfair)] text-[1.5rem] font-semibold text-[#141414]">
              {tiers.find((t) => t.name === currentTierName)?.label}
            </h2>
            <p className="text-[13px] text-[#73706A] mt-1">
              {tiers.find((t) => t.name === currentTierName)?.description}
            </p>
          </div>
          <Link
            href="/sell"
            className="shrink-0 inline-flex items-center gap-2 bg-[#141414] text-white text-[13px]
              font-semibold px-4 py-2.5 rounded-xl hover:bg-[#2a2a2a] transition-colors"
          >
            <span>+ Create listing</span>
          </Link>
        </div>

        {/* Perks */}
        <div className="mt-4 flex flex-wrap gap-2">
          {tiers
            .find((t) => t.name === currentTierName)
            ?.perks.map((perk) => (
              <span
                key={perk}
                className="inline-flex items-center gap-1.5 text-[11.5px] bg-[#F8F7F4] border border-[#E3E0D9]
                text-[#73706A] px-3 py-1 rounded-full"
              >
                <span className="text-green-600 font-bold">✓</span> {perk}
              </span>
            ))}
        </div>
      </div>

      {/* Tier progression */}
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
                                    setPhoneVerified(true);
                                    setMessage({
                                      type: "success",
                                      text: "Phone verified! Your tier has been upgraded.",
                                    });
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
                                setMessage({
                                  type: "success",
                                  text: "ID verification submitted. We'll review it within 1\u20132 business days.",
                                });
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

      {/* Stripe CTA */}
      {!user.stripeOnboarded && (
        <div className="bg-white rounded-2xl border border-amber-200 bg-amber-50/50 p-6">
          <div className="flex items-start gap-3">
            <span className="text-2xl">💳</span>
            <div>
              <p className="font-semibold text-[14px] text-[#141414] mb-1">
                Connect Stripe to receive payouts
              </p>
              <p className="text-[12.5px] text-[#73706A] mb-3">
                You need a Stripe account to receive payments from buyers.
              </p>
              <Link
                href="/dashboard/seller"
                className="inline-flex items-center gap-2 text-[12.5px] font-semibold
                  bg-[#635BFF] text-white px-4 py-2 rounded-lg hover:bg-[#5750e5] transition-colors"
              >
                Connect Stripe
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Business Details */}
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
