"use client";

import { STEPS } from "./sell-types";

export default function SellWizardProgress({ step }: { step: number }) {
  return (
    <div
      className="flex items-center gap-0 mb-8"
      role="list"
      aria-label="Listing steps"
    >
      {STEPS.map((s, i) => (
        <div
          key={s.number}
          className="flex items-center flex-1"
          role="listitem"
        >
          <div className="flex flex-col items-center gap-1.5 flex-1">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center
                text-[12px] font-bold transition-all duration-200
                ${
                  step === s.number
                    ? "bg-[#141414] text-white shadow-md"
                    : step > s.number
                      ? "bg-[#D4A843] text-white"
                      : "bg-[#EFEDE8] text-[#9E9A91]"
                }`}
              aria-current={step === s.number ? "step" : undefined}
            >
              {step > s.number ? (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                s.number
              )}
            </div>
            <span
              className={`text-[11px] font-medium hidden sm:block ${step === s.number ? "text-[#141414]" : "text-[#9E9A91]"}`}
            >
              {s.label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div
              className={`h-0.5 flex-1 mx-1 transition-colors duration-300 ${step > s.number ? "bg-[#D4A843]" : "bg-[#E3E0D9]"}`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
