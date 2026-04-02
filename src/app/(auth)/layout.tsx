// src/app/(auth)/layout.tsx
// ─── Auth Route Group Layout ──────────────────────────────────────────────────
// Applies to: /login, /register, /forgot-password, /reset-password
//
// Redirects already-authenticated users to their dashboard so they never see
// the login/register forms when already signed in.
// This layout intentionally has NO NavBar / Footer for a focused auth experience.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export const metadata: Metadata = {
  title: {
    template: `%s | ${process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"}`,
    default: "Sign In",
  },
  // Auth pages must not be indexed by search engines
  robots: { index: false, follow: false },
};

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (session?.user?.id) {
    // Already signed in — send to the appropriate dashboard
    const sellerEnabled = (session.user as { sellerEnabled?: boolean })
      .sellerEnabled;
    redirect(sellerEnabled ? "/dashboard/seller" : "/dashboard/buyer");
  }

  return <>{children}</>;
}
