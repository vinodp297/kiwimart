"use client";
// src/components/ProblemResolver.tsx
// ─── Unified "I have a problem" Buyer Flow ─────────────────────────────────
// One guided flow that replaces separate buttons for cancel, return, dispute,
// partial refund. Shows contextual options based on order status.

import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { submitProblem } from "@/server/actions/problemResolver";
import type { ProblemType } from "@/server/validators";
import { uploadOrderEvidence } from "@/server/actions/orders";

// ── Types ─────────────────────────────────────────────────────────────────

interface Props {
  orderId: string;
  status: string;
  listingTitle: string;
  sellerName: string;
  totalNzd: number; // dollars
  onClose: () => void;
  onSuccess: () => void;
}

interface ProblemOption {
  type: ProblemType;
  label: string;
  description: string;
  needsPhotos: boolean;
  needsAmount: boolean;
}

// ── Option configs by status ──────────────────────────────────────────────

function getOptionsForStatus(status: string): ProblemOption[] {
  switch (status) {
    case "payment_held":
    case "awaiting_payment":
      return [
        {
          type: "CANCEL",
          label: "I want to cancel my order",
          description: "We'll process your cancellation request",
          needsPhotos: false,
          needsAmount: false,
        },
        {
          type: "SELLER_NOT_SHIPPING",
          label: "The seller hasn't shipped yet",
          description: "We'll check the expected dispatch timeline",
          needsPhotos: false,
          needsAmount: false,
        },
      ];
    case "dispatched":
      return [
        {
          type: "NOT_RECEIVED",
          label: "I haven't received my item",
          description: "We'll check the tracking status and help you",
          needsPhotos: false,
          needsAmount: false,
        },
        {
          type: "ITEM_DAMAGED",
          label: "The item arrived damaged",
          description: "Upload photos so we can help resolve this",
          needsPhotos: true,
          needsAmount: false,
        },
        {
          type: "NOT_AS_DESCRIBED",
          label: "It's not what was described",
          description: "Upload photos showing the difference",
          needsPhotos: true,
          needsAmount: false,
        },
        {
          type: "WRONG_ITEM",
          label: "I received the wrong item",
          description: "Upload photos of what you received",
          needsPhotos: true,
          needsAmount: false,
        },
      ];
    case "delivered":
    case "completed":
      return [
        {
          type: "ITEM_DAMAGED",
          label: "The item is damaged",
          description: "Upload photos showing the damage",
          needsPhotos: true,
          needsAmount: false,
        },
        {
          type: "NOT_AS_DESCRIBED",
          label: "Not what was described",
          description: "Upload photos showing the difference",
          needsPhotos: true,
          needsAmount: false,
        },
        {
          type: "WRONG_ITEM",
          label: "I received the wrong item",
          description: "Upload a photo of what you received",
          needsPhotos: true,
          needsAmount: false,
        },
        {
          type: "MISSING_PARTS",
          label: "Missing parts or accessories",
          description: "Tell us what's missing",
          needsPhotos: false,
          needsAmount: false,
        },
        {
          type: "CHANGED_MIND",
          label: "I changed my mind",
          description: "Request a return within 7 days",
          needsPhotos: false,
          needsAmount: false,
        },
        {
          type: "PARTIAL_REFUND",
          label: "I want a partial refund",
          description: "Request a partial refund for the issue",
          needsPhotos: false,
          needsAmount: true,
        },
      ];
    default:
      return [];
  }
}

// ── Component ─────────────────────────────────────────────────────────────

export default function ProblemResolver({
  orderId,
  status,
  listingTitle,
  sellerName,
  totalNzd,
  onClose,
  onSuccess,
}: Props) {
  const [step, setStep] = useState(1);
  const [selectedProblem, setSelectedProblem] = useState<ProblemOption | null>(
    null,
  );
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoKeys, setPhotoKeys] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    action: string;
    autoResolutionQueued?: boolean;
  } | null>(null);

  const options = getOptionsForStatus(status);

  async function handleUploadPhotos(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      const res = await uploadOrderEvidence(fd, "delivery");
      if (res.success) {
        setPhotoKeys((prev) => [...prev, ...res.data.keys]);
        setPhotos((prev) => [...prev, ...files]);
      } else {
        setError(res.error);
      }
    } catch {
      setError("Failed to upload photos.");
    }
    setUploading(false);
  }

  async function handleSubmit() {
    if (!selectedProblem) return;
    if (description.length < 10) {
      setError("Please describe the issue in at least 10 characters.");
      return;
    }
    if (selectedProblem.needsPhotos && photoKeys.length === 0) {
      setError("Please upload at least one photo showing the issue.");
      return;
    }
    if (selectedProblem.needsAmount && !refundAmount) {
      setError("Please enter a refund amount.");
      return;
    }

    setError(null);
    setLoading(true);

    const res = await submitProblem({
      orderId,
      problemType: selectedProblem.type,
      description,
      evidenceKeys: photoKeys.length > 0 ? photoKeys : undefined,
      refundAmount: refundAmount ? parseFloat(refundAmount) : undefined,
    });

    if (res.success) {
      setResult(res.data);
      setStep(3);
    } else {
      setError(res.error);
    }
    setLoading(false);
  }

  // ── Step 1: What's going on? ────────────────────────────────────

  if (step === 1) {
    return (
      <div>
        <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414] mb-1">
          What&apos;s going on?
        </h2>
        <p className="text-[12.5px] text-[#73706A] mb-4">
          Tell us about the issue with &quot;{listingTitle}&quot;
        </p>

        <div className="space-y-2">
          {options.map((opt) => (
            <button
              key={opt.type}
              type="button"
              onClick={() => {
                setSelectedProblem(opt);
                setStep(2);
              }}
              className="w-full text-left px-4 py-3.5 rounded-xl border border-[#E3E0D9] hover:border-[#D4A843]
                hover:bg-[#FAFAF8] transition group"
            >
              <p className="text-[13px] font-semibold text-[#141414] group-hover:text-[#D4A843]">
                {opt.label}
              </p>
              <p className="text-[11.5px] text-[#9E9A91] mt-0.5">
                {opt.description}
              </p>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 text-[12.5px] text-[#9E9A91] hover:text-[#73706A] transition w-full text-center"
        >
          Never mind, everything&apos;s fine
        </button>
      </div>
    );
  }

  // ── Step 2: Evidence collection ─────────────────────────────────

  if (step === 2 && selectedProblem) {
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            setStep(1);
            setSelectedProblem(null);
            setDescription("");
            setPhotos([]);
            setPhotoKeys([]);
            setError(null);
          }}
          className="text-[12px] text-[#9E9A91] hover:text-[#D4A843] transition mb-3 flex items-center gap-1"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        <h2 className="font-[family-name:var(--font-playfair)] text-[1.05rem] font-semibold text-[#141414] mb-1">
          {selectedProblem.label}
        </h2>
        <p className="text-[12.5px] text-[#73706A] mb-4">
          Help us understand the issue so we can resolve it quickly.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-[12px] text-red-700">
            {error}
          </div>
        )}

        <div className="space-y-4">
          {/* Description */}
          <div>
            <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
              Describe the issue <span className="text-red-500">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell us what happened..."
              rows={3}
              maxLength={2000}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px]
                text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2
                focus:ring-[#D4A843]/25 focus:border-[#D4A843] transition resize-none"
            />
            <p className="text-[11px] text-[#9E9A91] mt-0.5 text-right">
              {description.length}/2000
            </p>
          </div>

          {/* Photos */}
          {selectedProblem.needsPhotos && (
            <div>
              <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                Photos <span className="text-red-500">*</span>
              </label>
              <p className="text-[11.5px] text-[#9E9A91] mb-2">
                Photos help us resolve issues much faster
              </p>

              {photos.length > 0 && (
                <div className="flex gap-2 flex-wrap mb-2">
                  {photos.map((f, i) => (
                    <div
                      key={i}
                      className="relative w-16 h-16 rounded-lg overflow-hidden border border-[#E3E0D9]"
                    >
                      <img
                        src={URL.createObjectURL(f)}
                        alt={`Evidence ${i + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setPhotos((p) => p.filter((_, idx) => idx !== i));
                          setPhotoKeys((k) => k.filter((_, idx) => idx !== i));
                        }}
                        className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {photos.length < 4 && (
                <label
                  className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed cursor-pointer transition text-[12.5px] font-medium
                    ${uploading ? "border-[#D4A843]/40 text-[#9E9A91] cursor-wait" : "border-[#E3E0D9] text-[#73706A] hover:border-[#D4A843] hover:text-[#D4A843]"}`}
                >
                  {uploading ? (
                    "Uploading..."
                  ) : (
                    <>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                      Add photos (JPG, PNG, WebP)
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      handleUploadPhotos(files.slice(0, 4 - photos.length));
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          )}

          {/* Refund amount */}
          {selectedProblem.needsAmount && (
            <div>
              <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                Refund amount (NZD) <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] text-[#9E9A91]">
                  $
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={totalNzd}
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-8 pr-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px]
                    text-[#141414] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843] transition"
                />
              </div>
              <p className="text-[11px] text-[#9E9A91] mt-1">
                Order total: ${totalNzd.toFixed(2)}
              </p>
            </div>
          )}

          <Button
            variant="gold"
            fullWidth
            size="md"
            onClick={handleSubmit}
            loading={loading}
            disabled={
              description.length < 10 ||
              (selectedProblem.needsPhotos && photoKeys.length === 0) ||
              (selectedProblem.needsAmount && !refundAmount) ||
              uploading
            }
          >
            Submit report
          </Button>
        </div>
      </div>
    );
  }

  // ── Step 3: What happens next ───────────────────────────────────

  if (step === 3 && result) {
    const outcomeMessages: Record<
      string,
      { title: string; message: string; next: string[] }
    > = {
      CANCELLED_FREE_WINDOW: {
        title: "Order cancelled",
        message:
          "Your order has been cancelled and a refund is being processed.",
        next: ["Refund will appear in 3-5 business days"],
      },
      CANCEL_REQUESTED: {
        title: "Cancellation requested",
        message: `We've notified ${sellerName}. They have 48 hours to respond.`,
        next: [
          `${sellerName} will review your request`,
          "If they don't respond in 48 hours, it's automatically approved",
          "You'll receive a notification when there's an update",
        ],
      },
      REASSURED_WITHIN_WINDOW: {
        title: "It's still early",
        message: `Sellers typically dispatch within 3 business days. ${sellerName} still has time.`,
        next: [
          "We'll remind the seller if they haven't shipped soon",
          "You can come back if it's still not shipped after 3 days",
        ],
      },
      SHIPPING_DELAY_REPORTED: {
        title: "We've flagged this with the seller",
        message: `${sellerName} has been notified about the dispatch delay.`,
        next: [
          "They have 48 hours to respond",
          "If they don't respond, we'll escalate this for you",
        ],
      },
      RETURN_REQUESTED: {
        title: "Return request submitted",
        message: `${sellerName} has 72 hours to respond to your return request.`,
        next: [
          `${sellerName} will review your request`,
          "If accepted, they'll provide return instructions",
          "If not responded to, it will be escalated to our team",
        ],
      },
      PARTIAL_REFUND_REQUESTED: {
        title: "Partial refund requested",
        message: `${sellerName} has been notified of your partial refund request.`,
        next: [
          "They have 48 hours to accept, reject, or make a counter-offer",
          "You'll be notified of any response",
        ],
      },
      DISPUTE_OPENED: {
        title: result.autoResolutionQueued
          ? "We've reviewed your case"
          : "Report submitted",
        message: result.autoResolutionQueued
          ? `Based on the evidence, we expect this to be resolved in your favour. ${sellerName} has 24 hours to respond with counter-evidence.`
          : `We've notified ${sellerName}. They have 72 hours to respond.`,
        next: result.autoResolutionQueued
          ? [
              `${sellerName} has 24 hours to provide counter-evidence`,
              "If they don't respond, the resolution will proceed",
              "You'll receive updates at every step",
            ]
          : [
              `${sellerName} will be asked to respond`,
              "Our team will review both sides",
              "You'll receive updates at every step",
            ],
      },
    };

    const outcome = outcomeMessages[result.action] ?? {
      title: "Report submitted",
      message: "We're looking into this. You'll hear from us soon.",
      next: ["You'll receive a notification with updates"],
    };

    return (
      <div className="text-center">
        <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#10b981"
            strokeWidth="2.5"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414] mb-2">
          {outcome.title}
        </h2>
        <p className="text-[13px] text-[#73706A] mb-4">{outcome.message}</p>

        <div className="bg-sky-50 rounded-xl border border-sky-200 p-4 text-left mb-4">
          <p className="text-[12.5px] text-sky-800 font-semibold mb-2">
            What happens next
          </p>
          <ol className="text-[12px] text-sky-700 space-y-1.5 list-decimal list-inside">
            {outcome.next.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>

        <Button
          variant="gold"
          fullWidth
          size="md"
          onClick={() => {
            onSuccess();
            onClose();
          }}
        >
          Done
        </Button>
      </div>
    );
  }

  return null;
}
