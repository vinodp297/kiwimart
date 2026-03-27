'use client';
// src/app/(protected)/orders/[id]/page.tsx
// ─── Order Detail Page ──────────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';
import { Button, OrderStatusBadge, Alert } from '@/components/ui/primitives';
import { formatPrice, relativeTime } from '@/lib/utils';
import type { OrderStatus } from '@/types';
import { confirmDelivery, markDispatched } from '@/server/actions/orders';
import { openDispute } from '@/server/actions/disputes';
import { fetchOrderDetail } from '@/server/actions/orderDetail';

// ── Courier URL detection ────────────────────────────────────────────────────
function getCourierUrl(trackingNumber: string): string {
  const tn = trackingNumber.toUpperCase().trim();

  // NZ Post international format (2 letters + 9 digits + 2 letters) or NZ prefix
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(tn) || tn.startsWith('NZ')) {
    return `https://www.nzpost.co.nz/tools/tracking?trackid=${encodeURIComponent(tn)}`;
  }
  // CourierPost
  if (tn.startsWith('CP') || tn.startsWith('CPA')) {
    return `https://www.courierpost.co.nz/track/?trackingid=${encodeURIComponent(tn)}`;
  }
  // Aramex (long numeric)
  if (/^\d{10,}$/.test(tn)) {
    return `https://www.aramex.co.nz/tools/track?l=${encodeURIComponent(tn)}`;
  }
  // DHL
  if (tn.startsWith('DHL') || /^\d{10}$/.test(tn)) {
    return `https://www.dhl.com/nz-en/home/tracking/tracking-parcel.html?submit=1&tracking-id=${encodeURIComponent(tn)}`;
  }
  // Default — NZ Post (most common NZ courier)
  return `https://www.nzpost.co.nz/tools/tracking?trackid=${encodeURIComponent(tn)}`;
}

export default function OrderDetailPage() {
  const params = useParams();
  const orderId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderDetailData | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Dispatch modal
  const [showDispatch, setShowDispatch] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');

  // Confirm delivery modal
  const [showConfirm, setShowConfirm] = useState(false);

  // Dispute modal
  const [showDispute, setShowDispute] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeDescription, setDisputeDescription] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const result = await fetchOrderDetail(orderId);
        if (result.success) {
          setOrder(result.data);
        } else {
          setError(result.error);
        }
      } catch {
        setError('Failed to load order details.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [orderId]);

  async function handleDispatch() {
    setActionLoading(true);
    const result = await markDispatched({
      orderId,
      trackingNumber: trackingNumber || undefined,
      trackingUrl: trackingUrl || undefined,
    });
    if (result.success) {
      setActionSuccess('Order marked as dispatched.');
      setShowDispatch(false);
      // Reload order
      const updated = await fetchOrderDetail(orderId);
      if (updated.success) setOrder(updated.data);
    } else {
      setError(result.error);
    }
    setActionLoading(false);
  }

  async function handleConfirmDelivery() {
    setActionLoading(true);
    const result = await confirmDelivery(orderId);
    if (result.success) {
      setActionSuccess('Delivery confirmed. Payment released to seller.');
      setShowConfirm(false);
      const updated = await fetchOrderDetail(orderId);
      if (updated.success) setOrder(updated.data);
    } else {
      setError(result.error);
    }
    setActionLoading(false);
  }

  async function handleOpenDispute() {
    if (!disputeReason || disputeDescription.length < 20) {
      setError('Please select a reason and describe the issue (at least 20 characters).');
      return;
    }
    setError(null);
    setActionLoading(true);
    const result = await openDispute({
      orderId,
      reason: disputeReason,
      description: disputeDescription,
    });
    if (result.success) {
      setError(null);
      setActionSuccess('Dispute opened. We will review your case within 48 hours.');
      setShowDispute(false);
      const updated = await fetchOrderDetail(orderId);
      if (updated.success) setOrder(updated.data);
    } else {
      setError(result.error);
    }
    setActionLoading(false);
  }

  if (loading) {
    return (
      <>
        <NavBar />
        <main className="bg-[#FAFAF8] min-h-screen">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
            <div className="animate-pulse space-y-4">
              <div className="bg-white rounded-2xl border border-[#E3E0D9] h-48" />
              <div className="bg-white rounded-2xl border border-[#E3E0D9] h-64" />
            </div>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  if (error && !order) {
    return (
      <>
        <NavBar />
        <main className="bg-[#FAFAF8] min-h-screen flex items-center justify-center">
          <div className="text-center">
            <p className="text-[14px] text-[#9E9A91]">{error}</p>
            <Link href="/dashboard/buyer" className="mt-3 inline-block">
              <Button variant="secondary" size="sm">Back to dashboard</Button>
            </Link>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  if (!order) return null;

  const statusSteps: { label: string; done: boolean; active: boolean }[] = [
    { label: 'Order placed', done: true, active: false },
    {
      label: 'Payment received',
      done: ['payment_held', 'dispatched', 'delivered', 'completed'].includes(order.status),
      active: order.status === 'payment_held',
    },
    {
      label: 'Dispatched',
      done: ['dispatched', 'delivered', 'completed'].includes(order.status),
      active: order.status === 'dispatched',
    },
    {
      label: 'Delivered',
      done: ['delivered', 'completed'].includes(order.status),
      active: order.status === 'delivered',
    },
    {
      label: 'Completed',
      done: order.status === 'completed',
      active: order.status === 'completed',
    },
  ];

  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-[12.5px] text-[#9E9A91] mb-6">
            <Link href={order.isBuyer ? '/dashboard/buyer' : '/dashboard/seller'} className="hover:text-[#D4A843] transition-colors">
              Dashboard
            </Link>
            <span>/</span>
            <span className="text-[#141414] font-medium">Order {order.id.slice(0, 8)}…</span>
          </nav>

          {actionSuccess && (
            <Alert variant="success" className="mb-4">{actionSuccess}</Alert>
          )}
          {error && (
            <Alert variant="error" className="mb-4">{error}</Alert>
          )}

          {/* Order header */}
          <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6 mb-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <Link href={`/listings/${order.listingId}`} className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={order.listingThumbnail}
                  alt={order.listingTitle}
                  className="w-20 h-20 rounded-xl object-cover border border-[#E3E0D9]"
                />
              </Link>
              <div className="flex-1">
                <Link
                  href={`/listings/${order.listingId}`}
                  className="font-[family-name:var(--font-playfair)] text-[1.25rem] font-semibold text-[#141414] hover:text-[#D4A843] transition-colors"
                >
                  {order.listingTitle}
                </Link>
                <div className="flex flex-wrap items-center gap-3 mt-2">
                  <OrderStatusBadge status={order.status as OrderStatus} />
                  <span className="text-[12px] text-[#9E9A91]">
                    {new Date(order.createdAt).toLocaleDateString('en-NZ', {
                      day: 'numeric', month: 'long', year: 'numeric',
                    })}
                  </span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="font-[family-name:var(--font-playfair)] text-[1.5rem] font-bold text-[#141414]">
                  {formatPrice(order.total)}
                </p>
                <p className="text-[11px] text-[#9E9A91]">NZD</p>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6 mb-6">
            <h2 className="text-[13.5px] font-semibold text-[#141414] mb-5">
              Order timeline
            </h2>
            {order.status === 'disputed' ? (
              <Alert variant="error">
                This order is under dispute. Our team will review and respond within 48 hours.
                {order.disputeReason && (
                  <span className="block mt-1 text-[12px]">
                    Reason: {order.disputeReason.replace(/_/g, ' ').toLowerCase()}
                  </span>
                )}
              </Alert>
            ) : (
              <div className="flex items-center justify-between relative">
                {/* Line */}
                <div className="absolute top-3 left-3 right-3 h-0.5 bg-[#E3E0D9]" />
                <div
                  className="absolute top-3 left-3 h-0.5 bg-[#D4A843] transition-all duration-500"
                  style={{
                    width: `${(statusSteps.filter((s) => s.done).length - 1) / (statusSteps.length - 1) * 100}%`,
                  }}
                />

                {statusSteps.map((step, i) => (
                  <div key={step.label} className="relative flex flex-col items-center z-10" style={{ flex: 1 }}>
                    <div
                      className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all
                        ${step.done
                          ? 'bg-[#D4A843] border-[#D4A843]'
                          : step.active
                          ? 'bg-white border-[#D4A843]'
                          : 'bg-[#F8F7F4] border-[#E3E0D9]'
                        }`}
                    >
                      {step.done && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                    <span className={`text-[10.5px] mt-2 text-center whitespace-nowrap
                      ${step.done || step.active ? 'text-[#141414] font-medium' : 'text-[#9E9A91]'}`}
                    >
                      {step.label}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Price breakdown + details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
            <div className="bg-white rounded-2xl border border-[#E3E0D9] p-5">
              <h3 className="text-[13px] font-semibold text-[#141414] mb-3">Price breakdown</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-[13px]">
                  <span className="text-[#73706A]">Item</span>
                  <span className="text-[#141414]">{formatPrice(order.itemPrice)}</span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-[#73706A]">Shipping</span>
                  <span className="text-[#141414]">{order.shippingPrice === 0 ? 'Free' : formatPrice(order.shippingPrice)}</span>
                </div>
                <div className="flex justify-between text-[14px] font-semibold pt-2 border-t border-[#F0EDE8]">
                  <span className="text-[#141414]">Total</span>
                  <span className="text-[#141414]">{formatPrice(order.total)}</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-[#E3E0D9] p-5">
              <h3 className="text-[13px] font-semibold text-[#141414] mb-3">
                {order.isBuyer ? 'Seller' : 'Buyer'}
              </h3>
              <p className="text-[13px] text-[#141414] font-medium">{order.otherPartyName}</p>
              <Link
                href={order.isBuyer ? `/sellers/${order.otherPartyUsername}` : '#'}
                className="text-[12px] text-[#D4A843] hover:text-[#B8912E] transition-colors"
              >
                @{order.otherPartyUsername}
              </Link>
              {order.trackingNumber && (
                <div className="mt-3 pt-3 border-t border-[#F0EDE8]">
                  <p className="text-[11.5px] font-semibold text-[#141414] mb-1">Tracking</p>
                  <a
                    href={order.trackingUrl || getCourierUrl(order.trackingNumber)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12px] text-[#D4A843] font-mono hover:underline inline-flex items-center gap-1"
                  >
                    {order.trackingNumber}
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3">
            {/* Seller: mark dispatched */}
            {!order.isBuyer && order.status === 'payment_held' && (
              <Button variant="gold" size="md" onClick={() => setShowDispatch(true)}>
                Mark as dispatched
              </Button>
            )}

            {/* Buyer: confirm delivery */}
            {order.isBuyer && (order.status === 'dispatched' || order.status === 'delivered') && (
              <Button variant="gold" size="md" onClick={() => setShowConfirm(true)}>
                Confirm delivery
              </Button>
            )}

            {/* Buyer: open dispute */}
            {order.isBuyer && (order.status === 'dispatched' || order.status === 'delivered') && !order.disputeReason && (
              <Button variant="ghost" size="md" onClick={() => setShowDispute(true)}>
                Open a dispute
              </Button>
            )}

            {/* Buyer: leave review */}
            {order.isBuyer && order.status === 'completed' && !order.hasReview && (
              <Link href={`/reviews/new?orderId=${order.id}`}>
                <Button variant="secondary" size="md">Leave a review</Button>
              </Link>
            )}

            {/* Message */}
            <Link href={`/messages/new?listingId=${order.listingId}&sellerId=${order.isBuyer ? order.sellerId : order.buyerId}`}>
              <Button variant="secondary" size="md">
                Message {order.isBuyer ? 'seller' : 'buyer'}
              </Button>
            </Link>
          </div>
        </div>
      </main>
      <Footer />

      {/* ── Dispatch Modal ──────────────────────────────────────────── */}
      {showDispatch && (
        <ModalOverlay onClose={() => setShowDispatch(false)}>
          <h2 className="font-[family-name:var(--font-playfair)] text-[1.15rem] font-semibold text-[#141414] mb-4">
            Mark as dispatched
          </h2>
          <div className="space-y-4">
            <div>
              <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                Courier / tracking number <span className="text-[#9E9A91] font-normal">(optional)</span>
              </label>
              <input
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder="e.g. NZP123456789"
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px]
                  text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2
                  focus:ring-[#D4A843]/25 focus:border-[#D4A843] transition"
              />
            </div>
            <div>
              <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                Tracking URL <span className="text-[#9E9A91] font-normal">(optional)</span>
              </label>
              <input
                value={trackingUrl}
                onChange={(e) => setTrackingUrl(e.target.value)}
                placeholder="e.g. https://nzpost.co.nz/track/..."
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px]
                  text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2
                  focus:ring-[#D4A843]/25 focus:border-[#D4A843] transition"
              />
            </div>
            <Button variant="gold" fullWidth size="md" onClick={handleDispatch} loading={actionLoading}>
              Confirm dispatch
            </Button>
          </div>
        </ModalOverlay>
      )}

      {/* ── Confirm Delivery Modal ──────────────────────────────────── */}
      {showConfirm && (
        <ModalOverlay onClose={() => setShowConfirm(false)}>
          <div className="text-center">
            <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h2 className="font-[family-name:var(--font-playfair)] text-[1.15rem] font-semibold text-[#141414] mb-2">
              Confirm delivery
            </h2>
            <p className="text-[13px] text-[#73706A] mb-6">
              Confirming delivery releases payment to the seller.
              Only confirm if you have received the item and are satisfied.
            </p>
            <div className="flex gap-3 justify-center">
              <Button variant="gold" size="md" onClick={handleConfirmDelivery} loading={actionLoading}>
                Yes, I received it
              </Button>
              <Button variant="ghost" size="md" onClick={() => setShowConfirm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* ── Dispute Modal ───────────────────────────────────────────── */}
      {showDispute && (
        <ModalOverlay onClose={() => setShowDispute(false)}>
          <h2 className="font-[family-name:var(--font-playfair)] text-[1.15rem] font-semibold text-[#141414] mb-4">
            Open a dispute
          </h2>
          <div className="space-y-4">
            <div>
              <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">Reason</label>
              <select
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px]
                  text-[#141414] outline-none focus:ring-2 focus:ring-[#D4A843]/25
                  focus:border-[#D4A843] transition"
              >
                <option value="">Select a reason</option>
                <option value="ITEM_NOT_RECEIVED">Item not received</option>
                <option value="ITEM_NOT_AS_DESCRIBED">Item not as described</option>
                <option value="ITEM_DAMAGED">Item damaged</option>
                <option value="SELLER_UNRESPONSIVE">Seller unresponsive</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="text-[12.5px] font-semibold text-[#141414] mb-1 block">
                Describe the issue
              </label>
              <textarea
                value={disputeDescription}
                onChange={(e) => setDisputeDescription(e.target.value)}
                placeholder="Please describe what happened (min 20 characters)..."
                rows={4}
                maxLength={2000}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px]
                  text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2
                  focus:ring-[#D4A843]/25 focus:border-[#D4A843] resize-none transition"
              />
              <p className="text-[11px] text-[#9E9A91] mt-1">
                {disputeDescription.length}/2000 characters
              </p>
            </div>
            <Alert variant="info">
              Our team will review your dispute within 48 hours. The seller will be
              notified and given an opportunity to respond.
            </Alert>
            <Button variant="danger" fullWidth size="md" onClick={handleOpenDispute} loading={actionLoading}>
              Submit dispute
            </Button>
          </div>
        </ModalOverlay>
      )}
    </>
  );
}

// ── Shared types ────────────────────────────────────────────────────────────

interface OrderDetailData {
  id: string;
  listingId: string;
  listingTitle: string;
  listingThumbnail: string;
  status: string;
  itemPrice: number;
  shippingPrice: number;
  total: number;
  createdAt: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  disputeReason: string | null;
  isBuyer: boolean;
  buyerId: string;
  sellerId: string;
  otherPartyName: string;
  otherPartyUsername: string;
  hasReview: boolean;
}

// ── Modal wrapper ───────────────────────────────────────────────────────────

function ModalOverlay({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[500] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-[#F8F7F4] flex items-center
            justify-center hover:bg-[#EFEDE8] transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        {children}
      </div>
    </div>
  );
}
