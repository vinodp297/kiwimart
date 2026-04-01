"use client";
// src/components/RecordView.tsx
// ─── Records a listing view to localStorage (guest fallback) ─────────────────
// For authenticated users, recording is done server-side in the page component.
// This client component handles the localStorage fallback for unauthenticated users.

import { useEffect } from "react";
import { useSessionSafe } from "@/hooks/useSessionSafe";
import { recordView } from "@/lib/recently-viewed";

interface Props {
  id: string;
  title: string;
  price: number;
  thumbnailUrl: string;
  condition: string;
}

export default function RecordView({
  id,
  title,
  price,
  thumbnailUrl,
  condition,
}: Props) {
  const { status } = useSessionSafe();

  useEffect(() => {
    // Only use localStorage for unauthenticated users
    // Authenticated users are tracked server-side via DB
    if (status === "unauthenticated") {
      recordView({ id, title, price, thumbnailUrl, condition });
    }
  }, [id, title, price, thumbnailUrl, condition, status]);

  return null; // Render nothing — side-effect only
}
