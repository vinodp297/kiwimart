"use client";

import { Input } from "@/components/ui/primitives";
import {
  toCents,
  calculateStripeFee,
  fromCents,
  DEFAULT_PLATFORM_FEE_RATE,
} from "@/lib/currency";

const PLATFORM_FEE_MIN_CENTS = 50; // $0.50
const PLATFORM_FEE_MAX_CENTS = 5000; // $50.00

function calcPlatformFee(grossCents: number): number {
  return Math.max(
    PLATFORM_FEE_MIN_CENTS,
    Math.min(
      PLATFORM_FEE_MAX_CENTS,
      Math.round(grossCents * DEFAULT_PLATFORM_FEE_RATE),
    ),
  );
}

interface CheckboxOptionProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint: string;
  accentClass?: string;
  borderHoverClass?: string;
}

function CheckboxOption({
  checked,
  onChange,
  label,
  hint,
  accentClass = "accent-[#D4A843]",
  borderHoverClass = "hover:border-[#D4A843]",
}: CheckboxOptionProps) {
  return (
    <label
      className={`flex items-start gap-3 cursor-pointer select-none p-3.5
      rounded-xl border border-[#E3E0D9] ${borderHoverClass} transition-colors`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={`mt-0.5 w-4 h-4 ${accentClass} cursor-pointer`}
      />
      <div>
        <p className="text-[13px] font-semibold text-[#141414]">{label}</p>
        <p className="text-[12px] text-[#9E9A91] mt-0.5">{hint}</p>
      </div>
    </label>
  );
}

interface SellStep3PricingProps {
  price: string;
  isOffersEnabled: boolean;
  isGstIncluded: boolean;
  isUrgent: boolean;
  isNegotiable: boolean;
  shipsNationwide: boolean;
  errors: Record<string, string>;
  onPriceChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onOffersEnabledChange: (v: boolean) => void;
  onGstIncludedChange: (v: boolean) => void;
  onIsUrgentChange: (v: boolean) => void;
  onIsNegotiableChange: (v: boolean) => void;
  onShipsNationwideChange: (v: boolean) => void;
  onPriceBlur?: () => void;
}

export default function SellStep3Pricing({
  price,
  isOffersEnabled,
  isGstIncluded,
  isUrgent,
  isNegotiable,
  shipsNationwide,
  errors,
  onPriceChange,
  onOffersEnabledChange,
  onGstIncludedChange,
  onIsUrgentChange,
  onIsNegotiableChange,
  onShipsNationwideChange,
  onPriceBlur,
}: SellStep3PricingProps) {
  return (
    <div className="p-6 space-y-5">
      <h2
        className="font-[family-name:var(--font-playfair)] text-[1.15rem]
        font-semibold text-[#141414]"
      >
        Set your price
      </h2>

      <Input
        label="Asking price (NZD)"
        type="number"
        value={price}
        onChange={onPriceChange}
        onBlur={onPriceBlur}
        placeholder="0.00"
        min={0.01}
        max={100000}
        step={0.01}
        required
        error={errors.price}
        leftAddon={<span className="text-[13px] font-medium">$</span>}
        hint="Enter the price you want to receive. Buyzi charges 0% listing fees."
      />

      {/* Fee breakdown */}
      {price && !isNaN(Number(price)) && Number(price) > 0 && (
        <div className="rounded-xl border border-[#E3E0D9] divide-y divide-[#F0EDE8]">
          {(() => {
            const grossCents = toCents(Number(price));
            const stripeFee = calculateStripeFee(grossCents);
            const platformFee = calcPlatformFee(grossCents);
            const youReceiveCents = grossCents - stripeFee - platformFee;
            return [
              {
                label: "Listing price",
                value: `$${Number(price).toFixed(2)}`,
              },
              {
                label: "Buyzi listing fee",
                value: "$0.00",
                highlight: true,
              },
              {
                label: "Platform fee (3.5% est.)",
                value: `-$${fromCents(platformFee).toFixed(2)}`,
              },
              {
                label: "Payment processing (est.)",
                value: `-$${fromCents(stripeFee).toFixed(2)}`,
              },
              {
                label: "You receive",
                value: `$${fromCents(youReceiveCents).toFixed(2)}`,
                bold: true,
              },
            ];
          })().map(({ label, value, highlight, bold }) => (
            <div
              key={label}
              className="flex justify-between px-4 py-2.5 text-[12.5px]"
            >
              <span className="text-[#73706A]">{label}</span>
              <span
                className={`font-medium ${highlight ? "text-emerald-600" : bold ? "text-[#141414] font-bold" : "text-[#141414]"}`}
              >
                {value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Options */}
      <div className="space-y-3">
        <CheckboxOption
          checked={isOffersEnabled}
          onChange={onOffersEnabledChange}
          label="Accept offers"
          hint="Buyers can make lower offers. You choose to accept or decline."
        />
        <CheckboxOption
          checked={isGstIncluded}
          onChange={onGstIncludedChange}
          label="GST included in price"
          hint="Only if you're a GST-registered NZ business (IRD number required)."
        />
        <CheckboxOption
          checked={isUrgent}
          onChange={onIsUrgentChange}
          label="🔥 Urgent sale"
          hint="Highlights your listing to buyers looking for quick deals."
          accentClass="accent-red-500"
          borderHoverClass="hover:border-red-300"
        />
        <CheckboxOption
          checked={isNegotiable}
          onChange={onIsNegotiableChange}
          label="💬 Price is negotiable"
          hint="Signals to buyers that you're open to a lower price discussion."
          accentClass="accent-blue-500"
          borderHoverClass="hover:border-blue-300"
        />
        <CheckboxOption
          checked={shipsNationwide}
          onChange={onShipsNationwideChange}
          label="📦 Ships anywhere in NZ"
          hint='Your listing will appear in the "Ships NZ wide" filter.'
          accentClass="accent-emerald-500"
          borderHoverClass="hover:border-emerald-300"
        />
      </div>
    </div>
  );
}
