"use client";
// src/app/(protected)/sell/edit/[id]/page.tsx
// ─── Edit Listing Page ──────────────────────────────────────────────────────
// Pre-populates the listing form with existing data and calls updateListing
// on submit. Only the listing owner can access.

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import {
  Button,
  Input,
  Textarea,
  Select,
  Alert,
} from "@/components/ui/primitives";
import CATEGORIES from "@/data/categories";
import { getListingForEdit, updateListing } from "@/server/actions/listings";
import {
  requestImageUpload,
  confirmImageUpload,
  deleteListingImage,
  reorderListingImages,
} from "@/server/actions/images";
import { getImageUrl } from "@/lib/image";
import type { Condition, ShippingOption, NZRegion } from "@/types";

// ── Constants ─────────────────────────────────────────────────────────────────
const CONDITIONS: { value: Condition; label: string; dbValue: string }[] = [
  { value: "new", label: "Brand New", dbValue: "NEW" },
  { value: "like-new", label: "Like New", dbValue: "LIKE_NEW" },
  { value: "good", label: "Good", dbValue: "GOOD" },
  { value: "fair", label: "Fair", dbValue: "FAIR" },
  { value: "parts", label: "Parts Only", dbValue: "PARTS" },
];

const NZ_REGIONS: NZRegion[] = [
  "Auckland",
  "Wellington",
  "Canterbury",
  "Waikato",
  "Bay of Plenty",
  "Otago",
  "Hawke's Bay",
  "Manawat\u016b-Whanganui",
  "Northland",
  "Tasman",
  "Nelson",
  "Marlborough",
  "Southland",
  "Taranaki",
  "Gisborne",
  "West Coast",
];

const SHIPPING_OPTIONS: {
  value: ShippingOption;
  label: string;
  dbValue: string;
}[] = [
  { value: "courier", label: "Courier", dbValue: "COURIER" },
  { value: "pickup", label: "Pickup only", dbValue: "PICKUP" },
  { value: "both", label: "Both options", dbValue: "BOTH" },
];

// Map DB enum values to form values
function dbConditionToForm(dbVal: string): Condition {
  const map: Record<string, Condition> = {
    NEW: "new",
    LIKE_NEW: "like-new",
    GOOD: "good",
    FAIR: "fair",
    PARTS: "parts",
  };
  return map[dbVal] ?? "good";
}

function dbShippingToForm(dbVal: string): ShippingOption {
  const map: Record<string, ShippingOption> = {
    COURIER: "courier",
    PICKUP: "pickup",
    BOTH: "both",
  };
  return map[dbVal] ?? "pickup";
}

// ─────────────────────────────────────────────────────────────────────────────
export default function EditListingPage() {
  const params = useParams();
  const router = useRouter();
  const listingId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [saved, setSaved] = useState(false);

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [condition, setCondition] = useState<Condition | "">("");
  const [price, setPrice] = useState("");
  const [offersEnabled, setOffersEnabled] = useState(true);
  const [gstIncluded, setGstIncluded] = useState(false);
  const [isUrgent, setIsUrgent] = useState(false);
  const [isNegotiable, setIsNegotiable] = useState(false);
  const [shipsNationwide, setShipsNationwide] = useState(false);
  const [shippingOption, setShippingOption] = useState<ShippingOption | "">("");
  const [shippingPrice, setShippingPrice] = useState("");
  const [region, setRegion] = useState<NZRegion | "">("");
  const [suburb, setSuburb] = useState("");
  const [existingImages, setExistingImages] = useState<
    { id: string; r2Key: string; thumbnailKey: string | null; url: string }[]
  >([]);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [listingStatus, setListingStatus] = useState("");

  const activeCat = CATEGORIES.find((c) => c.id === categoryId);

  // Load existing listing data
  useEffect(() => {
    if (!listingId) return;
    let cancelled = false;

    async function load() {
      const result = await getListingForEdit(listingId);
      if (cancelled) return;
      if (!result.success) {
        setLoadError(result.error);
        setLoading(false);
        return;
      }
      const d = result.data;
      setTitle(d.title);
      setDescription(d.description);
      setCategoryId(d.categoryId);
      setSubcategory(d.subcategoryName ?? "");
      setCondition(dbConditionToForm(d.condition));
      setPrice((d.priceNzd / 100).toFixed(2));
      setOffersEnabled(d.offersEnabled);
      setGstIncluded(d.gstIncluded);
      setIsUrgent(d.isUrgent);
      setIsNegotiable(d.isNegotiable);
      setShipsNationwide(d.shipsNationwide);
      setShippingOption(dbShippingToForm(d.shippingOption));
      setShippingPrice(
        d.shippingNzd != null ? (d.shippingNzd / 100).toFixed(2) : "",
      );
      setRegion(d.region as NZRegion);
      setSuburb(d.suburb);
      setListingStatus(d.status);
      setExistingImages(
        d.images.map((img) => ({
          ...img,
          url: getImageUrl(img.thumbnailKey ?? img.r2Key),
        })),
      );
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [listingId]);

  // Validate
  const validate = useCallback((): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (title.trim().length < 5)
      errs.title = "Title must be at least 5 characters.";
    if (title.trim().length > 100)
      errs.title = "Title must be 100 characters or less.";
    if (description.trim().length < 20)
      errs.description = "Description must be at least 20 characters.";
    if (!categoryId) errs.category = "Select a category.";
    if (!condition) errs.condition = "Select a condition.";
    const p = parseFloat(price);
    if (!price || isNaN(p) || p <= 0) errs.price = "Enter a valid price.";
    if (p > 100_000) errs.price = "Maximum price is $100,000.";
    if (!shippingOption) errs.shippingOption = "Select a shipping option.";
    if (!region) errs.region = "Select your region.";
    if (!suburb.trim()) errs.suburb = "Enter your suburb or town.";
    return errs;
  }, [
    title,
    description,
    categoryId,
    condition,
    price,
    shippingOption,
    region,
    suburb,
  ]);

  async function handleSubmit() {
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setSubmitting(true);
    setSubmitError("");

    const result = await updateListing({
      listingId,
      title: title.trim(),
      description: description.trim(),
      categoryId,
      subcategoryName: subcategory || undefined,
      condition: condition.toUpperCase().replace(/-/g, "_"),
      price,
      offersEnabled,
      gstIncluded,
      isUrgent,
      isNegotiable,
      shipsNationwide,
      shippingOption: shippingOption.toUpperCase(),
      shippingPrice: shippingPrice || undefined,
      region,
      suburb: suburb.trim(),
    });

    setSubmitting(false);

    if (!result.success) {
      setSubmitError(
        result.error ?? "Failed to update listing. Please try again.",
      );
      return;
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <>
        <NavBar />
        <main className="bg-[#FAFAF8] min-h-screen flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-[#D4A843] border-t-transparent rounded-full animate-spin" />
        </main>
        <Footer />
      </>
    );
  }

  // ── Load error state ──────────────────────────────────────────────────────
  if (loadError) {
    return (
      <>
        <NavBar />
        <main className="bg-[#FAFAF8] min-h-screen flex items-center justify-center px-4">
          <div className="max-w-md w-full text-center">
            <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#ef4444"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="m15 9-6 6M9 9l6 6" />
              </svg>
            </div>
            <h1 className="text-[1.25rem] font-semibold text-[#141414] mb-2">
              {loadError}
            </h1>
            <Link href="/dashboard/seller?tab=listings">
              <Button variant="primary" size="md">
                Back to my listings
              </Button>
            </Link>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen pb-20">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-8">
          {/* Header */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold text-[#141414] mb-1">
                Edit listing
              </h1>
              <p className="text-[13.5px] text-[#73706A]">
                Update your listing details. Changes are saved immediately.
              </p>
            </div>
            {listingStatus === "DRAFT" && (
              <span className="text-[11px] font-bold text-orange-600 bg-orange-50 border border-orange-200 px-2.5 py-1 rounded-full uppercase tracking-wide">
                Draft
              </span>
            )}
          </div>

          {/* Image management */}
          <div className="bg-white rounded-2xl border border-[#E3E0D9] p-4 mb-6">
            <p className="text-[12.5px] font-semibold text-[#9E9A91] uppercase tracking-wide mb-3">
              Photos ({existingImages.length}/10)
            </p>

            {imageError && (
              <Alert variant="error" className="mb-3">
                {imageError}
              </Alert>
            )}

            {/* Image grid with controls */}
            <div className="flex gap-2 flex-wrap">
              {existingImages.map((img, i) => (
                <div
                  key={img.id}
                  className="relative w-20 h-20 shrink-0 rounded-xl overflow-hidden border-2 border-[#E3E0D9] group"
                >
                  <img
                    src={img.url}
                    alt={`Photo ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                  {i === 0 && (
                    <div className="absolute bottom-0.5 left-0.5 bg-[#D4A843] text-[#141414] text-[8px] font-bold px-1 py-0.5 rounded-full">
                      COVER
                    </div>
                  )}

                  {/* Overlay controls */}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                    {/* Move left */}
                    {i > 0 && (
                      <button
                        type="button"
                        onClick={async () => {
                          const newOrder = [...existingImages];
                          const temp = newOrder[i]!;
                          newOrder[i] = newOrder[i - 1]!;
                          newOrder[i - 1] = temp;
                          setExistingImages(newOrder);
                          await reorderListingImages({
                            listingId,
                            imageIds: newOrder.map((im) => im.id),
                          });
                        }}
                        className="w-6 h-6 bg-white/90 rounded-full flex items-center justify-center text-[10px] text-[#141414] hover:bg-white"
                        title="Move left"
                      >
                        ←
                      </button>
                    )}
                    {/* Move right */}
                    {i < existingImages.length - 1 && (
                      <button
                        type="button"
                        onClick={async () => {
                          const newOrder = [...existingImages];
                          const temp = newOrder[i]!;
                          newOrder[i] = newOrder[i + 1]!;
                          newOrder[i + 1] = temp;
                          setExistingImages(newOrder);
                          await reorderListingImages({
                            listingId,
                            imageIds: newOrder.map((im) => im.id),
                          });
                        }}
                        className="w-6 h-6 bg-white/90 rounded-full flex items-center justify-center text-[10px] text-[#141414] hover:bg-white"
                        title="Move right"
                      >
                        →
                      </button>
                    )}
                    {/* Delete */}
                    <button
                      type="button"
                      onClick={async () => {
                        if (
                          existingImages.length <= 1 ||
                          !confirm("Remove this photo?")
                        )
                          return;
                        const result = await deleteListingImage({
                          imageId: img.id,
                          listingId,
                        });
                        if (result.success) {
                          setExistingImages((prev) =>
                            prev.filter((im) => im.id !== img.id),
                          );
                        } else {
                          setImageError(
                            result.error ?? "Failed to remove image.",
                          );
                        }
                      }}
                      className="w-6 h-6 bg-red-500/90 rounded-full flex items-center justify-center text-[10px] text-white hover:bg-red-600"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}

              {/* Add new image */}
              {existingImages.length < 10 && (
                <label
                  className={`w-20 h-20 shrink-0 rounded-xl border-2 border-dashed border-[#D4A843]/40
                    flex flex-col items-center justify-center cursor-pointer hover:bg-[#F5ECD4]/30 transition-colors
                    ${imageUploading ? "opacity-50 pointer-events-none" : ""}`}
                >
                  <span className="text-[#D4A843] text-lg">+</span>
                  <span className="text-[9px] text-[#9E9A91]">
                    {imageUploading ? "Uploading…" : "Add"}
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setImageError("");
                      setImageUploading(true);

                      try {
                        // Phase 1: Get presigned URL
                        const uploadResult = await requestImageUpload({
                          fileName: file.name,
                          contentType: file.type,
                          sizeBytes: file.size,
                          listingId,
                        });
                        if (!uploadResult.success) {
                          setImageError(uploadResult.error ?? "Upload failed.");
                          setImageUploading(false);
                          return;
                        }

                        // Phase 2: Upload to R2
                        const xhr = new XMLHttpRequest();
                        await new Promise<void>((resolve, reject) => {
                          xhr.open("PUT", uploadResult.data.uploadUrl);
                          xhr.setRequestHeader("Content-Type", file.type);
                          xhr.onload = () =>
                            xhr.status >= 200 && xhr.status < 300
                              ? resolve()
                              : reject(new Error("Upload failed"));
                          xhr.onerror = () =>
                            reject(new Error("Upload failed"));
                          xhr.send(file);
                        });

                        // Phase 3: Confirm and process
                        const confirmResult = await confirmImageUpload({
                          imageId: uploadResult.data.imageId,
                          r2Key: uploadResult.data.r2Key,
                        });
                        if (!confirmResult.success) {
                          setImageError(
                            confirmResult.error ?? "Processing failed.",
                          );
                          setImageUploading(false);
                          return;
                        }

                        // Add to existing images
                        const processedData = confirmResult.data;
                        setExistingImages((prev) => [
                          ...prev,
                          {
                            id: uploadResult.data.imageId,
                            r2Key:
                              processedData.r2Key ?? uploadResult.data.r2Key,
                            thumbnailKey: processedData.thumbnailKey ?? null,
                            url: getImageUrl(
                              processedData.thumbnailKey ??
                                processedData.r2Key ??
                                uploadResult.data.r2Key,
                            ),
                          },
                        ]);
                      } catch {
                        setImageError("Image upload failed. Please try again.");
                      }

                      setImageUploading(false);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>

            <p className="text-[11px] text-[#9E9A91] mt-2">
              Hover over a photo to reorder or remove. The first photo is the
              cover image.
            </p>
          </div>

          {submitError && (
            <Alert variant="error" className="mb-4">
              {submitError}
            </Alert>
          )}

          {/* Form */}
          <div className="bg-white rounded-2xl border border-[#E3E0D9] shadow-sm overflow-hidden">
            <div className="p-6 space-y-5">
              {/* Title */}
              <Input
                label="Title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setErrors((p) => ({ ...p, title: "" }));
                }}
                placeholder="e.g. Sony WH-1000XM5 Noise-Cancelling Headphones"
                maxLength={100}
                required
                error={errors.title}
                hint={`${title.length}/100`}
              />

              {/* Description */}
              <Textarea
                label="Description"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setErrors((p) => ({ ...p, description: "" }));
                }}
                placeholder="Describe the item's condition, what's included, any issues..."
                required
                error={errors.description}
                charCount={{ current: description.length, max: 3000 }}
                className="min-h-[140px]"
              />

              {/* Category / Subcategory */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Select
                  label="Category"
                  value={categoryId}
                  onChange={(e) => {
                    setCategoryId(e.target.value);
                    setSubcategory("");
                    setErrors((p) => ({ ...p, category: "" }));
                  }}
                  placeholder="Select category"
                  required
                  error={errors.category}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.icon} {c.name}
                    </option>
                  ))}
                </Select>
                {activeCat && (
                  <Select
                    label="Subcategory"
                    value={subcategory}
                    onChange={(e) => setSubcategory(e.target.value)}
                    placeholder="Select subcategory"
                  >
                    {activeCat.subcategories.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                )}
              </div>

              {/* Condition */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[12.5px] font-semibold text-[#141414]">
                  Condition <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {CONDITIONS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => {
                        setCondition(c.value);
                        setErrors((p) => ({ ...p, condition: "" }));
                      }}
                      className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 text-center transition-all duration-150
                        ${
                          condition === c.value
                            ? "border-[#141414] bg-[#141414] text-white"
                            : "border-[#E3E0D9] hover:border-[#C9C5BC] text-[#73706A]"
                        }`}
                    >
                      <span className="text-[11.5px] font-semibold">
                        {c.label}
                      </span>
                    </button>
                  ))}
                </div>
                {errors.condition && (
                  <p className="text-[11.5px] text-red-500 font-medium">
                    {errors.condition}
                  </p>
                )}
              </div>

              {/* Price */}
              <Input
                label="Asking price (NZD)"
                type="number"
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value);
                  setErrors((p) => ({ ...p, price: "" }));
                }}
                placeholder="0.00"
                min={0.01}
                max={100000}
                step={0.01}
                required
                error={errors.price}
                leftAddon={<span className="text-[13px] font-medium">$</span>}
              />

              {/* Toggles */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  {
                    label: "Accept offers",
                    checked: offersEnabled,
                    set: setOffersEnabled,
                  },
                  {
                    label: "GST included",
                    checked: gstIncluded,
                    set: setGstIncluded,
                  },
                  { label: "Urgent sale", checked: isUrgent, set: setIsUrgent },
                  {
                    label: "Price negotiable",
                    checked: isNegotiable,
                    set: setIsNegotiable,
                  },
                  {
                    label: "Ships NZ-wide",
                    checked: shipsNationwide,
                    set: setShipsNationwide,
                  },
                ].map((t) => (
                  <label
                    key={t.label}
                    className="flex items-center gap-2.5 cursor-pointer select-none p-3 rounded-xl border border-[#E3E0D9] hover:border-[#D4A843] transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={t.checked}
                      onChange={(e) => t.set(e.target.checked)}
                      className="w-4 h-4 accent-[#D4A843] cursor-pointer"
                    />
                    <span className="text-[12.5px] font-medium text-[#141414]">
                      {t.label}
                    </span>
                  </label>
                ))}
              </div>

              {/* Shipping */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {SHIPPING_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => {
                      setShippingOption(o.value);
                      setErrors((p) => ({ ...p, shippingOption: "" }));
                    }}
                    className={`flex flex-col gap-1 p-4 rounded-xl border-2 text-left transition-all duration-150
                      ${
                        shippingOption === o.value
                          ? "border-[#141414] bg-[#141414] text-white"
                          : "border-[#E3E0D9] hover:border-[#C9C5BC] text-[#141414]"
                      }`}
                  >
                    <span className="text-[13px] font-semibold">{o.label}</span>
                  </button>
                ))}
              </div>
              {errors.shippingOption && (
                <p className="text-[11.5px] text-red-500 font-medium">
                  {errors.shippingOption}
                </p>
              )}

              {(shippingOption === "courier" || shippingOption === "both") && (
                <Input
                  label="Courier price (NZD)"
                  type="number"
                  value={shippingPrice}
                  onChange={(e) => setShippingPrice(e.target.value)}
                  placeholder="0 for free shipping"
                  min={0}
                  leftAddon={<span className="text-[13px] font-medium">$</span>}
                />
              )}

              {/* Location */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Select
                  label="Region"
                  value={region}
                  onChange={(e) => {
                    setRegion(e.target.value as NZRegion);
                    setErrors((p) => ({ ...p, region: "" }));
                  }}
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
                  onChange={(e) => {
                    setSuburb(e.target.value);
                    setErrors((p) => ({ ...p, suburb: "" }));
                  }}
                  placeholder="e.g. Ponsonby"
                  required
                  error={errors.suburb}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-[#F8F7F4] border-t border-[#E3E0D9] flex items-center justify-between gap-3">
              <Link href="/dashboard/seller?tab=listings">
                <Button variant="ghost" size="md">
                  Cancel
                </Button>
              </Link>
              <div className="flex items-center gap-2">
                <Link href={`/listings/${listingId}`}>
                  <Button variant="ghost" size="md">
                    View listing
                  </Button>
                </Link>
                <Button
                  variant="gold"
                  size="md"
                  loading={submitting}
                  onClick={handleSubmit}
                >
                  Save changes
                </Button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Saved toast */}
      {saved && (
        <div
          className="fixed bottom-6 right-6 z-50 bg-emerald-600 text-white px-5 py-3 rounded-xl shadow-lg
          flex items-center gap-2 text-[13px] font-medium"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Changes saved
        </div>
      )}

      <Footer />
    </>
  );
}
