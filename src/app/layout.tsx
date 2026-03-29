// src/app/layout.tsx  (Sprint 3 update)
// ─── Root Layout ──────────────────────────────────────────────────────────────
// Changes from Sprint 1/2:
//   • SessionProvider wraps children for Auth.js useSession() support
//   • Security meta tags: referrer-policy, theme-color
//   • Canonical URL meta (Sprint 4: dynamic per-page)

import type { Metadata } from "next";
import { headers } from "next/headers";
import { Playfair_Display, DM_Sans } from "next/font/google";
import SessionProvider from "@/components/SessionProvider";
import PostHogProvider from "@/components/PostHogProvider";
import { BfcacheGuard } from "@/components/BfcacheGuard";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { auth } from "@/lib/auth";
import "./globals.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-playfair",
  weight: ["400", "500", "600", "700"],
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-dm-sans",
});

export const metadata: Metadata = {
  title: {
    template: "%s — KiwiMart",
    default: "KiwiMart — New Zealand's Trusted Marketplace",
  },
  description:
    "Buy and sell with confidence on KiwiMart. Secure escrow, $3,000 buyer protection, verified NZ sellers.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "https://kiwimart.co.nz",
  ),
  keywords: [
    "marketplace",
    "buy",
    "sell",
    "New Zealand",
    "NZ",
    "second hand",
    "Trade Me alternative",
  ],
  openGraph: {
    siteName: "KiwiMart",
    locale: "en_NZ",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  // Security headers also set in middleware.ts — belt-and-suspenders
  other: {
    referrer: "strict-origin-when-cross-origin",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, headersList] = await Promise.all([auth(), headers()]);
  const nonce = headersList.get("x-nonce") ?? "";

  return (
    <html
      lang="en-NZ"
      className={`${playfair.variable} ${dmSans.variable}`}
      data-scroll-behavior="smooth"
    >
      <head>
        <meta name="theme-color" content="#141414" />
        <meta name="color-scheme" content="light" />
      </head>
      <body
        className={`${dmSans.className} antialiased`}
        suppressHydrationWarning
      >
        <SessionProvider session={session}>
          <PostHogProvider nonce={nonce}>
            <BfcacheGuard />
            {children}
          </PostHogProvider>
        </SessionProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
