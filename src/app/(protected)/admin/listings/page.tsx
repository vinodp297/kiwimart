// src/app/(protected)/admin/listings/page.tsx
// ─── Admin Listing Moderation Queue ──────────────────────────────────────────
// Server component — fetches pending/needs-changes listings for review.

import { requirePermission } from "@/shared/auth/requirePermission";
import { getPendingListings } from "@/server/actions/admin-listing-moderation";
import ListingQueueClient from "./ListingQueueClient";

export const dynamic = "force-dynamic";

export default async function AdminListingsPage() {
  await requirePermission("MODERATE_CONTENT");

  const data = await getPendingListings();

  return <ListingQueueClient data={data} />;
}
