import type { Condition, ShippingOption, NZRegion } from "@/types";

// ── Image preview type ────────────────────────────────────────────────────────
export interface ImagePreview {
  id: string;
  url: string;
  file: File;
  r2Key: string | null;
  imageId: string | null;
  uploading: boolean;
  processing: boolean;
  progress: number;
  error: string | null;
  uploaded: boolean;
  isSafe: boolean; // true only after server confirms isScanned + isSafe
  compressedSize: number | null;
  originalSize: number | null;
  dimensions: { width: number; height: number } | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────
export const CONDITIONS: { value: Condition; label: string; hint: string }[] = [
  { value: "new", label: "Brand New", hint: "Unused, in original packaging." },
  {
    value: "like-new",
    label: "Like New",
    hint: "Used briefly, no visible wear.",
  },
  { value: "good", label: "Good", hint: "Used, minor wear, fully functional." },
  { value: "fair", label: "Fair", hint: "Visible wear, works as described." },
  {
    value: "parts",
    label: "Parts Only",
    hint: "Non-functional, sold for parts.",
  },
];

export const NZ_REGIONS: NZRegion[] = [
  "Auckland",
  "Wellington",
  "Canterbury",
  "Waikato",
  "Bay of Plenty",
  "Otago",
  "Hawke's Bay",
  "Manawatū-Whanganui",
  "Northland",
  "Tasman",
  "Nelson",
  "Marlborough",
  "Southland",
  "Taranaki",
  "Gisborne",
  "West Coast",
];

export const STEPS = [
  { number: 1, label: "Photos" },
  { number: 2, label: "Details" },
  { number: 3, label: "Pricing" },
  { number: 4, label: "Shipping" },
];

// Must stay in sync with ALLOWED_MIME_TYPES in src/server/actions/images.ts
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type { Condition, ShippingOption, NZRegion };
