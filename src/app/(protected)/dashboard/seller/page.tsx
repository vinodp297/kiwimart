"use client";
// src/app/(protected)/dashboard/seller/page.tsx
// ─── Seller Dashboard ─────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/primitives";
import { fetchSellerDashboard } from "@/server/actions/dashboard";
import type {
  DashboardUser,
  SellerStatsRow,
  SellerListingRow as SellerListingRowType,
  SellerOrderRow,
  SellerPayoutRow,
} from "@/server/actions/dashboard";
import { getStripeAccountStatus } from "@/server/actions/stripe";
import { ImageCropModal } from "@/components/ui/ImageCropModal";
import type { CropMode } from "@/components/ui/ImageCropModal";
import {
  requestProfileImageUpload,
  confirmProfileImageUpload,
} from "@/server/actions/profile-images";

import SellerDashboardHeader from "./components/SellerDashboardHeader";
import SellerDashboardStats from "./components/SellerDashboardStats";
import SellerDashboardEarnings from "./components/SellerDashboardEarnings";
import SellerDashboardListings from "./components/SellerDashboardListings";
import SellerDashboardOrders from "./components/SellerDashboardOrders";
import SellerDashboardPayouts from "./components/SellerDashboardPayouts";
import SellerDashboardReviews from "./components/SellerDashboardReviews";
import SellerDashboardQuickActions from "./components/SellerDashboardQuickActions";

type Tab = "overview" | "listings" | "orders" | "payouts" | "reviews";

// ─────────────────────────────────────────────────────────────────────────────
export default function SellerDashboardPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTab = (searchParams.get("tab") as Tab) || "overview";
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [user, setUser] = useState<DashboardUser | null>(null);
  const [stats, setStats] = useState<SellerStatsRow | null>(null);
  const [listings, setListings] = useState<SellerListingRowType[]>([]);
  const [orders, setOrders] = useState<SellerOrderRow[]>([]);
  const [payouts, setPayouts] = useState<SellerPayoutRow[]>([]);

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [stripeOnboarded, setStripeOnboarded] = useState<boolean | null>(null);

  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropMode, setCropMode] = useState<CropMode>("avatar");
  const [imgUploading, setImgUploading] = useState(false);

  // Sync tab from URL
  useEffect(() => {
    const tab = searchParams.get("tab") as Tab | null;
    if (
      tab &&
      ["overview", "listings", "orders", "payouts", "reviews"].includes(tab)
    ) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const handleTabChange = useCallback(
    (tab: Tab) => {
      setActiveTab(tab);
      router.replace(`/dashboard/seller?tab=${tab}`, { scroll: false });
    },
    [router],
  );

  // Fetch real data on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [result, stripeResult] = await Promise.all([
          fetchSellerDashboard(),
          getStripeAccountStatus(),
        ]);
        if (cancelled) return;
        if (result.success) {
          setUser(result.data.user);
          setStats(result.data.stats);
          setListings(result.data.listings);
          setOrders(result.data.orders);
          setPayouts(result.data.payouts);
        } else {
          setError(result.error);
        }
        if (stripeResult.success) {
          setStripeOnboarded(stripeResult.data.onboarded);
        }
      } catch {
        if (!cancelled)
          setError(
            "We couldn't load your seller dashboard. Please refresh the page.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Profile image upload ───────────────────────────────────────────────────
  function openImagePicker(mode: CropMode) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) {
        setCropMode(mode);
        setCropFile(file);
      }
    };
    input.click();
  }

  async function handleCropAccept(blob: Blob) {
    setCropFile(null);
    setImgUploading(true);
    try {
      const uploadResult = await requestProfileImageUpload({
        contentType: "image/jpeg",
        sizeBytes: blob.size,
        imageType: cropMode,
      });
      if (!uploadResult.success) {
        alert(uploadResult.error);
        return;
      }
      const putRes = await fetch(uploadResult.data.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: blob,
      });
      if (!putRes.ok) {
        alert(
          "Your photo couldn't be uploaded. Please try a different image or try again later.",
        );
        return;
      }
      const confirmResult = await confirmProfileImageUpload({
        r2Key: uploadResult.data.r2Key,
        imageType: cropMode,
      });
      if (!confirmResult.success) {
        alert(confirmResult.error);
        return;
      }
      if (cropMode === "avatar") {
        setUser((prev) =>
          prev ? { ...prev, avatarKey: confirmResult.data.newKey } : null,
        );
      }
    } catch {
      alert("An unexpected error occurred.");
    } finally {
      setImgUploading(false);
    }
  }

  async function handleDeleteListing(id: string) {
    setActionLoading(id);
    // Sprint 5: await deleteListing(id) — server action with ownership check
    await new Promise((r) => setTimeout(r, 600));
    setListings((prev) => prev.filter((l) => l.id !== id));
    setDeleteConfirm(null);
    setActionLoading(null);
  }

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <>
        <NavBar />
        <main className="bg-[#FAFAF8] min-h-screen">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
            <div className="animate-pulse space-y-4">
              <div className="bg-[#141414] rounded-2xl h-48" />
              <div className="bg-white rounded-2xl border border-[#E3E0D9] p-4 h-12" />
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="bg-white rounded-2xl border border-[#E3E0D9] h-32"
                  />
                ))}
              </div>
            </div>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  if (error || !user || !stats) {
    return (
      <>
        <NavBar />
        <main className="bg-[#FAFAF8] min-h-screen flex items-center justify-center">
          <div className="text-center">
            <p className="text-[14px] text-[#9E9A91]">
              {error || "Please sign in to view your seller dashboard."}
            </p>
            <Link href="/login" className="mt-3 inline-block">
              <Button variant="primary" size="sm">
                Sign in
              </Button>
            </Link>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  // Locked state — seller terms not accepted
  if (!user.sellerTermsAcceptedAt) {
    return (
      <>
        <NavBar />
        <main className="bg-[#FAFAF8] min-h-screen flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3E0D9] rounded-2xl p-8 max-w-md w-full text-center">
            <div className="w-16 h-16 bg-[#F2EFE8] rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">🔒</span>
            </div>
            <h1 className="font-[family-name:var(--font-playfair)] text-[1.25rem] font-semibold text-[#141414] mb-2">
              Accept seller terms first
            </h1>
            <p className="text-[#73706A] text-[14px] leading-relaxed mb-6">
              To access your seller dashboard and start listing items, please
              read and accept {process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"}
              &apos;s seller terms and conditions.
            </p>
            <Link
              href="/seller/onboarding"
              className="inline-block w-full bg-[#D4A843] text-[#141414] py-3 rounded-xl font-semibold text-[14px] hover:bg-[#C49B35] transition-colors"
            >
              Go to Seller Hub →
            </Link>
            <p className="text-[11px] text-[#C9C5BC] mt-4">
              This takes less than 2 minutes.
            </p>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  const pendingOrders = orders.filter(
    (o) => o.status === "payment_held" || o.status === "dispatched",
  );

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "listings", label: "My Listings", badge: listings.length },
    { id: "orders", label: "Orders", badge: pendingOrders.length || undefined },
    { id: "payouts", label: "Payouts" },
    { id: "reviews", label: "Reviews", badge: stats.reviewCount || undefined },
  ];

  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
          {/* ── Stripe setup card (shown until onboarded) ──────────────── */}
          {stripeOnboarded === false && (
            <div className="bg-[#141414] text-white rounded-2xl p-6 mb-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="flex-1 min-w-0">
                <h3 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold mb-1">
                  ⚡ Complete your seller setup
                </h3>
                <p className="text-white/60 text-[13.5px]">
                  Connect your bank account to receive payments from buyers.
                </p>
              </div>
              <a
                href="/account/stripe"
                className="shrink-0 px-5 py-2.5 bg-[#D4A843] text-[#141414]
                  font-semibold text-[13.5px] rounded-full hover:bg-[#F5C84A]
                  transition-colors whitespace-nowrap"
              >
                Connect Stripe →
              </a>
            </div>
          )}

          {/* ── Phone verification banner ─────────────────────────────── */}
          {!user.phoneVerified && !user.idVerified && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 mb-6">
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-semibold text-amber-900">
                  📱 Verify your phone number
                </p>
                <p className="text-[12.5px] text-amber-700 mt-0.5">
                  Unlock 50 listings and 3-day payouts by verifying your phone.
                </p>
              </div>
              <Link
                href="/seller/onboarding"
                className="shrink-0 px-4 py-2 bg-amber-400 text-amber-900
                  font-semibold text-[12.5px] rounded-full hover:bg-amber-500
                  transition-colors whitespace-nowrap"
              >
                Verify now →
              </Link>
            </div>
          )}

          {/* ── Seller header ─────────────────────────────────────────── */}
          <SellerDashboardHeader
            user={user}
            stats={stats}
            imgUploading={imgUploading}
            onChangePhoto={() => openImagePicker("avatar")}
            onViewPayouts={() => handleTabChange("payouts")}
          />

          {/* ── Tab bar ─────────────────────────────────────────────────── */}
          <div
            className="flex border-b-0 mb-6 bg-white rounded-2xl overflow-hidden border border-[#E3E0D9]"
            role="tablist"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-2 px-5 py-3.5 text-[13px] font-semibold
                  border-b-2 transition-all duration-150 whitespace-nowrap
                  ${
                    activeTab === tab.id
                      ? "border-[#141414] text-[#141414]"
                      : "border-transparent text-[#9E9A91] hover:text-[#141414]"
                  }`}
              >
                {tab.label}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span
                    className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center
                      ${activeTab === tab.id ? "bg-[#141414] text-white" : "bg-[#EFEDE8] text-[#73706A]"}`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Overview tab ───────────────────────────────────────────── */}
          {activeTab === "overview" && (
            <div className="space-y-6" role="tabpanel" aria-label="Overview">
              <SellerDashboardStats stats={stats} />
              <SellerDashboardQuickActions stripeOnboarded={stripeOnboarded} />
              <SellerDashboardEarnings
                orders={orders}
                completedSales={stats.recentSales}
                avgRating={stats.avgRating}
              />
            </div>
          )}

          {/* ── Listings tab ───────────────────────────────────────────── */}
          {activeTab === "listings" && (
            <SellerDashboardListings
              listings={listings}
              deleteConfirm={deleteConfirm}
              actionLoading={actionLoading}
              onDeleteRequest={(id) => setDeleteConfirm(id)}
              onDeleteCancel={() => setDeleteConfirm(null)}
              onDeleteConfirm={handleDeleteListing}
            />
          )}

          {/* ── Orders tab ─────────────────────────────────────────────── */}
          {activeTab === "orders" && (
            <SellerDashboardOrders
              orders={orders}
              pendingOrders={pendingOrders}
            />
          )}

          {/* ── Payouts tab ────────────────────────────────────────────── */}
          {activeTab === "payouts" && (
            <SellerDashboardPayouts payouts={payouts} stats={stats} />
          )}

          {/* ── Reviews tab ────────────────────────────────────────────── */}
          {activeTab === "reviews" && (
            <div role="tabpanel" aria-label="Reviews" className="space-y-3">
              <SellerDashboardReviews sellerId={user.id} />
            </div>
          )}
        </div>
      </main>
      <Footer />

      {/* Image crop modal */}
      {cropFile && (
        <ImageCropModal
          file={cropFile}
          mode={cropMode}
          onAccept={handleCropAccept}
          onClose={() => setCropFile(null)}
        />
      )}
    </>
  );
}
