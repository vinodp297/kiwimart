"use client";
// src/components/RecordView.tsx
// ─── Records a listing view to localStorage on mount ─────────────────────────

import { useEffect } from "react";
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
  useEffect(() => {
    recordView({ id, title, price, thumbnailUrl, condition });
  }, [id, title, price, thumbnailUrl, condition]);

  return null; // Render nothing — side-effect only
}
