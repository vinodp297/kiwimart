"use client";

import { Button } from "@/components/ui/primitives";
import type { OrderDetailData } from "./order-types";
import { VALID_COURIERS } from "@/shared/constants";
import { ModalOverlay } from "./order-icons";

export default function OrderDispatchModal({
  order,
  dispatchStep,
  onSetDispatchStep,
  courierService,
  onSetCourierService,
  trackingNumber,
  onSetTrackingNumber,
  trackingUrl,
  onSetTrackingUrl,
  estimatedDeliveryDate,
  onSetEstimatedDeliveryDate,
  dispatchPhotos,
  dispatchPhotoKeys,
  uploadingPhotos,
  dispatchSuccess,
  onUploadDispatchPhotos,
  onRemoveDispatchPhoto,
  onDispatch,
  onClose,
  actionLoading,
}: {
  order: OrderDetailData;
  dispatchStep: number;
  onSetDispatchStep: (step: number) => void;
  courierService: string;
  onSetCourierService: (v: string) => void;
  trackingNumber: string;
  onSetTrackingNumber: (v: string) => void;
  trackingUrl: string;
  onSetTrackingUrl: (v: string) => void;
  estimatedDeliveryDate: string;
  onSetEstimatedDeliveryDate: (v: string) => void;
  dispatchPhotos: File[];
  dispatchPhotoKeys: string[];
  uploadingPhotos: boolean;
  dispatchSuccess: boolean;
  onUploadDispatchPhotos: (files: File[]) => void;
  onRemoveDispatchPhoto: (index: number) => void;
  onDispatch: () => void;
  onClose: () => void;
  actionLoading: boolean;
}) {
  return (
    <ModalOverlay onClose={onClose}>
      {dispatchSuccess ? (
        <div className="text-center py-4">
          <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#10b981"
              strokeWidth="2.5"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="font-[family-name:var(--font-playfair)] text-[1.15rem] font-semibold text-[#141414] mb-2">
            Dispatched!
          </h2>
          <p className="text-[13px] text-[#73706A] mb-4">
            {order.otherPartyName} will be notified immediately.
            {estimatedDeliveryDate && (
              <>
                {" "}
                Estimated delivery:{" "}
                <strong>
                  {new Date(estimatedDeliveryDate).toLocaleDateString("en-NZ", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                </strong>
                .
              </>
            )}
          </p>
          <div className="bg-sky-50 rounded-xl border border-sky-200 p-4 text-left mb-4">
            <p className="text-[12.5px] text-sky-800 font-semibold mb-1">
              What happens next
            </p>
            <ul className="text-[12px] text-sky-700 space-y-1 list-disc list-inside">
              <li>
                The buyer has up to 14 days after delivery to confirm receipt
              </li>
              <li>Payment will be released once they confirm</li>
              <li>
                If they don&apos;t respond, payment is released automatically
              </li>
            </ul>
          </div>
          <Button variant="gold" fullWidth size="md" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <div>
          {/* Step indicators */}
          <div className="flex items-center gap-2 mb-5">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center gap-2 flex-1">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-semibold shrink-0
                  ${dispatchStep >= s ? "bg-[#D4A843] text-white" : "bg-[#F0EDE8] text-[#9E9A91]"}`}
                >
                  {dispatchStep > s ? (
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
                    s
                  )}
                </div>
                {s < 3 && (
                  <div
                    className={`flex-1 h-0.5 ${dispatchStep > s ? "bg-[#D4A843]" : "bg-[#E3E0D9]"}`}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="max-h-[65vh] overflow-y-auto pr-1">
            {dispatchStep === 1 && (
              <div className="space-y-4">
                <div>
                  <h2 className="font-[family-name:var(--font-playfair)] text-[1.05rem] font-semibold text-[#141414] mb-1">
                    Photo your item before packing
                  </h2>
                  <p className="text-[12.5px] text-[#73706A]">
                    These photos protect you if a buyer claims damage. Show the
                    item from multiple angles.
                  </p>
                </div>
                {dispatchPhotos.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {dispatchPhotos.map((f, i) => (
                      <div
                        key={i}
                        className="relative w-20 h-20 rounded-xl overflow-hidden border border-[#E3E0D9]"
                      >
                        <img
                          src={URL.createObjectURL(f)}
                          alt={`Photo ${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => onRemoveDispatchPhoto(i)}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center"
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {dispatchPhotos.length < 4 && (
                  <label
                    className={`flex flex-col items-center justify-center gap-2 px-4 py-6 rounded-xl border-2 border-dashed cursor-pointer transition
                    ${uploadingPhotos ? "border-[#D4A843]/40 text-[#9E9A91] cursor-wait" : "border-[#E3E0D9] text-[#73706A] hover:border-[#D4A843] hover:text-[#D4A843]"}`}
                  >
                    {uploadingPhotos ? (
                      <span className="text-[13px] font-medium">
                        Uploading...
                      </span>
                    ) : (
                      <>
                        <svg
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                        >
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <path d="m21 15-5-5L5 21" />
                        </svg>
                        <span className="text-[13px] font-medium">
                          Add photos (1-4 required)
                        </span>
                        <span className="text-[11px] text-[#9E9A91]">
                          JPG, PNG, or WebP up to 5MB each
                        </span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      className="hidden"
                      disabled={uploadingPhotos}
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []);
                        onUploadDispatchPhotos(
                          files.slice(0, 4 - dispatchPhotos.length),
                        );
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
                <Button
                  variant="gold"
                  fullWidth
                  size="md"
                  disabled={dispatchPhotoKeys.length === 0 || uploadingPhotos}
                  onClick={() => onSetDispatchStep(2)}
                >
                  Next: Shipping details
                </Button>
              </div>
            )}
            {dispatchStep === 2 && (
              <div className="space-y-4">
                <h2 className="font-[family-name:var(--font-playfair)] text-[1.05rem] font-semibold text-[#141414] mb-1">
                  Shipping details
                </h2>
                <p className="text-[12.5px] text-[#73706A] -mt-2">
                  The buyer will see the estimated date. We&apos;ll send them
                  reminders if it passes.
                </p>
                <div>
                  <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                    Courier <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={courierService}
                    onChange={(e) => onSetCourierService(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843] transition"
                  >
                    <option value="">Select courier...</option>
                    {VALID_COURIERS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                    Tracking number <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={trackingNumber}
                    onChange={(e) => onSetTrackingNumber(e.target.value)}
                    placeholder="e.g. NZ123456789"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843] transition"
                  />
                </div>
                <div>
                  <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                    Tracking URL{" "}
                    <span className="text-[#9E9A91] font-normal">
                      (optional)
                    </span>
                  </label>
                  <input
                    value={trackingUrl}
                    onChange={(e) => onSetTrackingUrl(e.target.value)}
                    placeholder="e.g. https://nzpost.co.nz/track/..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843] transition"
                  />
                </div>
                <div>
                  <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                    Estimated delivery date{" "}
                    <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={estimatedDeliveryDate}
                    onChange={(e) => onSetEstimatedDeliveryDate(e.target.value)}
                    min={
                      new Date(Date.now() + 86400000)
                        .toISOString()
                        .split("T")[0]
                    }
                    max={
                      new Date(Date.now() + 14 * 86400000)
                        .toISOString()
                        .split("T")[0]
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843] transition"
                  />
                  <p className="text-[11px] text-[#9E9A91] mt-1">
                    1-14 business days from today
                  </p>
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="ghost"
                    size="md"
                    onClick={() => onSetDispatchStep(1)}
                    className="flex-1"
                  >
                    Back
                  </Button>
                  <Button
                    variant="gold"
                    size="md"
                    className="flex-1"
                    disabled={
                      !courierService ||
                      !trackingNumber ||
                      !estimatedDeliveryDate
                    }
                    onClick={() => onSetDispatchStep(3)}
                  >
                    Next: Review
                  </Button>
                </div>
              </div>
            )}
            {dispatchStep === 3 && (
              <div className="space-y-4">
                <h2 className="font-[family-name:var(--font-playfair)] text-[1.05rem] font-semibold text-[#141414]">
                  Confirm &amp; dispatch
                </h2>
                <div className="bg-[#FAFAF8] rounded-xl border border-[#E3E0D9] p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    {order.listingThumbnail && (
                      <img
                        src={order.listingThumbnail}
                        alt=""
                        className="w-12 h-12 rounded-lg object-cover border border-[#E3E0D9]"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-[#141414] line-clamp-1">
                        {order.listingTitle}
                      </p>
                      <p className="text-[12px] text-[#73706A]">
                        To: {order.otherPartyName}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[12px]">
                    <div>
                      <span className="text-[#9E9A91]">Courier:</span>{" "}
                      <span className="text-[#141414] font-medium">
                        {courierService}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#9E9A91]">Tracking:</span>{" "}
                      <span className="text-[#141414] font-medium font-mono">
                        {trackingNumber}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#9E9A91]">Est. delivery:</span>{" "}
                      <span className="text-[#141414] font-medium">
                        {estimatedDeliveryDate
                          ? new Date(estimatedDeliveryDate).toLocaleDateString(
                              "en-NZ",
                              {
                                weekday: "short",
                                day: "numeric",
                                month: "short",
                              },
                            )
                          : "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#9E9A91]">Photos:</span>{" "}
                      <span className="text-[#141414] font-medium">
                        {dispatchPhotoKeys.length} uploaded
                      </span>
                    </div>
                  </div>
                </div>
                <div className="bg-sky-50 rounded-xl border border-sky-200 p-3 text-[12px] text-sky-800">
                  Once confirmed, {order.otherPartyName} will be notified
                  immediately with your tracking details.
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="ghost"
                    size="md"
                    onClick={() => onSetDispatchStep(2)}
                    className="flex-1"
                  >
                    Back
                  </Button>
                  <Button
                    variant="gold"
                    size="md"
                    className="flex-1"
                    onClick={onDispatch}
                    loading={actionLoading}
                  >
                    Confirm dispatch
                  </Button>
                </div>
                <p className="text-[11px] text-[#9E9A91] text-center">
                  Payment is released only after the buyer confirms delivery
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </ModalOverlay>
  );
}
