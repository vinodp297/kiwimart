"use client";
// src/components/nav/NavCartBadge.tsx
// ─── Cart icon with item count badge ─────────────────────────────────────────

import Link from "next/link";

interface NavCartBadgeProps {
  cartCount: number;
}

export default function NavCartBadge({ cartCount }: NavCartBadgeProps) {
  return (
    <Link
      href="/cart"
      className="relative w-9 h-9 rounded-xl flex items-center justify-center
        text-[#73706A] hover:text-[#141414] hover:bg-[#F8F7F4]
        transition-colors"
      aria-label={`Shopping cart${cartCount > 0 ? ` (${cartCount} items)` : ""}`}
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>
      {cartCount > 0 && (
        <span
          className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full
            bg-[#D4A843] text-[10px] font-bold text-white flex items-center
            justify-center px-1 ring-2 ring-white"
        >
          {cartCount > 9 ? "9+" : cartCount}
        </span>
      )}
    </Link>
  );
}
