// src/app/(protected)/welcome/page.tsx
// ─── Onboarding Welcome Page ──────────────────────────────────────────────────
// Server component: checks if user already completed onboarding.
// If yes, redirect straight to buyer dashboard.
// If no, render the client-side WelcomeWizard.

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import db from "@/lib/db";
import { getListValues } from "@/lib/dynamic-lists";
import WelcomeWizard from "@/components/onboarding/WelcomeWizard";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?from=/welcome");
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      isOnboardingCompleted: true,
      displayName: true,
    },
  });

  if (!user) {
    redirect("/login");
  }

  // Already completed onboarding — skip straight to dashboard
  if (user.isOnboardingCompleted) {
    redirect("/dashboard/buyer");
  }

  const regions = await getListValues("NZ_REGIONS");

  return <WelcomeWizard displayName={user.displayName} regions={regions} />;
}
