// src/app/(protected)/admin/config/page.tsx
// ─── Admin Platform Settings ────────────────────────────────────────────────

import { requirePermission } from "@/shared/auth/requirePermission";
import { getAllConfigs } from "@/server/actions/admin-config";
import ConfigClient from "./ConfigClient";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Settings — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminConfigPage() {
  await requirePermission("VIEW_PLATFORM_CONFIG");
  const result = await getAllConfigs();

  if (!result.success) {
    return (
      <div className="bg-[#FAFAF8] min-h-screen p-8">
        <p className="text-red-600">Failed to load settings: {result.error}</p>
      </div>
    );
  }

  return <ConfigClient configs={result.data!} />;
}
