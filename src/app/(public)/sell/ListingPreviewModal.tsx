"use client";
// src/app/(public)/sell/ListingPreviewModal.tsx
// ─── Listing Preview Modal ──────────────────────────────────────────────────
// Shows the seller exactly how their listing will appear to buyers,
// reusing the product detail page layout with a "Preview" banner.

import { useState, useCallback, useEffect, useRef } from "react";
import { findFirstFocusable } from "@/lib/a11y";
import Image from "next/image";
import type { Condition, ShippingOption, NZRegion } from "@/types";
import CATEGORIES from "@/data/categories";
import { Button } from "@/components/ui/primitives";

interface PreviewImage {
  id: string;
  url: string; // blob URL or R2 URL
  altText: string;
  order: number;
}

interface ListingPreviewProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  price: string;
  condition: Condition | "";
  categoryId: string;
  subcategory: string;
  images: PreviewImage[];
  shippingOption: ShippingOption | "";
  shippingPrice: string;
  region: NZRegion | "";
  suburb: string;
  isOffersEnabled: boolean;
  isGstIncluded: boolean;
  isUrgent: boolean;
  isNegotiable: boolean;
  shipsNationwide: boolean;
}

const CONDITION_LABELS: Record<string, string> = {
  new: "Brand New",
  "like-new": "Like New",
  good: "Good",
  fair: "Fair",
  parts: "Parts Only",
};

const SHIPPING_LABELS: Record<string, string> = {
  courier: "Courier delivery",
  pickup: "Pickup only",
  both: "Courier or pickup",
};

// ── Mini gallery (simplified version of ListingGallery for preview) ─────────
function PreviewGallery({
  images,
  title,
}: {
  images: PreviewImage[];
  title: string;
}) {
  const [active, setActive] = useState(0);

  const prev = useCallback(
    () => setActive((i) => (i - 1 + images.length) % images.length),
    [images.length],
  );
  const next = useCallback(
    () => setActive((i) => (i + 1) % images.length),
    [images.length],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prev, next]);

  if (!images.length) {
    return (
      <div className="bg-[#F8F7F4] rounded-2xl border border-[#E3E0D9] aspect-[4/3] flex items-center justify-center">
        <span className="text-[#9E9A91] text-[14px]">No photos added yet</span>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-[#E3E0D9] overflow-hidden">
      {/* Primary image */}
      <div className="relative aspect-square sm:aspect-[4/3] group bg-[#F8F7F4]">
        {/* Use regular img for blob URLs (Next Image doesn't support blob:) */}
        {images[active]?.url.startsWith("blob:") ? (
          <img
            src={images[active]?.url ?? ""}
            alt={images[active]?.altText || title}
            className="absolute inset-0 w-full h-full object-contain"
          />
        ) : (
          <Image
            src={images[active]?.url ?? ""}
            alt={images[active]?.altText || title}
            fill
            sizes="(max-width: 1024px) 100vw, 65vw"
            className="object-contain"
          />
        )}

        {/* Image counter */}
        {images.length > 1 && (
          <div
            className="absolute bottom-3 left-3 px-2.5 py-1 bg-black/50
              backdrop-blur-sm text-white text-[11px] font-medium rounded-full"
          >
            {active + 1} / {images.length}
          </div>
        )}

        {/* Prev / next arrows */}
        {images.length > 1 && (
          <>
            <button
              onClick={prev}
              aria-label="Previous image"
              className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full
                bg-white/90 backdrop-blur-sm border border-[#E3E0D9] shadow-sm
                flex items-center justify-center opacity-0 group-hover:opacity-100
                hover:bg-white transition-all duration-150"
            >
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
            </button>
            <button
              onClick={next}
              aria-label="Next image"
              className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full
                bg-white/90 backdrop-blur-sm border border-[#E3E0D9] shadow-sm
                flex items-center justify-center opacity-0 group-hover:opacity-100
                hover:bg-white transition-all duration-150"
            >
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
            </button>
          </>
        )}
      </div>

      {/* Thumbnail strip */}
      {images.length > 1 && (
        <div className="flex gap-2 p-3 overflow-x-auto scrollbar-none border-t border-[#F0EDE8]">
          {images.map((img, i) => (
            <button
              key={img.id}
              onClick={() => setActive(i)}
              aria-label={`View image ${i + 1}`}
              className={`relative w-16 h-16 shrink-0 rounded-xl overflow-hidden
                border-2 transition-all duration-150
                ${
                  i === active
                    ? "border-[#D4A843] shadow-md"
                    : "border-transparent opacity-60 hover:opacity-100 hover:border-[#C9C5BC]"
                }`}
            >
              <img
                src={img.url}
                alt={img.altText || `Image ${i + 1}`}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Preview Modal ──────────────────────────────────────────────────────
export default function ListingPreviewModal(props: ListingPreviewProps) {
  const {
    open,
    onClose,
    title,
    description,
    price,
    condition,
    categoryId,
    subcategory,
    images,
    shippingOption,
    shippingPrice,
    region,
    suburb,
    isOffersEnabled,
    isGstIncluded,
    isUrgent,
    isNegotiable,
    shipsNationwide,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);

  // Lock body scroll when open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Move focus to the first interactive element when the modal opens
  useEffect(() => {
    if (open) findFirstFocusable(containerRef.current)?.focus();
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const categoryName =
    CATEGORIES.find((c) => c.id === categoryId)?.name ?? "Uncategorised";
  const priceNum = parseFloat(price) || 0;
  const formattedPrice = priceNum > 0 ? `$${priceNum.toFixed(2)}` : "$0.00";
  const shippingPriceNum = parseFloat(shippingPrice) || 0;
  const conditionLabel = condition
    ? (CONDITION_LABELS[condition] ?? condition)
    : "Not set";
  const shippingLabel = shippingOption
    ? (SHIPPING_LABELS[shippingOption] ?? shippingOption)
    : "Not set";

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[8000] bg-black/60 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="listing-preview-modal-title"
      onClick={onClose}
    >
      {/* Preview banner */}
      <div className="sticky top-0 z-10 bg-[#141414] text-white text-center py-3 px-4 shadow-lg">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span
              id="listing-preview-modal-title"
              className="text-[13px] font-semibold"
            >
              Preview — This is how your listing will appear to buyers
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            Close preview
          </Button>
        </div>
      </div>

      {/* Content (stop propagation so clicking inside doesn't close) */}
      <div
        className="bg-[#FAFAF8] min-h-screen"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1.5 text-[12px] text-[#9E9A91] mb-5">
            <span className="hover:text-[#141414] cursor-default">Home</span>
            <span>/</span>
            <span className="hover:text-[#141414] cursor-default">
              {categoryName}
            </span>
            {subcategory && (
              <>
                <span>/</span>
                <span className="hover:text-[#141414] cursor-default">
                  {subcategory}
                </span>
              </>
            )}
            <span>/</span>
            <span className="text-[#141414] font-medium truncate max-w-[200px]">
              {title || "Untitled listing"}
            </span>
          </nav>

          {/* ── Main 2-col layout (mirrors product detail page) ──────── */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8">
            {/* ── Left column ────────────────────────────────────────── */}
            <div className="min-w-0">
              <PreviewGallery images={images} title={title || "Untitled"} />

              {/* ── Description ─────────────────────────────────────── */}
              <section className="mt-8 bg-white rounded-2xl border border-[#E3E0D9] p-6">
                <h2
                  className="font-[family-name:var(--font-playfair)] text-[1.15rem]
                    font-semibold text-[#141414] mb-4"
                >
                  Description
                </h2>
                <div className="prose prose-sm max-w-none text-[#141414]">
                  {description ? (
                    description.split("\n").map((para, i) =>
                      para.trim() ? (
                        <p
                          key={i}
                          className="text-[13.5px] text-[#73706A] leading-relaxed mb-3 last:mb-0"
                        >
                          {para}
                        </p>
                      ) : (
                        <br key={i} />
                      ),
                    )
                  ) : (
                    <p className="text-[13.5px] text-[#9E9A91] italic">
                      No description added yet
                    </p>
                  )}
                </div>
              </section>
            </div>

            {/* ── Right column (sticky) ──────────────────────────────── */}
            <div className="flex flex-col gap-4">
              {/* Price / action panel */}
              <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6 sticky top-20">
                {/* Title + condition */}
                <h1
                  className="font-[family-name:var(--font-playfair)] text-[1.5rem]
                    font-semibold text-[#141414] leading-tight mb-2"
                >
                  {title || "Untitled listing"}
                </h1>

                <div className="flex items-center gap-2 mb-4">
                  <span className="text-[11.5px] font-medium text-[#73706A] bg-[#F0EDE8] px-2 py-0.5 rounded-full">
                    {conditionLabel}
                  </span>
                  {isUrgent && (
                    <span className="text-[11.5px] font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                      Urgent
                    </span>
                  )}
                  {isNegotiable && (
                    <span className="text-[11.5px] font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                      Negotiable
                    </span>
                  )}
                </div>

                {/* Price */}
                <div className="mb-5">
                  <p className="text-[2rem] font-bold text-[#141414] tracking-tight">
                    {formattedPrice}
                  </p>
                  {isGstIncluded && (
                    <p className="text-[11.5px] text-[#9E9A91]">GST included</p>
                  )}
                </div>

                {/* Action buttons (disabled in preview) */}
                <div className="space-y-2.5">
                  <button
                    disabled
                    className="w-full py-3 px-6 bg-[#D4A843] text-[#141414] font-semibold
                      text-[15px] rounded-full opacity-60 cursor-not-allowed"
                  >
                    Buy Now
                  </button>
                  {isOffersEnabled && (
                    <button
                      disabled
                      className="w-full py-3 px-6 bg-white text-[#141414] font-semibold
                        text-[15px] rounded-full border border-[#C9C5BC] opacity-60 cursor-not-allowed"
                    >
                      Make an Offer
                    </button>
                  )}
                  <button
                    disabled
                    className="w-full py-2.5 px-6 text-[#73706A] font-medium
                      text-[13px] rounded-full opacity-60 cursor-not-allowed flex items-center justify-center gap-1.5"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                    </svg>
                    Add to Watchlist
                  </button>
                </div>
              </div>

              {/* Shipping info */}
              <div className="bg-white rounded-2xl border border-[#E3E0D9] p-5">
                <h3 className="text-[13px] font-semibold text-[#141414] mb-3">
                  Shipping & pickup
                </h3>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[13px] text-[#73706A]">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <rect x="1" y="3" width="15" height="13" rx="2" />
                      <polyline points="16 8 20 8 23 11 23 16 17 16" />
                      <circle cx="5.5" cy="18.5" r="2.5" />
                      <circle cx="18.5" cy="18.5" r="2.5" />
                    </svg>
                    <span>{shippingLabel}</span>
                  </div>
                  {(shippingOption === "courier" ||
                    shippingOption === "both") && (
                    <p className="text-[12px] text-[#9E9A91] ml-6">
                      {shippingPriceNum === 0
                        ? "Free shipping"
                        : `$${shippingPriceNum.toFixed(2)} shipping`}
                    </p>
                  )}
                  {shipsNationwide && (
                    <div className="flex items-center gap-2 text-[13px] text-emerald-600">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>Ships anywhere in NZ</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Location */}
              <div className="bg-white rounded-2xl border border-[#E3E0D9] p-5">
                <h3 className="text-[13px] font-semibold text-[#141414] mb-2">
                  Location
                </h3>
                <div className="flex items-center gap-2 text-[13px] text-[#73706A]">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <span>
                    {suburb && region
                      ? `${suburb}, ${region}`
                      : region || "Location not set"}
                  </span>
                </div>
              </div>

              {/* Meta info */}
              <div className="bg-white rounded-2xl border border-[#E3E0D9] p-4 text-[12px] text-[#9E9A91] space-y-1.5">
                <div className="flex items-center justify-between">
                  <span>Category</span>
                  <span className="font-medium text-[#141414]">
                    {categoryName}
                    {subcategory ? ` > ${subcategory}` : ""}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Photos</span>
                  <span className="font-medium text-[#141414]">
                    {images.length}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Listed</span>
                  <span className="font-medium text-[#141414]">
                    {new Date().toLocaleDateString("en-NZ", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
