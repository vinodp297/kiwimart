"use client";

import { Button } from "@/components/ui/primitives";
import type { OrderDetailData, TimelineEvent } from "./order-types";

export default function OrderCounterEvidence({
  order,
  timelineEvents,
  showCounterEvidence,
  onSetShowCounterEvidence,
  counterDescription,
  onSetCounterDescription,
  counterPhotos,
  counterPhotoKeys: _counterPhotoKeys,
  uploadingCounter,
  submittingCounter,
  onUploadCounterPhotos,
  onRemoveCounterPhoto,
  onSubmitCounterEvidence,
}: {
  order: OrderDetailData;
  timelineEvents: TimelineEvent[];
  showCounterEvidence: boolean;
  onSetShowCounterEvidence: (v: boolean) => void;
  counterDescription: string;
  onSetCounterDescription: (v: string) => void;
  counterPhotos: File[];
  counterPhotoKeys: string[];
  uploadingCounter: boolean;
  submittingCounter: boolean;
  onUploadCounterPhotos: (files: File[]) => void;
  onRemoveCounterPhoto: (index: number) => void;
  onSubmitCounterEvidence: () => void;
}) {
  const queuedEvent = timelineEvents.find(
    (e) =>
      e.type === "AUTO_RESOLVED" &&
      (e.metadata as Record<string, unknown> | null)?.status === "QUEUED",
  );
  if (!queuedEvent) return null;

  const meta = queuedEvent.metadata as Record<string, unknown>;
  const executeAt = meta?.executeAt ? new Date(meta.executeAt as string) : null;
  const hoursLeft = executeAt
    ? Math.max(
        0,
        Math.ceil((executeAt.getTime() - Date.now()) / (1000 * 60 * 60)),
      )
    : null;
  const decision = meta?.decision as string;
  const outcomeText =
    decision === "AUTO_REFUND"
      ? "resolved with a refund to the buyer"
      : "dismissed in the seller's favour";
  const isAffectedParty =
    (decision === "AUTO_REFUND" && !order.isBuyer) ||
    (decision === "AUTO_DISMISS" && order.isBuyer);

  return (
    <div className="bg-amber-50 rounded-2xl border border-amber-200 p-5 mb-6">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#d97706"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="text-[13.5px] font-semibold text-amber-900">
            Resolution pending
            {hoursLeft !== null && hoursLeft > 0
              ? ` — ${hoursLeft} hour${hoursLeft !== 1 ? "s" : ""} remaining`
              : " — processing soon"}
          </p>
          <p className="text-[12.5px] text-amber-800 mt-1">
            Based on the evidence reviewed, this dispute is scheduled to be{" "}
            <strong>{outcomeText}</strong>.
          </p>

          {isAffectedParty && (
            <div className="mt-3">
              {!showCounterEvidence ? (
                <button
                  type="button"
                  onClick={() => onSetShowCounterEvidence(true)}
                  className="text-[12.5px] font-semibold text-amber-800 hover:text-amber-900 underline transition"
                >
                  Have additional evidence? Submit it now
                </button>
              ) : (
                <div className="mt-2 space-y-3 bg-white rounded-xl p-4 border border-amber-200">
                  <textarea
                    value={counterDescription}
                    onChange={(e) => onSetCounterDescription(e.target.value)}
                    placeholder="Describe your evidence..."
                    rows={3}
                    maxLength={2000}
                    className="w-full px-3 py-2 rounded-lg border border-[#C9C5BC] bg-white text-[13px] text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843] transition resize-none"
                  />
                  {counterPhotos.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {counterPhotos.map((f, i) => (
                        <div
                          key={i}
                          className="relative w-14 h-14 rounded-lg overflow-hidden border border-[#E3E0D9]"
                        >
                          <img
                            src={URL.createObjectURL(f)}
                            alt={`Evidence ${i + 1}`}
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => onRemoveCounterPhoto(i)}
                            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/60 text-white text-[9px] flex items-center justify-center"
                          >
                            &times;
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {counterPhotos.length < 4 && (
                    <label
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer text-[12px] font-medium transition ${uploadingCounter ? "text-[#9E9A91] cursor-wait" : "border-[#E3E0D9] text-[#73706A] hover:border-[#D4A843] hover:text-[#D4A843]"}`}
                    >
                      {uploadingCounter ? "Uploading..." : "Add photos"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        className="hidden"
                        disabled={uploadingCounter}
                        onChange={(e) => {
                          onUploadCounterPhotos(
                            Array.from(e.target.files ?? []).slice(
                              0,
                              4 - counterPhotos.length,
                            ),
                          );
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="gold"
                      size="sm"
                      onClick={onSubmitCounterEvidence}
                      loading={submittingCounter}
                      disabled={
                        counterDescription.length < 10 || uploadingCounter
                      }
                    >
                      Submit evidence
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onSetShowCounterEvidence(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {!isAffectedParty && (
            <p className="text-[12px] text-amber-700 mt-2">
              The other party has been notified and can submit counter-evidence
              before the resolution takes effect.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
