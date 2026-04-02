"use client";

// src/components/pickup/PickupStatusBanner.tsx
// ─── Pickup Order Status Banner ─────────────────────────────────────────────
// Renders at the top of order detail for pickup orders.
// Shows current pickup state with role-appropriate actions.

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/primitives";
import { OTPEntryForm } from "./OTPEntryForm";
import { RejectItemDialog } from "./RejectItemDialog";
import { RescheduleForm } from "./RescheduleForm";
import { initiatePickupOTP } from "@/server/actions/pickup.actions";

interface PickupStatusBannerProps {
  pickupStatus: string | null;
  fulfillmentType: string;
  pickupScheduledAt: string | null;
  pickupWindowExpiresAt: string | null;
  otpExpiresAt: string | null;
  rescheduleCount: number;
  userRole: "BUYER" | "SELLER";
  orderId: string;
  listingTitle: string;
}

function Countdown({ targetDate }: { targetDate: string }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    const target = new Date(targetDate).getTime();
    const update = () => {
      const diff = target - Date.now();
      if (diff <= 0) {
        setRemaining("Expired");
        return;
      }
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      if (hours > 0) {
        setRemaining(`${hours}h ${minutes}m`);
      } else {
        setRemaining(`${minutes}m ${seconds}s`);
      }
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  return (
    <span className="font-mono text-sm font-semibold tabular-nums">
      {remaining}
    </span>
  );
}

function formatPickupTime(iso: string): string {
  return new Date(iso).toLocaleString("en-NZ", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function PickupStatusBanner({
  pickupStatus,
  fulfillmentType,
  pickupScheduledAt,
  pickupWindowExpiresAt,
  otpExpiresAt,
  rescheduleCount,
  userRole,
  orderId,
  listingTitle,
}: PickupStatusBannerProps) {
  const [showReschedule, setShowReschedule] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [initiatingOTP, setInitiatingOTP] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);

  const handleInitiateOTP = useCallback(async () => {
    setInitiatingOTP(true);
    setOtpError(null);
    try {
      const result = await initiatePickupOTP(orderId);
      if (!result.success) {
        setOtpError(result.error ?? "Failed to initiate OTP");
      } else {
        window.location.reload();
      }
    } catch {
      setOtpError("Something went wrong. Please try again.");
    } finally {
      setInitiatingOTP(false);
    }
  }, [orderId]);

  // ── CASH_ON_PICKUP ──────────────────────────────────────────────────────
  if (fulfillmentType === "CASH_ON_PICKUP") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <span className="text-xl">💵</span>
          <div>
            <h3 className="text-sm font-semibold text-amber-900">
              Cash on Pickup
            </h3>
            <p className="text-sm text-amber-700 mt-1">
              Arrange the meeting directly with the{" "}
              {userRole === "BUYER" ? "seller" : "buyer"} via messages. Meet in
              a public, well-lit location for safety.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── ONLINE_PAYMENT_PICKUP statuses ──────────────────────────────────────

  if (!pickupStatus) return null;

  // AWAITING_SCHEDULE
  if (pickupStatus === "AWAITING_SCHEDULE") {
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <div className="flex items-start gap-3">
          <span className="text-xl">📅</span>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-blue-900">
              Arrange a Pickup Time
            </h3>
            <p className="text-sm text-blue-700 mt-1">
              {userRole === "BUYER"
                ? "Propose a pickup time to the seller. You have 48 hours to agree on a time."
                : "Waiting for the buyer to propose a pickup time. You have 48 hours to agree."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // SCHEDULING
  if (pickupStatus === "SCHEDULING") {
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <div className="flex items-start gap-3">
          <span className="text-xl">🔄</span>
          <div>
            <h3 className="text-sm font-semibold text-blue-900">
              Pickup Time Being Arranged
            </h3>
            <p className="text-sm text-blue-700 mt-1">
              A pickup time has been proposed. Check your messages to accept or
              suggest a different time.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // SCHEDULED
  if (pickupStatus === "SCHEDULED") {
    const canInitiate =
      userRole === "SELLER" &&
      pickupScheduledAt &&
      new Date(pickupScheduledAt).getTime() - Date.now() <= 15 * 60 * 1000 &&
      pickupWindowExpiresAt &&
      Date.now() <= new Date(pickupWindowExpiresAt).getTime();

    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <span className="text-xl">✅</span>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-green-900">
              Pickup Confirmed
            </h3>
            {pickupScheduledAt && (
              <p className="text-lg font-bold text-green-800 mt-1">
                {formatPickupTime(pickupScheduledAt)}
              </p>
            )}
            {pickupWindowExpiresAt && (
              <p className="text-xs text-green-700 mt-1">
                Window expires in:{" "}
                <Countdown targetDate={pickupWindowExpiresAt} />
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 ml-8">
          {userRole === "SELLER" && (
            <>
              <Button
                size="sm"
                variant="gold"
                onClick={handleInitiateOTP}
                loading={initiatingOTP}
                disabled={!canInitiate}
              >
                Initiate Pickup Confirmation
              </Button>
              {!canInitiate && (
                <p className="text-xs text-green-600 w-full">
                  Available within 15 minutes of scheduled time
                </p>
              )}
            </>
          )}
          {userRole === "BUYER" && (
            <p className="text-sm text-green-700">
              Waiting for seller to initiate confirmation at pickup
            </p>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setShowReschedule(true)}
          >
            Request Reschedule
          </Button>
        </div>
        {otpError && <p className="text-sm text-red-600 ml-8">{otpError}</p>}
        {showReschedule && (
          <div className="ml-8 mt-2 border-t border-green-200 pt-3">
            <RescheduleForm
              orderId={orderId}
              userRole={userRole}
              onSuccess={() => window.location.reload()}
            />
          </div>
        )}
      </div>
    );
  }

  // RESCHEDULING
  if (pickupStatus === "RESCHEDULING") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <span className="text-xl">🔄</span>
          <div>
            <h3 className="text-sm font-semibold text-amber-900">
              Reschedule Pending
            </h3>
            <p className="text-sm text-amber-700 mt-1">
              A reschedule request is pending. Check your messages to respond.
            </p>
            {rescheduleCount >= 3 && (
              <p className="text-xs text-amber-600 mt-2 font-medium">
                Multiple reschedules detected. You may be eligible for a full
                refund cancellation.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // OTP_INITIATED
  if (pickupStatus === "OTP_INITIATED") {
    return (
      <div className="rounded-xl border border-purple-200 bg-purple-50 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <span className="text-xl">🔐</span>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-purple-900">
              Pickup Confirmation In Progress
            </h3>
            {otpExpiresAt && (
              <p className="text-xs text-purple-700 mt-1">
                Code expires in: <Countdown targetDate={otpExpiresAt} />
              </p>
            )}
          </div>
        </div>

        {userRole === "SELLER" && (
          <div className="ml-8">
            <p className="text-sm text-purple-700 mb-3">
              OTP sent to buyer&apos;s phone. Enter the 6-digit code they share
              with you.
            </p>
            <OTPEntryForm
              orderId={orderId}
              onSuccess={() => window.location.reload()}
            />
          </div>
        )}

        {userRole === "BUYER" && (
          <div className="ml-8 space-y-3">
            <p className="text-sm text-purple-700">
              Check your SMS for your 6-digit pickup code. Share it with the
              seller <strong>only when you are satisfied with the item</strong>.
            </p>
            <Button
              size="sm"
              variant="danger"
              onClick={() => setShowRejectDialog(true)}
            >
              Reject Item
            </Button>
          </div>
        )}

        {showRejectDialog && (
          <RejectItemDialog
            orderId={orderId}
            listingTitle={listingTitle}
            onSuccess={() => window.location.reload()}
            onCancel={() => setShowRejectDialog(false)}
          />
        )}
      </div>
    );
  }

  // COMPLETED
  if (pickupStatus === "COMPLETED") {
    return (
      <div className="rounded-xl border border-green-300 bg-green-100 p-4">
        <div className="flex items-center gap-3">
          <span className="text-xl">🎉</span>
          <h3 className="text-sm font-semibold text-green-900">
            Pickup completed successfully
          </h3>
        </div>
      </div>
    );
  }

  // SELLER_NO_SHOW
  if (pickupStatus === "SELLER_NO_SHOW") {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <div className="flex items-start gap-3">
          <span className="text-xl">⚠️</span>
          <div>
            <h3 className="text-sm font-semibold text-red-900">
              Seller No-Show
            </h3>
            <p className="text-sm text-red-700 mt-1">
              {userRole === "BUYER"
                ? "The seller did not show up. Your order has been cancelled and a full refund is being processed."
                : "You missed the pickup appointment. The order has been cancelled and the buyer has been refunded."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // BUYER_NO_SHOW
  if (pickupStatus === "BUYER_NO_SHOW") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <span className="text-xl">⏰</span>
          <div>
            <h3 className="text-sm font-semibold text-amber-900">
              Buyer No-Show
            </h3>
            <p className="text-sm text-amber-700 mt-1">
              {userRole === "BUYER"
                ? "You did not enter the pickup code in time. The seller has been paid. Contact support if this is an error."
                : "The buyer did not confirm the pickup in time. Your payment has been automatically released."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // REJECTED_AT_PICKUP
  if (pickupStatus === "REJECTED_AT_PICKUP") {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <div className="flex items-start gap-3">
          <span className="text-xl">❌</span>
          <div>
            <h3 className="text-sm font-semibold text-red-900">
              Item Rejected at Pickup
            </h3>
            <p className="text-sm text-red-700 mt-1">
              {userRole === "BUYER"
                ? "You rejected this item at pickup. A dispute has been opened and is being reviewed."
                : "The buyer rejected this item at pickup. A dispute has been opened."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // CANCELLED
  if (pickupStatus === "CANCELLED") {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <div className="flex items-center gap-3">
          <span className="text-xl">🚫</span>
          <h3 className="text-sm font-semibold text-gray-700">
            Pickup Cancelled
          </h3>
        </div>
      </div>
    );
  }

  return null;
}
