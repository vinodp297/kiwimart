"use client";

import { Input, Select, Alert } from "@/components/ui/primitives";
import CATEGORIES from "@/data/categories";
import { CONDITIONS, NZ_REGIONS } from "./sell-types";
import type { ShippingOption, NZRegion, ImagePreview } from "./sell-types";

interface SellStep4ShippingProps {
  shippingOption: ShippingOption | "";
  shippingPrice: string;
  region: NZRegion | "";
  suburb: string;
  errors: Record<string, string>;
  submitError: string;
  // Summary data
  title: string;
  price: string;
  condition: string;
  categoryId: string;
  images: ImagePreview[];
  onShippingOptionChange: (value: ShippingOption) => void;
  onShippingPriceChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRegionChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onSuburbChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export default function SellStep4Shipping({
  shippingOption,
  shippingPrice,
  region,
  suburb,
  errors,
  submitError,
  title,
  price,
  condition,
  categoryId,
  images,
  onShippingOptionChange,
  onShippingPriceChange,
  onRegionChange,
  onSuburbChange,
}: SellStep4ShippingProps) {
  return (
    <div className="p-6 space-y-5">
      <h2
        className="font-[family-name:var(--font-playfair)] text-[1.15rem]
        font-semibold text-[#141414]"
      >
        Shipping & location
      </h2>

      {submitError && <Alert variant="error">{submitError}</Alert>}

      {/* Shipping option */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[12.5px] font-semibold text-[#141414]">
          How will you deliver? <span className="text-red-500">*</span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(
            [
              {
                value: "courier",
                label: "📦 Courier",
                hint: "Ship nationwide",
              },
              {
                value: "pickup",
                label: "🤝 Pickup only",
                hint: "Buyer collects",
              },
              {
                value: "both",
                label: "✅ Both options",
                hint: "Flexible",
              },
            ] as {
              value: ShippingOption;
              label: string;
              hint: string;
            }[]
          ).map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onShippingOptionChange(o.value)}
              className={`flex flex-col gap-1 p-4 rounded-xl border-2 text-left
                transition-all duration-150
                ${
                  shippingOption === o.value
                    ? "border-[#141414] bg-[#141414] text-white"
                    : "border-[#E3E0D9] hover:border-[#C9C5BC] text-[#141414]"
                }`}
            >
              <span className="text-[13px] font-semibold">{o.label}</span>
              <span
                className={`text-[11.5px] ${shippingOption === o.value ? "text-white/70" : "text-[#9E9A91]"}`}
              >
                {o.hint}
              </span>
            </button>
          ))}
        </div>
        {errors.shippingOption && (
          <p className="text-[11.5px] text-red-500 font-medium">
            {errors.shippingOption}
          </p>
        )}
      </div>

      {/* Courier price */}
      {(shippingOption === "courier" || shippingOption === "both") && (
        <Input
          label="Courier price (NZD)"
          type="number"
          value={shippingPrice}
          onChange={onShippingPriceChange}
          placeholder="0 for free shipping"
          min={0}
          error={errors.shippingPrice}
          leftAddon={<span className="text-[13px] font-medium">$</span>}
          hint="Enter 0 to offer free shipping — this can improve your listing visibility."
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Select
          label="Region"
          value={region}
          onChange={onRegionChange}
          placeholder="Select region"
          required
          error={errors.region}
        >
          {NZ_REGIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>

        <Input
          label="Suburb / town"
          value={suburb}
          onChange={onSuburbChange}
          placeholder="e.g. Ponsonby"
          required
          error={errors.suburb}
          hint="Only your suburb is shown publicly — not your full address."
        />
      </div>

      {/* Listing summary */}
      <div className="rounded-xl bg-[#F8F7F4] border border-[#EFEDE8] p-4 space-y-2">
        <p className="text-[12px] font-semibold text-[#9E9A91] uppercase tracking-wide">
          Listing summary
        </p>
        <p className="text-[14px] font-semibold text-[#141414] line-clamp-1">
          {title || "Your item"}
        </p>
        <p className="text-[13px] text-[#73706A]">
          {price ? `$${price}` : "Price not set"}
          {condition
            ? ` · ${CONDITIONS.find((c) => c.value === condition)?.label}`
            : ""}
          {categoryId
            ? ` · ${CATEGORIES.find((c) => c.id === categoryId)?.name}`
            : ""}
        </p>
        <p className="text-[12px] text-[#9E9A91]">
          {images.filter((i) => i.uploaded).length} photo
          {images.filter((i) => i.uploaded).length !== 1 ? "s" : ""} uploaded
        </p>
      </div>
    </div>
  );
}
