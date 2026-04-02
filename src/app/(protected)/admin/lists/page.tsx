// src/app/(protected)/admin/lists/page.tsx
// ─── Admin Dynamic Lists — Server Component ────────────────────────────────

import { requirePermission } from "@/shared/auth/requirePermission";
import { getListItems, getListTypeCounts } from "@/server/actions/admin-lists";
import type { DynamicListType } from "@prisma/client";
import ListsClient from "./ListsClient";

const DEFAULT_TYPE: DynamicListType = "BANNED_KEYWORDS";

export default async function AdminListsPage() {
  await requirePermission("VIEW_DYNAMIC_LISTS");

  const [itemsResult, countsResult] = await Promise.all([
    getListItems(DEFAULT_TYPE),
    getListTypeCounts(),
  ]);

  return (
    <ListsClient
      initialItems={itemsResult.success ? itemsResult.data : []}
      initialCounts={countsResult.success ? countsResult.data : {}}
      initialType={DEFAULT_TYPE}
    />
  );
}
