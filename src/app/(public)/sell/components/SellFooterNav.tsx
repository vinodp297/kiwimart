"use client";

import Link from "next/link";
import { Button } from "@/components/ui/primitives";

interface SellFooterNavProps {
  step: number;
  submitting: boolean;
  savingDraft: boolean;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
  onPreview: () => void;
  onSaveDraft: () => void;
}

export default function SellFooterNav({
  step,
  submitting,
  savingDraft,
  onBack,
  onNext,
  onSubmit,
  onPreview,
  onSaveDraft,
}: SellFooterNavProps) {
  return (
    <div
      className="px-6 py-4 bg-[#F8F7F4] border-t border-[#E3E0D9]
      flex items-center justify-between gap-3"
    >
      {step > 1 ? (
        <Button variant="ghost" size="md" onClick={onBack}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back
        </Button>
      ) : (
        <Link href="/">
          <Button variant="ghost" size="md">
            Cancel
          </Button>
        </Link>
      )}

      <div className="flex items-center gap-2">
        {step === 4 && (
          <>
            <Button variant="ghost" size="md" onClick={onPreview}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              Preview
            </Button>
            <Button
              variant="secondary"
              size="md"
              loading={savingDraft}
              onClick={onSaveDraft}
            >
              Save as Draft
            </Button>
          </>
        )}
        {step < 4 ? (
          <Button variant="primary" size="md" onClick={onNext}>
            Continue
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </Button>
        ) : (
          <Button
            variant="gold"
            size="md"
            loading={submitting}
            onClick={onSubmit}
          >
            Publish listing
          </Button>
        )}
      </div>
    </div>
  );
}
