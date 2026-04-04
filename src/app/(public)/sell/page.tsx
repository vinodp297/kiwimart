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
import { useSessionSafe } from "@/hooks/useSessionSafe";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/primitives";
import {
  requestImageUpload,
  confirmImageUpload,
  cleanupOrphanedImages,
} from "@/server/actions/images";
import { createListing, saveDraft } from "@/server/actions/listings";
import ListingPreviewModal from "./ListingPreviewModal";

import type {
  ImagePreview,
  Condition,
  ShippingOption,
  NZRegion,
} from "./components/sell-types";
import { ACCEPTED_IMAGE_TYPES } from "./components/sell-types";
import {
  SubmittedScreen,
  LoadingScreen,
  StripeGateScreen,
  EmailGateScreen,
} from "./components/SellGateScreens";
import SellWizardProgress from "./components/SellWizardProgress";
import SellStep1Photos from "./components/SellStep1Photos";
import SellStep2Details from "./components/SellStep2Details";
import SellStep3Pricing from "./components/SellStep3Pricing";
import SellStep4Shipping from "./components/SellStep4Shipping";
import SellFooterNav from "./components/SellFooterNav";

// ─────────────────────────────────────────────────────────────────────────────
export default function SellPage() {
  const { data: session } = useSessionSafe();
  const [emailVerified, setEmailVerified] = useState(false);

  // Keep emailVerified in sync with session
  useEffect(() => {
    setEmailVerified(!!session?.user?.emailVerified);
  }, [session?.user?.emailVerified]);

  // ── Seller status check ──────────────────────────────────────────────────
  const [sellerStatus, setSellerStatus] = useState<{
    loading: boolean;
    stripeOnboarded: boolean;
    authenticated: boolean;
  }>({ loading: true, stripeOnboarded: false, authenticated: false });

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    // Clean up orphaned images from previous abandoned sessions (fire-and-forget)
    cleanupOrphanedImages().catch(() => {
      /* non-critical */
    });

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
      // Use the processed r2Key if returned (image processor renames to -full.webp)
      const finalR2Key = processed.r2Key ?? r2Key;
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
                r2Key: finalR2Key,
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
      const rejected = allFiles.filter(
        (f) => !ACCEPTED_IMAGE_TYPES.includes(f.type),
      );
      if (rejected.length > 0) {
        setErrors((prev) => ({
          ...prev,
          images: `${rejected.length} file${rejected.length > 1 ? "s were" : " was"} skipped — only JPG, PNG, and WebP photos are allowed.`,
        }));
      }
      const remaining = 10 - images.length;
      const imageFiles = allFiles.filter((f) =>
        ACCEPTED_IMAGE_TYPES.includes(f.type),
      );
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
      const unsafe = images.filter((i) => i.uploaded && !i.safe && !i.error);
      if (unsafe.length > 0)
        errs.images =
          "Some photos haven't been verified yet. Please wait or re-upload them.";
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
    try {
      localStorage.removeItem("kiwi-sell-draft");
    } catch {
      /* localStorage unavailable */
    }
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

  // ── "List another" reset ─────────────────────────────────────────────────
  function handleListAnother() {
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
  }

  // ── Gate screens ─────────────────────────────────────────────────────────
  if (submitted) {
    return <SubmittedScreen title={title} onListAnother={handleListAnother} />;
  }

  if (sellerStatus.loading) {
    return <LoadingScreen />;
  }

  if (sellerStatus.authenticated && !sellerStatus.stripeOnboarded) {
    return <StripeGateScreen />;
  }

  if (!emailVerified) {
    return <EmailGateScreen onVerified={() => setEmailVerified(true)} />;
  }

  // ── Main wizard ──────────────────────────────────────────────────────────
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

          <SellWizardProgress step={step} />

          {/* ── Step panels ─────────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-[#E3E0D9] shadow-sm overflow-hidden">
            {step === 1 && (
              <SellStep1Photos
                images={images}
                dragActive={dragActive}
                errors={errors}
                fileInputRef={fileInputRef}
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  addFiles(e.dataTransfer.files);
                }}
                onClickZone={() => fileInputRef.current?.click()}
                onFileChange={(e) => addFiles(e.target.files)}
                onRemove={removeImage}
                onRetry={retryUpload}
                onReorder={reorderImage}
              />
            )}

            {step === 2 && (
              <SellStep2Details
                title={title}
                description={description}
                categoryId={categoryId}
                subcategory={subcategory}
                condition={condition}
                errors={errors}
                onTitleChange={(e) => {
                  setTitle(e.target.value);
                  setErrors((p) => ({ ...p, title: "" }));
                }}
                onDescriptionChange={(e) => {
                  setDescription(e.target.value);
                  setErrors((p) => ({ ...p, description: "" }));
                }}
                onCategoryChange={(e) => {
                  setCategoryId(e.target.value);
                  setSubcategory("");
                  setErrors((p) => ({ ...p, category: "" }));
                }}
                onSubcategoryChange={(e) => setSubcategory(e.target.value)}
                onConditionChange={(v) => {
                  setCondition(v);
                  setErrors((p) => ({ ...p, condition: "" }));
                }}
              />
            )}

            {step === 3 && (
              <SellStep3Pricing
                price={price}
                offersEnabled={offersEnabled}
                gstIncluded={gstIncluded}
                isUrgent={isUrgent}
                isNegotiable={isNegotiable}
                shipsNationwide={shipsNationwide}
                errors={errors}
                onPriceChange={(e) => {
                  setPrice(e.target.value);
                  setErrors((p) => ({ ...p, price: "" }));
                }}
                onOffersEnabledChange={setOffersEnabled}
                onGstIncludedChange={setGstIncluded}
                onIsUrgentChange={setIsUrgent}
                onIsNegotiableChange={setIsNegotiable}
                onShipsNationwideChange={setShipsNationwide}
              />
            )}

            {step === 4 && (
              <SellStep4Shipping
                shippingOption={shippingOption}
                shippingPrice={shippingPrice}
                region={region}
                suburb={suburb}
                errors={errors}
                submitError={submitError}
                title={title}
                price={price}
                condition={condition}
                categoryId={categoryId}
                images={images}
                onShippingOptionChange={(v) => {
                  setShippingOption(v);
                  setErrors((p) => ({ ...p, shippingOption: "" }));
                }}
                onShippingPriceChange={(e) => {
                  setShippingPrice(e.target.value);
                  setErrors((p) => ({ ...p, shippingPrice: "" }));
                }}
                onRegionChange={(e) => {
                  setRegion(e.target.value as NZRegion);
                  setErrors((p) => ({ ...p, region: "" }));
                }}
                onSuburbChange={(e) => {
                  setSuburb(e.target.value);
                  setErrors((p) => ({ ...p, suburb: "" }));
                }}
              />
            )}

            <SellFooterNav
              step={step}
              submitting={submitting}
              savingDraft={savingDraft}
              onBack={goBack}
              onNext={goNext}
              onSubmit={handleSubmit}
              onPreview={() => setShowPreview(true)}
              onSaveDraft={handleSaveDraft}
            />
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
