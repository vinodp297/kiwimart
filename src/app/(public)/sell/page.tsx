"use client";
// src/app/(public)/sell/page.tsx  (Sprint 4 — real R2 uploads)
// ─── Create Listing — 4-Step Wizard ──────────────────────────────────────────
// Step 1: Photos   Step 2: Details   Step 3: Pricing   Step 4: Shipping
//
// Sprint 4:
//  - Images → requestImageUpload() → presigned R2 URL → direct upload → confirmImageUpload()
//  - Shows real upload progress bar
//  - Submission → createListing() server action (auth-guarded, Zod validated)
//  - User must be authenticated (proxy redirects to /login?from=/sell)

import { useState, useRef, useCallback, useEffect } from "react";
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
import {
  requestImageUpload,
  confirmImageUpload,
} from "@/server/actions/images";
import { createListing, saveDraft } from "@/server/actions/listings";
import ListingPreviewModal from "./ListingPreviewModal";
import type { Condition, ShippingOption, NZRegion } from "@/types";

// ── Constants ─────────────────────────────────────────────────────────────────
const CONDITIONS: { value: Condition; label: string; hint: string }[] = [
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

const NZ_REGIONS: NZRegion[] = [
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

const STEPS = [
  { number: 1, label: "Photos" },
  { number: 2, label: "Details" },
  { number: 3, label: "Pricing" },
  { number: 4, label: "Shipping" },
];

// ── Image preview type ────────────────────────────────────────────────────────
interface ImagePreview {
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
  safe: boolean; // true only after server confirms scanned + safe
  compressedSize: number | null;
  originalSize: number | null;
  dimensions: { width: number; height: number } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function SellPage() {
  // ── Seller status check ──────────────────────────────────────────────────
  const [sellerStatus, setSellerStatus] = useState<{
    loading: boolean;
    stripeOnboarded: boolean;
    authenticated: boolean;
  }>({ loading: true, stripeOnboarded: false, authenticated: false });

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    fetch("/api/seller/status", { signal: controller.signal })
      .then((r) => r.json())
      .then((res) => {
        clearTimeout(timeoutId);
        const payload = res.data ?? res;
        setSellerStatus({
          loading: false,
          stripeOnboarded: payload.stripeOnboarded,
          authenticated: payload.authenticated,
        });
      })
      .catch(() => {
        clearTimeout(timeoutId);
        setSellerStatus({
          loading: false,
          stripeOnboarded: false,
          authenticated: false,
        });
      });

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, []);

  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Step 1 — Photos
  const [images, setImages] = useState<ImagePreview[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 2 — Details
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [condition, setCondition] = useState<Condition | "">("");

  // Step 3 — Pricing
  const [price, setPrice] = useState("");
  const [offersEnabled, setOffersEnabled] = useState(true);
  const [gstIncluded, setGstIncluded] = useState(false);
  const [isUrgent, setIsUrgent] = useState(false);
  const [isNegotiable, setIsNegotiable] = useState(false);
  const [shipsNationwide, setShipsNationwide] = useState(false);

  // Step 4 — Shipping
  const [shippingOption, setShippingOption] = useState<ShippingOption | "">("");
  const [shippingPrice, setShippingPrice] = useState("");
  const [region, setRegion] = useState<NZRegion | "">("");
  const [suburb, setSuburb] = useState("");

  // Preview modal
  const [showPreview, setShowPreview] = useState(false);

  // Save as draft
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);

  // Validation errors per step
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ── Active category ──────────────────────────────────────────────────────
  const activeCat = CATEGORIES.find((c) => c.id === categoryId);

  // ── Upload a single file to R2 via presigned URL ───────────────────────
  async function uploadFileToR2(img: ImagePreview): Promise<void> {
    setImages((prev) =>
      prev.map((i) =>
        i.id === img.id
          ? {
              ...i,
              uploading: true,
              processing: false,
              progress: 0,
              error: null,
            }
          : i,
      ),
    );

    try {
      // Phase 1: Get presigned URL
      const result = await requestImageUpload({
        fileName: img.file.name,
        contentType: img.file.type || "image/jpeg",
        sizeBytes: img.file.size,
      });

      if (!result.success) {
        console.error("[Upload] Phase 1 failed (presigned URL):", result.error);
        setImages((prev) =>
          prev.map((i) =>
            i.id === img.id
              ? {
                  ...i,
                  uploading: false,
                  error: result.error ?? "Upload failed",
                }
              : i,
          ),
        );
        return;
      }

      const { uploadUrl, r2Key, imageId } = result.data;

      // Phase 2: Upload directly to R2
      const xhr = new XMLHttpRequest();
      await new Promise<void>((resolve, reject) => {
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setImages((prev) =>
              prev.map((i) => (i.id === img.id ? { ...i, progress: pct } : i)),
            );
          }
        });

        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            console.error(
              `[Upload] R2 PUT failed: status=${xhr.status}`,
              xhr.responseText?.slice(0, 500),
            );
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });

        xhr.addEventListener("error", () => {
          console.error("[Upload] Network error — likely CORS or connectivity");
          reject(new Error("Network error during upload"));
        });
        xhr.addEventListener("abort", () =>
          reject(new Error("Upload cancelled")),
        );

        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", img.file.type || "image/jpeg");
        xhr.send(img.file);
      });

      // Phase 3: Confirm upload — triggers processing (compress, WebP, EXIF strip, thumbnail)
      setImages((prev) =>
        prev.map((i) =>
          i.id === img.id
            ? { ...i, uploading: false, processing: true, progress: 100 }
            : i,
        ),
      );

      const confirmResult = await confirmImageUpload({ imageId, r2Key });

      if (!confirmResult.success) {
        console.error(
          "[Upload] Phase 3 failed (processing):",
          confirmResult.error,
        );
        setImages((prev) =>
          prev.map((i) =>
            i.id === img.id
              ? {
                  ...i,
                  processing: false,
                  error: confirmResult.error ?? "Processing failed",
                }
              : i,
          ),
        );
        return;
      }

      const processed = confirmResult.data;
      setImages((prev) =>
        prev.map((i) =>
          i.id === img.id
            ? {
                ...i,
                uploading: false,
                processing: false,
                progress: 100,
                uploaded: true,
                safe: processed.safe ?? true,
                r2Key,
                imageId,
                originalSize: processed.originalSize ?? img.file.size,
                compressedSize: processed.compressedSize ?? null,
                dimensions:
                  processed.width && processed.height
                    ? { width: processed.width, height: processed.height }
                    : null,
              }
            : i,
        ),
      );
    } catch (err) {
      console.error("[Upload] Uncaught error:", err);
      setImages((prev) =>
        prev.map((i) =>
          i.id === img.id
            ? {
                ...i,
                uploading: false,
                processing: false,
                error: err instanceof Error ? err.message : "Upload failed",
              }
            : i,
        ),
      );
    }
  }

  // ── Image handlers ───────────────────────────────────────────────────────
  const addFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      const allFiles = Array.from(files);
      const nonImages = allFiles.filter((f) => !f.type.startsWith("image/"));
      if (nonImages.length > 0) {
        setErrors((prev) => ({
          ...prev,
          images: `${nonImages.length} file${nonImages.length > 1 ? "s were" : " was"} skipped — only JPG, PNG, and WebP photos are allowed.`,
        }));
      }
      const remaining = 10 - images.length;
      const imageFiles = allFiles.filter((f) => f.type.startsWith("image/"));
      if (imageFiles.length > remaining) {
        setErrors((prev) => ({
          ...prev,
          images: `Only ${remaining} more photo${remaining !== 1 ? "s" : ""} can be added (max 10). ${imageFiles.length - remaining} skipped.`,
        }));
      }
      const allowed = imageFiles.slice(0, remaining);

      const previews: ImagePreview[] = allowed.map((f) => ({
        id: `${f.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        url: URL.createObjectURL(f),
        file: f,
        r2Key: null,
        imageId: null,
        uploading: false,
        processing: false,
        progress: 0,
        error: null,
        uploaded: false,
        safe: false,
        compressedSize: null,
        originalSize: null,
        dimensions: null,
      }));

      setImages((prev) => {
        const combined = [...prev, ...previews].slice(0, 10);
        return combined;
      });

      // Start uploading each new file
      previews.forEach((img) => {
        uploadFileToR2(img);
      });
    },
    [images.length],
  );

  function removeImage(id: string) {
    setImages((prev) => prev.filter((i) => i.id !== id));
  }

  function retryUpload(id: string) {
    const img = images.find((i) => i.id === id);
    if (img) uploadFileToR2(img);
  }

  function reorderImage(from: number, to: number) {
    setImages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      if (moved) next.splice(to, 0, moved);
      return next;
    });
  }

  // ── Step validation ──────────────────────────────────────────────────────
  function validateStep(n: number): Record<string, string> {
    const errs: Record<string, string> = {};
    if (n === 1) {
      if (images.length === 0) errs.images = "Add at least one photo.";
      const uploading = images.some((i) => i.uploading);
      if (uploading) errs.images = "Please wait for uploads to finish.";
      const processing = images.some((i) => i.processing);
      if (processing)
        errs.images = "Please wait — your photos are being verified.";
      const failed = images.filter((i) => i.error);
      if (failed.length > 0)
        errs.images = `${failed.length} photo${failed.length > 1 ? "s" : ""} failed. Remove or retry them before continuing.`;
      // Check that all uploaded images passed safety/processing
      const unsafe = images.filter((i) => i.uploaded && !i.safe && !i.error);
      if (unsafe.length > 0)
        errs.images =
          "Some photos haven't been verified yet. Please wait or re-upload them.";
      // Check no uploaded images are explicitly marked unsafe
      const flagged = images.filter((i) => i.uploaded && !i.safe && i.error);
      if (flagged.length > 0)
        errs.images = "Please remove flagged photos before continuing.";
    }
    if (n === 2) {
      if (title.trim().length < 5)
        errs.title = "Title must be at least 5 characters.";
      if (title.trim().length > 100)
        errs.title = "Title must be 100 characters or less.";
      if (description.trim().length < 20)
        errs.description = "Description must be at least 20 characters.";
      if (!categoryId) errs.category = "Select a category.";
      if (!condition) errs.condition = "Select a condition.";
    }
    if (n === 3) {
      const p = parseFloat(price);
      if (!price || isNaN(p) || p <= 0) errs.price = "Enter a valid price.";
      if (p > 100_000) errs.price = "Maximum price is $100,000.";
    }
    if (n === 4) {
      if (!shippingOption) errs.shippingOption = "Select a shipping option.";
      if (shippingOption === "courier" || shippingOption === "both") {
        const sp = parseFloat(shippingPrice);
        if (shippingPrice && (isNaN(sp) || sp < 0))
          errs.shippingPrice = "Enter a valid shipping price.";
      }
      if (!region) errs.region = "Select your region.";
      if (!suburb.trim()) errs.suburb = "Enter your suburb or town.";
    }
    return errs;
  }

  function goNext() {
    const errs = validateStep(step);
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setStep((s) => s + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goBack() {
    setErrors({});
    setStep((s) => s - 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit() {
    const errs = validateStep(4);
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setSubmitting(true);
    setSubmitError("");

    // Collect uploaded R2 keys
    const imageKeys = images
      .filter((i) => i.uploaded && i.r2Key)
      .map((i) => i.r2Key!);

    if (imageKeys.length === 0) {
      setSubmitError("No images uploaded successfully. Please add photos.");
      setSubmitting(false);
      return;
    }

    const result = await createListing({
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
      imageKeys,
      attributes: [],
    });

    setSubmitting(false);

    if (!result.success) {
      // If we got field-level errors from Zod, show them per-field and
      // navigate to the first step that has an error.
      const fe = result.fieldErrors;
      if (fe && Object.keys(fe).length > 0) {
        const fieldToStep: Record<string, number> = {
          imageKeys: 1,
          title: 2,
          description: 2,
          categoryId: 2,
          subcategoryName: 2,
          condition: 2,
          price: 3,
          offersEnabled: 3,
          gstIncluded: 3,
          isUrgent: 3,
          isNegotiable: 3,
          shipsNationwide: 3,
          shippingOption: 4,
          shippingPrice: 4,
          region: 4,
          suburb: 4,
          pickupAddress: 4,
        };
        const fieldErrors: Record<string, string> = {};
        let firstErrorStep = 4;
        for (const [field, msgs] of Object.entries(fe)) {
          const msg = (msgs as string[])?.[0];
          if (msg) {
            // Map Zod field names to our local error keys
            const key =
              field === "imageKeys"
                ? "images"
                : field === "categoryId"
                  ? "category"
                  : field === "shippingOption"
                    ? "shippingOption"
                    : field;
            fieldErrors[key] = msg;
            const s = fieldToStep[field] ?? 4;
            if (s < firstErrorStep) firstErrorStep = s;
          }
        }
        setErrors(fieldErrors);
        if (firstErrorStep < step) {
          setStep(firstErrorStep);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      }
      setSubmitError(
        result.error ?? "Failed to create listing. Please try again.",
      );
      return;
    }

    setSubmitted(true);
    // Clear localStorage after successful publish
    try {
      localStorage.removeItem("kiwi-sell-draft");
    } catch {
      /* localStorage unavailable */
    }
  }

  // ── Save as Draft handler ────────────────────────────────────────────────
  async function handleSaveDraft() {
    setSavingDraft(true);
    setSubmitError("");

    const imageKeys = images
      .filter((i) => i.uploaded && i.r2Key)
      .map((i) => i.r2Key!);

    const result = await saveDraft({
      draftId: draftId ?? undefined,
      title: title.trim() || undefined,
      description: description.trim() || undefined,
      categoryId: categoryId || undefined,
      subcategoryName: subcategory || undefined,
      condition: condition ? condition.toUpperCase() : undefined,
      price: price || undefined,
      offersEnabled,
      gstIncluded,
      isUrgent,
      isNegotiable,
      shipsNationwide,
      shippingOption: shippingOption ? shippingOption.toUpperCase() : undefined,
      shippingPrice: shippingPrice || undefined,
      region: region || undefined,
      suburb: suburb.trim() || undefined,
      imageKeys: imageKeys.length > 0 ? imageKeys : undefined,
    });

    setSavingDraft(false);

    if (!result.success) {
      setSubmitError(result.error ?? "Failed to save draft. Please try again.");
      return;
    }

    setDraftId(result.data.draftId);
    setDraftSaved(true);
    // Clear localStorage after saving to server
    try {
      localStorage.removeItem("kiwi-sell-draft");
    } catch {
      /* localStorage unavailable */
    }
    // Reset toast after 3s
    setTimeout(() => setDraftSaved(false), 3000);
  }

  // ── localStorage auto-save (debounced) ───────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const draft = {
          step,
          title,
          description,
          categoryId,
          subcategory,
          condition,
          price,
          offersEnabled,
          gstIncluded,
          isUrgent,
          isNegotiable,
          shipsNationwide,
          shippingOption,
          shippingPrice,
          region,
          suburb,
          draftId,
          savedAt: Date.now(),
        };
        localStorage.setItem("kiwi-sell-draft", JSON.stringify(draft));
      } catch {
        // localStorage unavailable
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [
    step,
    title,
    description,
    categoryId,
    subcategory,
    condition,
    price,
    offersEnabled,
    gstIncluded,
    isUrgent,
    isNegotiable,
    shipsNationwide,
    shippingOption,
    shippingPrice,
    region,
    suburb,
    draftId,
  ]);

  // ── Restore from localStorage on mount ───────────────────────────────────
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const resumeDataRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("kiwi-sell-draft");
      if (!saved) return;
      const data = JSON.parse(saved);
      // Only show prompt if draft is less than 24h old and has meaningful data
      const age = Date.now() - (data.savedAt ?? 0);
      if (age > 24 * 60 * 60 * 1000) {
        localStorage.removeItem("kiwi-sell-draft");
        return;
      }
      if (data.title || data.description || data.price) {
        resumeDataRef.current = data;
        setShowResumePrompt(true);
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  function resumeDraft() {
    const d = resumeDataRef.current;
    if (!d) return;
    if (typeof d.step === "number") setStep(d.step);
    if (typeof d.title === "string") setTitle(d.title);
    if (typeof d.description === "string") setDescription(d.description);
    if (typeof d.categoryId === "string") setCategoryId(d.categoryId);
    if (typeof d.subcategory === "string") setSubcategory(d.subcategory);
    if (typeof d.condition === "string") setCondition(d.condition as Condition);
    if (typeof d.price === "string") setPrice(d.price);
    if (typeof d.offersEnabled === "boolean") setOffersEnabled(d.offersEnabled);
    if (typeof d.gstIncluded === "boolean") setGstIncluded(d.gstIncluded);
    if (typeof d.isUrgent === "boolean") setIsUrgent(d.isUrgent);
    if (typeof d.isNegotiable === "boolean") setIsNegotiable(d.isNegotiable);
    if (typeof d.shipsNationwide === "boolean")
      setShipsNationwide(d.shipsNationwide);
    if (typeof d.shippingOption === "string")
      setShippingOption(d.shippingOption as ShippingOption);
    if (typeof d.shippingPrice === "string") setShippingPrice(d.shippingPrice);
    if (typeof d.region === "string") setRegion(d.region as NZRegion);
    if (typeof d.suburb === "string") setSuburb(d.suburb);
    if (typeof d.draftId === "string") setDraftId(d.draftId);
    setShowResumePrompt(false);
  }

  function discardDraft() {
    try {
      localStorage.removeItem("kiwi-sell-draft");
    } catch {
      /* localStorage unavailable */
    }
    resumeDataRef.current = null;
    setShowResumePrompt(false);
  }

  // ── Submitted success state ───────────────────────────────────────────────
  if (submitted) {
    return (
      <>
        <NavBar />
        <main className="bg-[#FAFAF8] min-h-screen flex items-center justify-center px-4 py-20">
          <div className="max-w-md w-full text-center">
            <div
              className="w-20 h-20 rounded-full bg-emerald-50 flex items-center
              justify-center mx-auto mb-6"
            >
              <svg
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#16a34a"
                strokeWidth="2"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h1
              className="font-[family-name:var(--font-playfair)] text-[1.75rem]
              font-semibold text-[#141414] mb-3"
            >
              Your listing is live! 🥝
            </h1>
            <p className="text-[14px] text-[#73706A] mb-8 leading-relaxed">
              <strong className="text-[#141414]">{title}</strong> is now visible
              to NZ buyers. You&apos;ll be notified when someone watches or
              makes an offer.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/dashboard/seller">
                <Button variant="primary" size="md">
                  Manage my listings
                </Button>
              </Link>
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  setSubmitted(false);
                  setStep(1);
                  setImages([]);
                  setTitle("");
                  setDescription("");
                  setCategoryId("");
                  setSubcategory("");
                  setCondition("");
                  setPrice("");
                  setOffersEnabled(true);
                  setGstIncluded(false);
                  setIsUrgent(false);
                  setIsNegotiable(false);
                  setShipsNationwide(false);
                  setShippingOption("");
                  setShippingPrice("");
                  setRegion("");
                  setSuburb("");
                  setDraftId(null);
                  try {
                    localStorage.removeItem("kiwi-sell-draft");
                  } catch {
                    /* localStorage unavailable */
                  }
                }}
              >
                List another item
              </Button>
            </div>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  // ── Seller status loading state ────────────────────────────────────────────
  if (sellerStatus.loading) {
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

  // ── Stripe not configured gate ─────────────────────────────────────────────
  if (sellerStatus.authenticated && !sellerStatus.stripeOnboarded) {
    return (
      <>
        <NavBar />
        <main className="bg-[#FAFAF8] min-h-screen flex items-center justify-center px-4 py-12">
          <div className="max-w-md w-full">
            <div className="bg-white rounded-2xl border border-[#E3E0D9] shadow-sm p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-[#F5ECD4] flex items-center justify-center mx-auto mb-6">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#D4A843"
                  strokeWidth="2"
                >
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              </div>
              <h1 className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold text-[#141414] mb-3">
                Set up payments first
              </h1>
              <p className="text-[14px] text-[#73706A] leading-relaxed mb-6">
                Before listing items you need to connect your bank account so
                buyers can pay you. It only takes 2 minutes and is completely
                free.
              </p>
              <div className="text-left space-y-3 mb-8">
                {[
                  "Get paid directly to your NZ bank account",
                  "Funds held safely in escrow until delivery",
                  "Automatic payout within 3 business days",
                  "Bank-grade security powered by Stripe",
                ].map((benefit) => (
                  <div key={benefit} className="flex items-start gap-2.5">
                    <span className="text-[#D4A843] shrink-0 mt-0.5 font-bold">
                      ✓
                    </span>
                    <span className="text-[13.5px] text-[#73706A]">
                      {benefit}
                    </span>
                  </div>
                ))}
              </div>
              <a
                href="/account/stripe"
                className="block w-full py-3.5 px-6 bg-[#D4A843] hover:bg-[#B8912E]
                  text-[#141414] font-semibold text-[15px] rounded-full
                  transition-colors text-center"
              >
                Set up payments →
              </a>
              <p className="mt-4 text-[11.5px] text-[#C9C5BC]">
                Secured by Stripe · No monthly fees · Cancel anytime
              </p>
            </div>
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
          <div className="mb-6">
            <h1
              className="font-[family-name:var(--font-playfair)] text-[1.75rem]
              font-semibold text-[#141414] mb-1"
            >
              List an item
            </h1>
            <p className="text-[13.5px] text-[#73706A]">
              Reach NZ buyers — $0 listing fee.
            </p>
          </div>

          {/* Resume draft prompt */}
          {showResumePrompt && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 flex items-center justify-between gap-4">
              <div>
                <p className="text-[13px] font-semibold text-blue-900">
                  Resume your draft?
                </p>
                <p className="text-[12px] text-blue-700 mt-0.5">
                  You have an unsaved listing from a previous session.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="ghost" size="sm" onClick={discardDraft}>
                  Discard
                </Button>
                <Button variant="primary" size="sm" onClick={resumeDraft}>
                  Resume
                </Button>
              </div>
            </div>
          )}

          {/* NZ CGA seller obligation notice */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 mb-6 text-[12px] text-amber-800">
            <p className="font-semibold mb-0.5">Your obligations as a seller</p>
            <p>
              Your listing must accurately represent the item. Under the NZ
              Consumer Guarantees Act, buyers have the right to a remedy if
              items don&apos;t match their description. Misrepresentation may
              result in account suspension.
            </p>
          </div>

          {/* Step indicator */}
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

          {/* ── Step panels ─────────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-[#E3E0D9] shadow-sm overflow-hidden">
            {/* ── STEP 1: Photos ────────────────────────────────────────── */}
            {step === 1 && (
              <div className="p-6 space-y-5">
                <div>
                  <h2
                    className="font-[family-name:var(--font-playfair)] text-[1.15rem]
                    font-semibold text-[#141414] mb-1"
                  >
                    Add photos
                  </h2>
                  <p className="text-[12.5px] text-[#73706A]">
                    Up to 10 photos. First photo is your cover image. Good
                    photos get more views.
                  </p>
                </div>

                {errors.images && (
                  <Alert variant="error">{errors.images}</Alert>
                )}

                {/* Drop zone */}
                <div
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragActive(false);
                    addFiles(e.dataTransfer.files);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  aria-label="Upload photos"
                  onKeyDown={(e) =>
                    e.key === "Enter" && fileInputRef.current?.click()
                  }
                  className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer
                    transition-all duration-150 select-none
                    ${
                      dragActive
                        ? "border-[#D4A843] bg-[#F5ECD4]/50"
                        : "border-[#C9C5BC] hover:border-[#D4A843] hover:bg-[#F8F7F4]"
                    }`}
                >
                  <svg
                    aria-hidden
                    className="mx-auto mb-3 text-[#C9C5BC]"
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <p className="text-[13.5px] font-semibold text-[#141414]">
                    Click to upload or drag photos here
                  </p>
                  <p className="text-[12px] text-[#9E9A91] mt-1">
                    JPG, PNG, WebP — max 10MB each
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp,image/heic"
                    className="sr-only"
                    onChange={(e) => addFiles(e.target.files)}
                  />
                </div>

                {/* Preview grid */}
                {images.length > 0 && (
                  <div className="grid grid-cols-4 sm:grid-cols-5 gap-2.5">
                    {images.map((img, i) => (
                      <div
                        key={img.id}
                        className="relative group aspect-square rounded-xl overflow-hidden
                        border-2 border-[#E3E0D9]"
                      >
                        <img
                          src={img.url}
                          alt={`Photo ${i + 1}`}
                          className="w-full h-full object-cover"
                        />

                        {/* Upload progress overlay */}
                        {img.uploading && (
                          <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-1">
                            <div className="w-3/4 h-1.5 bg-white/30 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[#D4A843] rounded-full transition-all duration-300"
                                style={{ width: `${img.progress}%` }}
                              />
                            </div>
                            <span className="text-white text-[10px] font-medium">
                              {img.progress}%
                            </span>
                          </div>
                        )}

                        {/* Processing overlay (compression + WebP conversion) */}
                        {img.processing && (
                          <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-1">
                            <svg
                              className="animate-spin h-5 w-5 text-[#D4A843]"
                              viewBox="0 0 24 24"
                              fill="none"
                            >
                              <circle
                                className="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="4"
                              />
                              <path
                                className="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                              />
                            </svg>
                            <span className="text-white text-[10px] font-medium">
                              Verifying photo...
                            </span>
                          </div>
                        )}

                        {/* Upload success indicator — green for safe, amber for unverified */}
                        {img.uploaded &&
                          !img.uploading &&
                          !img.processing &&
                          !img.error && (
                            <>
                              <div
                                className={`absolute top-1 left-1 w-5 h-5 rounded-full flex items-center justify-center ${
                                  img.safe ? "bg-emerald-500" : "bg-amber-500"
                                }`}
                              >
                                {img.safe ? (
                                  <svg
                                    width="10"
                                    height="10"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="white"
                                    strokeWidth="3"
                                  >
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                ) : (
                                  <span className="text-white text-[9px] font-bold">
                                    !
                                  </span>
                                )}
                              </div>
                              {!img.safe && (
                                <div className="absolute bottom-1 left-1 right-1 bg-amber-600/90 text-white text-[8px] px-1.5 py-0.5 rounded text-center font-medium">
                                  Not verified
                                </div>
                              )}
                              {img.safe && img.compressedSize && (
                                <div
                                  className="absolute bottom-1 right-1 bg-black/70 text-white
                                text-[8px] px-1.5 py-0.5 rounded-full font-medium"
                                >
                                  {(img.compressedSize / 1024).toFixed(0)}KB
                                  {img.dimensions &&
                                    ` · ${img.dimensions.width}×${img.dimensions.height}`}
                                </div>
                              )}
                            </>
                          )}

                        {/* Upload error */}
                        {img.error && (
                          <div className="absolute inset-0 bg-red-500/20 flex flex-col items-center justify-center gap-1 p-1">
                            <span className="text-red-700 text-[9px] font-semibold bg-white/90 px-1.5 py-0.5 rounded text-center leading-tight max-w-full truncate">
                              {img.error}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                retryUpload(img.id);
                              }}
                              className="text-[9px] text-white bg-red-600 px-2 py-0.5 rounded-full font-medium
                                hover:bg-red-700 transition-colors"
                            >
                              Retry
                            </button>
                          </div>
                        )}

                        {i === 0 && !img.uploading && !img.error && (
                          <div
                            className="absolute bottom-1 left-1 bg-[#D4A843] text-[#141414]
                            text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                          >
                            COVER
                          </div>
                        )}

                        {/* Remove */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeImage(img.id);
                          }}
                          aria-label={`Remove photo ${i + 1}`}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60
                            text-white flex items-center justify-center opacity-0
                            group-hover:opacity-100 transition-opacity text-[10px]"
                        >
                          ×
                        </button>

                        {/* Move left */}
                        {i > 0 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              reorderImage(i, i - 1);
                            }}
                            aria-label="Move photo left"
                            className="absolute left-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full
                              bg-black/60 text-white flex items-center justify-center
                              opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <svg
                              width="9"
                              height="9"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="3"
                            >
                              <path d="m15 18-6-6 6-6" />
                            </svg>
                          </button>
                        )}
                      </div>
                    ))}

                    {/* Add more */}
                    {images.length < 10 && (
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="aspect-square rounded-xl border-2 border-dashed border-[#C9C5BC]
                          flex items-center justify-center text-[#9E9A91]
                          hover:border-[#D4A843] hover:text-[#D4A843] transition-colors"
                        aria-label="Add more photos"
                      >
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        >
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── STEP 2: Details ───────────────────────────────────────── */}
            {step === 2 && (
              <div className="p-6 space-y-5">
                <h2
                  className="font-[family-name:var(--font-playfair)] text-[1.15rem]
                  font-semibold text-[#141414]"
                >
                  Item details
                </h2>

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
                  hint={`${title.length}/100 · Be specific — include brand, model and key specs`}
                />

                <Textarea
                  label="Description"
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setErrors((p) => ({ ...p, description: "" }));
                  }}
                  placeholder="Describe the item's condition, what's included, any issues, reason for selling..."
                  required
                  error={errors.description}
                  charCount={{ current: description.length, max: 3000 }}
                  className="min-h-[140px]"
                />

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

                {/* Condition selector */}
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
                        className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2
                          text-center transition-all duration-150
                          ${
                            condition === c.value
                              ? "border-[#141414] bg-[#141414] text-white"
                              : "border-[#E3E0D9] hover:border-[#C9C5BC] text-[#73706A]"
                          }`}
                      >
                        <span className="text-[11.5px] font-semibold">
                          {c.label}
                        </span>
                        <span
                          className={`text-[10px] leading-tight ${condition === c.value ? "text-white/70" : "text-[#9E9A91]"}`}
                        >
                          {c.hint}
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
              </div>
            )}

            {/* ── STEP 3: Pricing ───────────────────────────────────────── */}
            {step === 3 && (
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
                  hint="Enter the price you want to receive. KiwiMart charges 0% listing fees."
                />

                {/* Fee breakdown */}
                {price && !isNaN(Number(price)) && Number(price) > 0 && (
                  <div className="rounded-xl border border-[#E3E0D9] divide-y divide-[#F0EDE8]">
                    {[
                      {
                        label: "Listing price",
                        value: `$${Number(price).toFixed(2)}`,
                      },
                      {
                        label: "KiwiMart listing fee",
                        value: "$0.00",
                        highlight: true,
                      },
                      {
                        label: "Payment processing (est.)",
                        value: `$${(Number(price) * 0.019 + 0.3).toFixed(2)}`,
                      },
                      {
                        label: "You receive",
                        value: `$${(Number(price) - (Number(price) * 0.019 + 0.3)).toFixed(2)}`,
                        bold: true,
                      },
                    ].map(({ label, value, highlight, bold }) => (
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
                  <label
                    className="flex items-start gap-3 cursor-pointer select-none p-3.5
                    rounded-xl border border-[#E3E0D9] hover:border-[#D4A843] transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={offersEnabled}
                      onChange={(e) => setOffersEnabled(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-[#D4A843] cursor-pointer"
                    />
                    <div>
                      <p className="text-[13px] font-semibold text-[#141414]">
                        Accept offers
                      </p>
                      <p className="text-[12px] text-[#9E9A91] mt-0.5">
                        Buyers can make lower offers. You choose to accept or
                        decline.
                      </p>
                    </div>
                  </label>

                  <label
                    className="flex items-start gap-3 cursor-pointer select-none p-3.5
                    rounded-xl border border-[#E3E0D9] hover:border-[#D4A843] transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={gstIncluded}
                      onChange={(e) => setGstIncluded(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-[#D4A843] cursor-pointer"
                    />
                    <div>
                      <p className="text-[13px] font-semibold text-[#141414]">
                        GST included in price
                      </p>
                      <p className="text-[12px] text-[#9E9A91] mt-0.5">
                        Only if you&apos;re a GST-registered NZ business (IRD
                        number required).
                      </p>
                    </div>
                  </label>

                  <label
                    className="flex items-start gap-3 cursor-pointer select-none p-3.5
                    rounded-xl border border-[#E3E0D9] hover:border-red-300 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={isUrgent}
                      onChange={(e) => setIsUrgent(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-red-500 cursor-pointer"
                    />
                    <div>
                      <p className="text-[13px] font-semibold text-[#141414]">
                        🔥 Urgent sale
                      </p>
                      <p className="text-[12px] text-[#9E9A91] mt-0.5">
                        Highlights your listing to buyers looking for quick
                        deals.
                      </p>
                    </div>
                  </label>

                  <label
                    className="flex items-start gap-3 cursor-pointer select-none p-3.5
                    rounded-xl border border-[#E3E0D9] hover:border-blue-300 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={isNegotiable}
                      onChange={(e) => setIsNegotiable(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-blue-500 cursor-pointer"
                    />
                    <div>
                      <p className="text-[13px] font-semibold text-[#141414]">
                        💬 Price is negotiable
                      </p>
                      <p className="text-[12px] text-[#9E9A91] mt-0.5">
                        Signals to buyers that you&apos;re open to a lower price
                        discussion.
                      </p>
                    </div>
                  </label>

                  <label
                    className="flex items-start gap-3 cursor-pointer select-none p-3.5
                    rounded-xl border border-[#E3E0D9] hover:border-emerald-300 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={shipsNationwide}
                      onChange={(e) => setShipsNationwide(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-emerald-500 cursor-pointer"
                    />
                    <div>
                      <p className="text-[13px] font-semibold text-[#141414]">
                        📦 Ships anywhere in NZ
                      </p>
                      <p className="text-[12px] text-[#9E9A91] mt-0.5">
                        Your listing will appear in the &quot;Ships NZ
                        wide&quot; filter.
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            )}

            {/* ── STEP 4: Shipping & Location ───────────────────────────── */}
            {step === 4 && (
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
                    How will you deliver?{" "}
                    <span className="text-red-500">*</span>
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
                        onClick={() => {
                          setShippingOption(o.value);
                          setErrors((p) => ({ ...p, shippingOption: "" }));
                        }}
                        className={`flex flex-col gap-1 p-4 rounded-xl border-2 text-left
                          transition-all duration-150
                          ${
                            shippingOption === o.value
                              ? "border-[#141414] bg-[#141414] text-white"
                              : "border-[#E3E0D9] hover:border-[#C9C5BC] text-[#141414]"
                          }`}
                      >
                        <span className="text-[13px] font-semibold">
                          {o.label}
                        </span>
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
                {(shippingOption === "courier" ||
                  shippingOption === "both") && (
                  <Input
                    label="Courier price (NZD)"
                    type="number"
                    value={shippingPrice}
                    onChange={(e) => {
                      setShippingPrice(e.target.value);
                      setErrors((p) => ({ ...p, shippingPrice: "" }));
                    }}
                    placeholder="0 for free shipping"
                    min={0}
                    error={errors.shippingPrice}
                    leftAddon={
                      <span className="text-[13px] font-medium">$</span>
                    }
                    hint="Enter 0 to offer free shipping — this can improve your listing visibility."
                  />
                )}

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
                    {images.filter((i) => i.uploaded).length !== 1
                      ? "s"
                      : ""}{" "}
                    uploaded
                  </p>
                </div>
              </div>
            )}

            {/* ── Footer nav ────────────────────────────────────────────── */}
            <div
              className="px-6 py-4 bg-[#F8F7F4] border-t border-[#E3E0D9]
              flex items-center justify-between gap-3"
            >
              {step > 1 ? (
                <Button variant="ghost" size="md" onClick={goBack}>
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
                    <Button
                      variant="ghost"
                      size="md"
                      onClick={() => setShowPreview(true)}
                    >
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
                      onClick={handleSaveDraft}
                    >
                      Save as Draft
                    </Button>
                  </>
                )}
                {step < 4 ? (
                  <Button variant="primary" size="md" onClick={goNext}>
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
                    onClick={handleSubmit}
                  >
                    Publish listing
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Draft saved toast */}
      {draftSaved && (
        <div
          className="fixed bottom-6 right-6 z-50 bg-emerald-600 text-white px-5 py-3 rounded-xl shadow-lg
          flex items-center gap-2 text-[13px] font-medium animate-in fade-in slide-in-from-bottom-2 duration-300"
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
          Draft saved successfully
        </div>
      )}

      {/* Preview modal */}
      <ListingPreviewModal
        open={showPreview}
        onClose={() => setShowPreview(false)}
        title={title}
        description={description}
        price={price}
        condition={condition}
        categoryId={categoryId}
        subcategory={subcategory}
        images={images
          .filter((i) => i.url)
          .map((i, idx) => ({
            id: i.id,
            url: i.url,
            altText: `Photo ${idx + 1}`,
            order: idx,
          }))}
        shippingOption={shippingOption}
        shippingPrice={shippingPrice}
        region={region}
        suburb={suburb}
        offersEnabled={offersEnabled}
        gstIncluded={gstIncluded}
        isUrgent={isUrgent}
        isNegotiable={isNegotiable}
        shipsNationwide={shipsNationwide}
      />

      <Footer />
    </>
  );
}
