"use client";
// src/app/(protected)/seller/onboarding/_components/TermsModal.tsx

import { useState, useRef, useEffect } from "react";
import { createEscapeHandler, findFirstFocusable } from "@/lib/a11y";

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

export function TermsModal({
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
  const containerRef = useRef<HTMLDivElement>(null);

  // Escape key closes the modal
  useEffect(() => {
    const handler = createEscapeHandler(onClose);
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Move focus to the first interactive element when the modal opens
  useEffect(() => {
    findFirstFocusable(containerRef.current)?.focus();
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollTop + clientHeight >= scrollHeight - 30) {
      setHasScrolled(true);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex min-h-full items-center justify-center p-4 pt-8">
        <div
          ref={containerRef}
          className="bg-white rounded-2xl w-full max-w-lg flex flex-col shadow-2xl my-4 max-h-[90vh]"
        >
          {/* Header */}
          <div className="bg-[#141414] px-6 py-4 flex items-center justify-between flex-shrink-0">
            <h2
              id="terms-modal-title"
              className="font-semibold text-white text-[16px]"
            >
              Seller Terms & Conditions
            </h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="text-white/60 hover:text-white text-xl leading-none transition-colors"
            >
              <span aria-hidden="true">&times;</span>
              <span className="sr-only">Close</span>
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
