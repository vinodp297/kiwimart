"use client";
// src/components/ToastHandler.tsx
// Reads URL search params and fires one-time sonner toasts.
// Cleans up the param after showing the toast to prevent re-fire on refresh.

import { useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";

export default function ToastHandler() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const welcome = params.get("welcome");
    const verified = params.get("verified");

    if (welcome === "true") {
      toast(
        "Welcome to KiwiMart! Check your email to unlock buying and selling.",
        {
          duration: 6000,
        },
      );
      // Strip param without full navigation
      const next = new URLSearchParams(params.toString());
      next.delete("welcome");
      const qs = next.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    }

    if (verified === "true") {
      toast.success("Email verified! You now have full access to KiwiMart.", {
        duration: 5000,
      });
      const next = new URLSearchParams(params.toString());
      next.delete("verified");
      const qs = next.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    }
  }, [params, router, pathname]);

  return null;
}
