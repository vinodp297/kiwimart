// src/app/(protected)/orders/[id]/page.tsx
// ─── Order Detail — Server Component ─────────────────────────────────────────
// Fetches order data on the server, then hands off to the client orchestrator.
// No useState · No useEffect · No event handlers.

import { fetchOrderDetail } from "@/server/actions/orderDetail";
import { getOrderTimeline } from "@/server/actions/orderEvents";
import { getOrderInteractions } from "@/server/actions/interactions";
import { buildSyntheticEvents } from "./components/order-utils";
import OrderPageClient, { OrderErrorShell } from "./components/OrderPageClient";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function OrderDetailPage({ params }: Props) {
  const { id } = await params;

  // Fetch all three data sources in parallel
  const [orderResult, timelineResult, interactionsResult] = await Promise.all([
    fetchOrderDetail(id),
    getOrderTimeline(id),
    getOrderInteractions(id),
  ]);

  // If the order itself can't be loaded, show error shell
  if (!orderResult.success) {
    return (
      <OrderErrorShell
        message={
          orderResult.error ??
          "We couldn't load this order. Please check your connection and refresh the page."
        }
      />
    );
  }

  const order = orderResult.data;

  // Prefer real timeline events; fall back to synthetic ones built from order state
  const timelineEvents =
    timelineResult.success && timelineResult.data.length > 0
      ? timelineResult.data
      : buildSyntheticEvents(order);

  const interactions = interactionsResult.success
    ? interactionsResult.data
    : [];

  return (
    <OrderPageClient
      orderId={id}
      initialOrder={order}
      initialTimeline={timelineEvents}
      initialInteractions={interactions}
    />
  );
}
