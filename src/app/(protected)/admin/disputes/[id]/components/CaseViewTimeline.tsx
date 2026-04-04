"use client";
// src/app/(protected)/admin/disputes/[id]/components/CaseViewTimeline.tsx
// ─── Section A: Order Timeline ────────────────────────────────────────────────

import OrderTimeline from "@/components/OrderTimeline";
import type { TimelineEvent } from "./case-view-types";

interface Props {
  timeline: TimelineEvent[];
  currentStatus: string;
}

export default function CaseViewTimeline({ timeline, currentStatus }: Props) {
  return <OrderTimeline events={timeline} currentStatus={currentStatus} />;
}
