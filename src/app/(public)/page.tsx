import type { Metadata } from "next";

import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import RecentlyViewed from "@/components/RecentlyViewed";

import { fetchHomeData } from "./_lib/home-data";
import HomeHero from "./_components/HomeHero";
import HomeCategories from "./_components/HomeCategories";
import HomeFeaturedListings from "./_components/HomeFeaturedListings";
import { RecentlySoldSection } from "@/components/listings/RecentlySoldSection";

export const metadata: Metadata = {
  title: "New Zealand's Trusted Marketplace",
  description: `Buy and sell with confidence on ${process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"}. Secure escrow payments, ${process.env.NEXT_PUBLIC_BUYER_PROTECTION_DISPLAY ?? "$3,000"} buyer protection, and verified NZ sellers. Browse 120,000+ listings across Aotearoa.`,
  keywords: [
    "marketplace",
    "buy",
    "sell",
    "New Zealand",
    "NZ",
    "Trade Me alternative",
    "second hand",
  ],
  openGraph: {
    title: `${process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"} — New Zealand's Trusted Marketplace`,
    description: `Buy and sell with confidence. Secure escrow, ${process.env.NEXT_PUBLIC_BUYER_PROTECTION_DISPLAY ?? "$3,000"} buyer protection.`,
    url: process.env.NEXT_PUBLIC_APP_URL ?? "https://buyzi.co.nz",
    siteName: process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi",
    locale: "en_NZ",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"} — New Zealand's Trusted Marketplace`,
  },
  alternates: {
    canonical: process.env.NEXT_PUBLIC_APP_URL ?? "https://buyzi.co.nz",
  },
};

// Revalidate homepage every hour
export const revalidate = 3600;

export default async function HomePage() {
  const { stats, visibleCategories, featured } = await fetchHomeData();

  return (
    <>
      <NavBar />
      <main>
        <HomeHero stats={stats} />
        <HomeCategories categories={visibleCategories} />
        <HomeFeaturedListings featured={featured} />
        {/* Recently sold — server component, returns null when empty */}
        <RecentlySoldSection />
        {/* Recently viewed — DB for authed users, localStorage for guests */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <RecentlyViewed maxItems={8} title="Pick up where you left off" />
        </div>
      </main>
      <Footer />
    </>
  );
}
