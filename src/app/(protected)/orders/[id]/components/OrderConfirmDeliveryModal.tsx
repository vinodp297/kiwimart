"use client";

import { Button } from "@/components/ui/primitives";
import { formatPrice } from "@/lib/utils";
import type { OrderDetailData } from "./order-types";
import { ModalOverlay } from "./order-icons";

export default function OrderConfirmDeliveryModal({
  order,
  itemAsDescribed,
  onSetItemAsDescribed,
  deliveryIssueType,
  onSetDeliveryIssueType,
  deliveryPhotos,
  deliveryPhotoKeys: _deliveryPhotoKeys,
  uploadingDeliveryPhotos,
  deliveryNotes,
  onSetDeliveryNotes,
  onUploadDeliveryPhotos,
  onRemoveDeliveryPhoto,
  onConfirmDelivery,
  onClose,
  onOpenDispute,
  actionLoading,
}: {
  order: OrderDetailData;
  itemAsDescribed: "yes" | "no" | null;
  onSetItemAsDescribed: (v: "yes" | "no") => void;
  deliveryIssueType: string;
  onSetDeliveryIssueType: (v: string) => void;
  deliveryPhotos: File[];
  deliveryPhotoKeys: string[];
  uploadingDeliveryPhotos: boolean;
  deliveryNotes: string;
  onSetDeliveryNotes: (v: string) => void;
  onUploadDeliveryPhotos: (files: File[]) => void;
  onRemoveDeliveryPhoto: (index: number) => void;
  onConfirmDelivery: () => void;
  onClose: () => void;
  onOpenDispute: () => void;
  actionLoading: boolean;
}) {
  return (
    <ModalOverlay onClose={onClose}>
      <h2 className="font-[family-name:var(--font-playfair)] text-[1.15rem] font-semibold text-[#141414] mb-2 text-center">
        Confirm delivery
      </h2>
      <p className="text-[13px] text-[#73706A] mb-4 text-center">
        Confirming delivery will release{" "}
        <span className="font-semibold text-[#141414]">
          {formatPrice(order.total)}
        </span>{" "}
        to{" "}
        <span className="font-semibold text-[#141414]">
          {order.otherPartyName}
        </span>
        .
      </p>
      <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
        <div>
          <label className="text-[12.5px] font-semibold text-[#141414] mb-2 block">
            Did the item arrive as described?{" "}
            <span className="text-red-500">*</span>
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => onSetItemAsDescribed("yes")}
              className={`flex-1 py-2.5 rounded-xl border text-[13px] font-medium transition
                ${itemAsDescribed === "yes" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-[#E3E0D9] text-[#73706A] hover:border-[#D4A843]"}`}
            >
              Yes, all good
            </button>
            <button
              type="button"
              onClick={() => onSetItemAsDescribed("no")}
              className={`flex-1 py-2.5 rounded-xl border text-[13px] font-medium transition
                ${itemAsDescribed === "no" ? "border-red-500 bg-red-50 text-red-700" : "border-[#E3E0D9] text-[#73706A] hover:border-[#D4A843]"}`}
            >
              No, there&apos;s an issue
            </button>
          </div>
        </div>

        {itemAsDescribed === "no" && (
          <>
            <div>
              <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                What&apos;s wrong? <span className="text-red-500">*</span>
              </label>
              <select
                value={deliveryIssueType}
                onChange={(e) => onSetDeliveryIssueType(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843] transition"
              >
                <option value="">Select issue...</option>
                <option value="DAMAGED">Damaged</option>
                <option value="WRONG_ITEM">Wrong item</option>
                <option value="MISSING_PARTS">Missing parts</option>
                <option value="NOT_AS_DESCRIBED">Not as described</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                Photos of received item{" "}
                <span className="text-[#9E9A91] font-normal">
                  (optional, max 4)
                </span>
              </label>
              {deliveryPhotos.length > 0 && (
                <div className="flex gap-2 flex-wrap mb-2">
                  {deliveryPhotos.map((f, i) => (
                    <div
                      key={i}
                      className="relative w-14 h-14 rounded-lg overflow-hidden border border-[#E3E0D9]"
                    >
                      <img
                        src={URL.createObjectURL(f)}
                        alt={`Delivery photo ${i + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => onRemoveDeliveryPhoto(i)}
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center shadow"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {deliveryPhotos.length < 4 && (
                <label
                  className={`flex items-center justify-center gap-2 px-3 py-2 rounded-xl border-2 border-dashed cursor-pointer transition text-[12px] font-medium
                  ${uploadingDeliveryPhotos ? "border-[#D4A843]/40 text-[#9E9A91] cursor-wait" : "border-[#E3E0D9] text-[#73706A] hover:border-[#D4A843] hover:text-[#D4A843]"}`}
                >
                  {uploadingDeliveryPhotos ? "Uploading..." : "Add photos"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    className="hidden"
                    disabled={uploadingDeliveryPhotos}
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      onUploadDeliveryPhotos(
                        files.slice(0, 4 - deliveryPhotos.length),
                      );
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
            <div>
              <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                Notes{" "}
                <span className="text-[#9E9A91] font-normal">(optional)</span>
              </label>
              <textarea
                value={deliveryNotes}
                onChange={(e) => onSetDeliveryNotes(e.target.value)}
                placeholder="Describe the issue..."
                rows={3}
                maxLength={2000}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843] transition resize-none"
              />
            </div>
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-left">
              <p className="text-[12px] text-amber-800">
                The seller will be notified of the issue and has 72 hours to
                respond. If unresolved, it will be escalated to our team.
              </p>
            </div>
          </>
        )}

        {itemAsDescribed === "yes" && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-left">
            <p className="text-[12px] text-amber-800 font-semibold flex items-center gap-1.5">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              This action cannot be undone
            </p>
            <p className="text-[11.5px] text-amber-700 mt-1">
              Payment will be released to the seller immediately.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Button
            variant="gold"
            fullWidth
            size="md"
            onClick={onConfirmDelivery}
            loading={actionLoading}
            disabled={
              itemAsDescribed === null ||
              (itemAsDescribed === "no" && !deliveryIssueType) ||
              uploadingDeliveryPhotos
            }
          >
            {itemAsDescribed === "no"
              ? "Confirm delivery & report issue"
              : `Yes, I received it — release ${formatPrice(order.total)}`}
          </Button>
          <Button variant="ghost" fullWidth size="md" onClick={onClose}>
            Cancel
          </Button>
          <button
            type="button"
            onClick={onOpenDispute}
            className="text-[12px] text-red-500 hover:text-red-600 font-medium mt-1 transition-colors"
          >
            Something wrong? Open a dispute instead
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}
