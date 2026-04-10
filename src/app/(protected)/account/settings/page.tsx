// src/app/(protected)/account/settings/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
// eslint-disable-next-line no-restricted-imports -- pre-existing page-level DB access, migrate to repository in a dedicated sprint
import db from "@/lib/db";
import { getListValues } from "@/lib/dynamic-lists";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import SettingsForm from "./SettingsForm";
import ProfileCompletion from "@/components/onboarding/ProfileCompletion";
import { UnblockButton } from "@/components/seller/UnblockButton";

export default async function AccountSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?from=/account/settings");
  }

  const [user, blockedUsers] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      select: {
        displayName: true,
        username: true,
        email: true,
        emailVerified: true,
        region: true,
        bio: true,
        hasMarketingConsent: true,
      },
    }),
    db.blockedUser.findMany({
      where: { blockerId: session.user.id },
      include: {
        blocked: { select: { id: true, displayName: true, username: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  if (!user) redirect("/login");

  const regions = await getListValues("NZ_REGIONS");

  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <div className="max-w-6xl mx-auto px-4 py-12">
          <h1
            className="font-[family-name:var(--font-playfair)] text-[2rem]
              font-semibold text-[#141414] mb-2"
          >
            Account settings
          </h1>
          <p className="text-[14px] text-[#73706A] mb-8">
            Manage your profile, notifications and account preferences.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-8">
            {/* ── Sidebar navigation (desktop only) ──────────────────── */}
            <nav className="hidden lg:block" aria-label="Settings sections">
              <ul className="space-y-1 sticky top-24">
                {[
                  { label: "Profile", href: "#profile" },
                  { label: "Security", href: "#security" },
                  { label: "Notifications", href: "#notifications" },
                  { label: "Privacy", href: "#privacy" },
                ].map(({ label, href }) => (
                  <li key={href}>
                    <a
                      href={href}
                      className="block px-3 py-2 rounded-xl text-[13px] font-medium
                        text-[#73706A] hover:text-[#141414] hover:bg-white
                        transition-colors"
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            {/* ── Main content ────────────────────────────────────────── */}
            <div>
              <div className="mb-6">
                <ProfileCompletion
                  displayName={user.displayName}
                  emailVerified={user.emailVerified}
                  region={user.region}
                  bio={user.bio}
                />
              </div>
              <SettingsForm user={user} regions={regions} />

              {blockedUsers.length > 0 && (
                <div className="mt-6 bg-white rounded-2xl border border-[#E3E0D9] p-6">
                  <h3 className="font-semibold text-[14px] text-[#141414] mb-3">
                    Blocked Users ({blockedUsers.length})
                  </h3>
                  <div className="space-y-2">
                    {blockedUsers.map((b) => (
                      <div
                        key={b.id}
                        className="flex items-center justify-between py-2 px-3 bg-[#FAFAF8] rounded-xl"
                      >
                        <span className="text-[13px] text-[#141414]">
                          {b.blocked.displayName}
                        </span>
                        <UnblockButton targetUserId={b.blocked.id} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
