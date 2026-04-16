"use client";
// src/app/(public)/checkout/[listingId]/CheckoutForm.tsx
// ─── Checkout Form with Stripe Elements ─────────────────────────────────────
// Handles payment form, shipping address, and order creation.

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useSessionSafe } from "@/hooks/useSessionSafe";
import { loadStripe } from "@stripe/stripe-js";
import EmailVerificationInline from "@/components/EmailVerificationInline";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { Button, Input, Select, Alert } from "@/components/ui/primitives";
import { BuyerProtectionBadge } from "@/components/badges/BuyerProtectionBadge";
import { formatPrice, formatCondition } from "@/lib/utils";
import { createOrder } from "@/server/actions/orders";
import { env } from "@/env";

const stripePromise = loadStripe(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);

const NZ_REGIONS_DEFAULT = [
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
] as const;

interface CheckoutListing {
  id: string;
  title: string;
  priceNzd: number;
  shippingNzd: number;
  shippingOption: "pickup" | "courier" | "both";
  condition: string;
  region: string;
  suburb: string;
  thumbnailUrl: string;
  sellerName: string;
  sellerUsername: string;
}

interface Props {
  listing: CheckoutListing;
  regions?: string[];
}

export default function CheckoutForm({ listing, regions }: Props) {
  const NZ_REGIONS = regions ?? NZ_REGIONS_DEFAULT;
  const { data: session } = useSessionSafe();
  const [emailVerified, setEmailVerified] = useState(
    !!session?.user?.emailVerified,
  );
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Stable idempotency key — generated once per checkout mount, never changes.
  // Prevents duplicate orders from double-clicks or retried submissions.
  const idempotencyKey = useRef(`checkout-${crypto.randomUUID()}`);

  // Shipping address state
  const [name, setName] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [postcode, setPostcode] = useState("");

  const isPickup = listing.shippingOption === "pickup";
  const totalNzd = listing.priceNzd + listing.shippingNzd;

  async function handleCreateOrder() {
    // Validate shipping address for non-pickup orders
    if (!isPickup) {
      if (
        !name.trim() ||
        !line1.trim() ||
        !city.trim() ||
        !region ||
        !postcode.trim()
      ) {
        setError("Please fill in all shipping address fields.");
        return;
      }
    }

    setLoading(true);
    setError(null);
    setErrorReason(null);

    const result = await createOrder({
      listingId: listing.id,
      idempotencyKey: idempotencyKey.current,
      ...(!isPickup
        ? {
            shippingAddress: {
              name: name.trim(),
              line1: line1.trim(),
              line2: line2.trim() || undefined,
              city: city.trim(),
              region,
              postcode: postcode.trim(),
            },
          }
        : {}),
    });

    if (result.success) {
      setClientSecret(result.data.clientSecret);
      setOrderId(result.data.orderId);
    } else {
      setError(result.error);
      setErrorReason(result.reason ?? null);
    }
    setLoading(false);
  }

  async function handleRetry() {
    setError(null);
    setErrorReason(null);
    await handleCreateOrder();
  }

  // Keep emailVerified in sync with session changes
  useEffect(() => {
    setEmailVerified(!!session?.user?.emailVerified);
  }, [session?.user?.emailVerified]);

  // Auto-create order on mount if pickup (no address needed)
  useEffect(() => {
    // Only auto-create if we don't already have a secret and email is verified
    if (isPickup && !clientSecret && !loading && emailVerified) {
      handleCreateOrder();
    }
  }, [emailVerified]);

  if (clientSecret) {
    return (
      <Elements
        stripe={stripePromise}
        options={{
          clientSecret,
          appearance: {
            theme: "stripe",
            variables: {
              colorPrimary: "#D4A843",
              colorBackground: "#ffffff",
              fontFamily: "DM Sans, sans-serif",
              borderRadius: "12px",
            },
          },
        }}
      >
        <PaymentStep
          listing={listing}
          totalNzd={totalNzd}
          orderId={orderId!}
          clientSecret={clientSecret}
        />
      </Elements>
    );
  }

  if (!emailVerified) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8">
        <div className="space-y-6">
          <EmailVerificationInline onVerified={() => setEmailVerified(true)} />
        </div>
        <div className="lg:sticky lg:top-[76px] self-start">
          <OrderSummary listing={listing} totalNzd={totalNzd} />
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8">
      {/* Left — Shipping form */}
      <div className="space-y-6">
        {!isPickup && (
          <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
            <h2 className="font-[family-name:var(--font-playfair)] text-[1.15rem] font-semibold text-[#141414] mb-4">
              Shipping address
            </h2>
            <div className="space-y-4">
              <Input
                label="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Jane Smith"
                required
              />
              <Input
                label="Street address"
                value={line1}
                onChange={(e) => setLine1(e.target.value)}
                placeholder="e.g. 42 Queen Street"
                required
              />
              <Input
                label="Address line 2"
                value={line2}
                onChange={(e) => setLine2(e.target.value)}
                placeholder="Apartment, unit, etc. (optional)"
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="City/Town"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Auckland"
                  required
                />
                <Select
                  label="Region"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  required
                >
                  <option value="">Select region</option>
                  {NZ_REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </div>
              <Input
                label="Postcode"
                value={postcode}
                onChange={(e) => setPostcode(e.target.value)}
                placeholder="e.g. 1010"
                required
              />
            </div>
          </div>
        )}

        {isPickup && (
          <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
            <h2 className="font-[family-name:var(--font-playfair)] text-[1.15rem] font-semibold text-[#141414] mb-2">
              Pickup only
            </h2>
            <p className="text-[13.5px] text-[#73706A]">
              This item is for pickup from {listing.suburb}, {listing.region}.
              The seller will provide collection details after payment.
            </p>
          </div>
        )}

        {error ? (
          <CheckoutError
            error={error}
            reason={errorReason}
            listingId={listing.id}
            onRetry={handleRetry}
          />
        ) : isPickup && loading ? (
          <div className="flex items-center justify-center gap-2.5 py-4 text-[#73706A]">
            <svg
              className="animate-spin shrink-0"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            <span className="text-[13px]">Setting up your order…</span>
          </div>
        ) : null}

        {!isPickup && !error && (
          <Button
            variant="gold"
            size="lg"
            fullWidth
            onClick={handleCreateOrder}
            loading={loading}
          >
            Continue to payment
          </Button>
        )}
      </div>

      {/* Right — Order summary */}
      <div className="lg:sticky lg:top-[76px] self-start">
        <OrderSummary listing={listing} totalNzd={totalNzd} />
      </div>
    </div>
  );
}

// ── Order error helpers ─────────────────────────────────────────────────────

function getErrorDisplay(reason: string | null, message: string) {
  if (reason === "email_not_verified") {
    return {
      title: "Email verification required",
      body: "Please verify your email address before placing an order.",
      canRetry: false,
    };
  }
  if (reason === "listing_unavailable") {
    return {
      title: "This listing is no longer available",
      body: "It may have been sold or removed. Browse similar listings.",
      canRetry: false,
    };
  }
  if (reason === "stripe_unavailable") {
    return {
      title: "Payment setup failed",
      body: "We couldn't connect to our payment provider. This is usually temporary — please try again.",
      canRetry: true,
    };
  }
  if (reason === "seller_not_configured") {
    return {
      title: "Seller payment not set up",
      body: message,
      canRetry: false,
    };
  }
  if (reason === "rate_limited") {
    return {
      title: "Too many attempts",
      body: message,
      canRetry: false,
    };
  }
  if (reason === "own_listing") {
    return {
      title: "Cannot purchase your own listing",
      body: message,
      canRetry: false,
    };
  }
  return { title: "Something went wrong", body: message, canRetry: true };
}

function CheckoutError({
  error,
  reason,
  listingId,
  onRetry,
}: {
  error: string;
  reason: string | null;
  listingId: string;
  onRetry: () => void;
}) {
  const { title, body, canRetry } = getErrorDisplay(reason, error);
  return (
    <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
      <div className="flex items-start gap-2.5">
        <svg
          className="shrink-0 mt-0.5 text-red-500"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-red-800">{title}</p>
          <p className="text-[12.5px] text-red-700 mt-0.5 leading-relaxed">
            {body}
          </p>
          <div className="flex items-center gap-3 mt-3">
            {canRetry && (
              <Button variant="danger" size="sm" onClick={onRetry}>
                Try again
              </Button>
            )}
            <Link
              href={`/listings/${listingId}`}
              className="text-[12.5px] text-red-700 underline underline-offset-2 hover:text-red-900 transition-colors"
            >
              Go back to listing
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Payment Step (inside Stripe Elements) ───────────────────────────────────

function PaymentStep({
  listing,
  totalNzd,
  orderId,
  clientSecret,
}: {
  listing: CheckoutListing;
  totalNzd: number;
  orderId: string;
  clientSecret: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;

    setProcessing(true);
    setError(null);

    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message ?? "Payment submission failed.");
      setProcessing(false);
      return;
    }

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      clientSecret,
      confirmParams: {
        return_url: `${window.location.origin}/checkout/success?orderId=${orderId}`,
      },
    });

    if (confirmError) {
      setError(
        confirmError.type === "card_error" ||
          confirmError.type === "validation_error"
          ? (confirmError.message ?? "Payment failed. Please try again.")
          : "Something went wrong. Please try again.",
      );
      setProcessing(false);
    }
    // If no error, Stripe redirects to return_url
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8">
      <div className="space-y-6">
        <form onSubmit={handleSubmit}>
          <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
            <h2 className="font-[family-name:var(--font-playfair)] text-[1.15rem] font-semibold text-[#141414] mb-4">
              Payment details
            </h2>
            <PaymentElement
              options={{
                layout: "tabs",
              }}
            />
          </div>

          {error && (
            <Alert variant="error" className="mt-4">
              {error}
            </Alert>
          )}

          <div className="mt-4 space-y-3">
            <Button
              type="submit"
              variant="gold"
              size="lg"
              fullWidth
              loading={processing}
              disabled={!stripe || !elements}
            >
              Pay {formatPrice(totalNzd / 100)}
            </Button>

            <div className="flex items-start gap-2.5 px-1">
              <svg
                className="shrink-0 mt-0.5 text-[#D4A843]"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
              <p className="text-[11.5px] text-[#73706A] leading-relaxed">
                Your payment is held securely in escrow until you confirm
                delivery. Protected by{" "}
                {process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"}&apos;s Buyer
                Protection.
              </p>
            </div>
          </div>
        </form>
      </div>

      <div className="lg:sticky lg:top-[76px] self-start">
        <OrderSummary listing={listing} totalNzd={totalNzd} />
      </div>
    </div>
  );
}

// ── Order Summary Sidebar ───────────────────────────────────────────────────

function OrderSummary({
  listing,
  totalNzd,
}: {
  listing: CheckoutListing;
  totalNzd: number;
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#E3E0D9] p-5">
      <h3 className="text-[13px] font-semibold text-[#141414] mb-4">
        Order summary
      </h3>

      {/* Item */}
      <div className="flex items-start gap-3 mb-4">
        <img
          src={listing.thumbnailUrl}
          alt={listing.title}
          className="w-16 h-16 rounded-xl object-cover border border-[#E3E0D9] shrink-0"
        />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-[#141414] line-clamp-2">
            {listing.title}
          </p>
          <p className="text-[12px] text-[#9E9A91] mt-0.5">
            {formatCondition(listing.condition)} · {listing.sellerName}
          </p>
        </div>
      </div>

      {/* Price breakdown */}
      <div className="space-y-2 py-3 border-t border-[#F0EDE8]">
        <div className="flex justify-between text-[13px]">
          <span className="text-[#73706A]">Item price</span>
          <span className="text-[#141414] font-medium">
            {formatPrice(listing.priceNzd / 100)}
          </span>
        </div>
        <div className="flex justify-between text-[13px]">
          <span className="text-[#73706A]">Shipping</span>
          <span className="text-[#141414] font-medium">
            {listing.shippingNzd === 0
              ? listing.shippingOption === "pickup"
                ? "Pickup"
                : "Free"
              : formatPrice(listing.shippingNzd / 100)}
          </span>
        </div>
      </div>

      {/* Total */}
      <div className="flex justify-between py-3 border-t border-[#E3E0D9]">
        <span className="text-[14px] font-semibold text-[#141414]">Total</span>
        <span className="font-[family-name:var(--font-playfair)] text-[1.25rem] font-bold text-[#141414]">
          {formatPrice(totalNzd / 100)}
          <span className="text-[12px] font-normal text-[#9E9A91] ml-1">
            NZD
          </span>
        </span>
      </div>

      {/* Buyer protection */}
      <div className="mt-3">
        <BuyerProtectionBadge variant="full" />
      </div>
    </div>
  );
}
