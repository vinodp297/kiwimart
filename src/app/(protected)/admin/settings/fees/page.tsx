// src/app/(protected)/admin/settings/fees/page.tsx
// ─── Admin Fee Configuration Page ────────────────────────────────────────────

import { requirePermission } from "@/shared/auth/requirePermission";
import { getAllConfigs } from "@/server/actions/admin-config";
import { calculateFees } from "@/modules/payments/fee-calculator";
import { CONFIG_KEYS } from "@/lib/platform-config";
import FeeConfigClient from "./FeeConfigClient";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Fee Configuration — Admin" };
export const dynamic = "force-dynamic";

const FEE_KEYS = new Set<string>([
  CONFIG_KEYS.PLATFORM_FEE_STANDARD_RATE,
  CONFIG_KEYS.PLATFORM_FEE_SILVER_RATE,
  CONFIG_KEYS.PLATFORM_FEE_GOLD_RATE,
  CONFIG_KEYS.PLATFORM_FEE_MINIMUM_CENTS,
  CONFIG_KEYS.PLATFORM_FEE_MAXIMUM_CENTS,
  CONFIG_KEYS.STRIPE_FEE_RATE,
  CONFIG_KEYS.STRIPE_FEE_FIXED_CENTS,
]);

export default async function AdminFeesPage() {
  await requirePermission("MANAGE_PLATFORM_CONFIG");

  const [configResult, standard100, silver100, gold100] = await Promise.all([
    getAllConfigs(),
    calculateFees(10000, null),
    calculateFees(10000, "SILVER"),
    calculateFees(10000, "GOLD"),
  ]);

  if (!configResult.success) {
    return (
      <div className="bg-[#FAFAF8] min-h-screen p-8">
        <p className="text-red-600">
          Failed to load fee settings: {configResult.error}
        </p>
      </div>
    );
  }

  // Extract only the FINANCIAL fee configs
  const allFinancial = configResult.data!["FINANCIAL"] ?? [];
  const feeConfigs = allFinancial.filter((r) => FEE_KEYS.has(r.key));

  return (
    <FeeConfigClient
      configs={feeConfigs}
      previews={{ standard100, silver100, gold100 }}
    />
  );
}
