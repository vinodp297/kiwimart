// src/app/api/lists/[listType]/route.ts
// ─── Public API — Dynamic List Reader ──────────────────────────────────────
// Client components fetch lists via this route instead of importing the
// server-only dynamic list service directly.

import { NextResponse } from "next/server";
import type { DynamicListType } from "@prisma/client";
import { getList } from "@/lib/dynamic-lists";

const VALID_TYPES = new Set<string>([
  "BANNED_KEYWORDS",
  "RISK_KEYWORDS",
  "NZ_REGIONS",
  "COURIERS",
  "DISPUTE_REASONS",
  "LISTING_CONDITIONS",
  "REVIEW_TAGS",
  "REPORT_REASONS",
  "SELLER_RESCHEDULE_REASONS",
  "BUYER_RESCHEDULE_REASONS",
  "PICKUP_REJECT_REASONS",
  "DELIVERY_ISSUE_TYPES",
  "PROBLEM_TYPES",
  "QUICK_FILTER_CHIPS",
]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ listType: string }> },
) {
  const { listType } = await params;

  if (!VALID_TYPES.has(listType)) {
    return NextResponse.json({ error: "Invalid list type" }, { status: 400 });
  }

  const items = await getList(listType as DynamicListType);
  return NextResponse.json(items);
}
