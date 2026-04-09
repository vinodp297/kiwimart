// src/app/(protected)/admin/team/page.tsx
// ─── Admin Team Management (SUPER_ADMIN only) ─────────────────────────────────

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { adminService } from "@/modules/admin/admin.service";
import TeamActions from "./TeamActions";
import type { Metadata } from "next";
import type { AdminRole } from "@prisma/client";

export const metadata: Metadata = { title: "Team Management — Admin" };
export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?from=/admin/team");

  const currentUser = await adminService.getUserAdminInfo(session.user.id);

  if (!currentUser?.isAdmin || currentUser.adminRole !== "SUPER_ADMIN") {
    redirect("/admin");
  }

  const members = await adminService.getTeamMembers();

  return (
    <div className="bg-[#FAFAF8] min-h-screen">
      {/* Header band */}
      <div className="bg-[#141414] text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex items-center gap-2 text-[12px] text-white/40 mb-2">
            <a href="/admin" className="hover:text-white transition-colors">
              Admin
            </a>
            <span>/</span>
            <span className="text-white">Team</span>
          </div>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-[#D4A843] text-xl">👤</span>
            <h1 className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold">
              Team Management
            </h1>
          </div>
          <p className="text-white/50 text-[13.5px]">
            Manage admin roles and send invitations
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <TeamActions
          members={members.map((m) => ({
            ...m,
            adminRole: m.adminRole as AdminRole,
          }))}
          currentUserId={session.user.id}
        />
      </div>
    </div>
  );
}
