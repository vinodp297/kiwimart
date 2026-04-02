"use client";
// src/components/Toaster.tsx
// Sonner toast wrapper styled to match KiwiMart's design system.

import { Toaster as SonnerToaster } from "sonner";

export default function Toaster() {
  return (
    <SonnerToaster
      position="top-center"
      toastOptions={{
        style: {
          fontFamily: "var(--font-dm-sans), sans-serif",
          borderRadius: "12px",
          border: "1px solid #E3E0D9",
          fontSize: "13.5px",
        },
      }}
    />
  );
}
