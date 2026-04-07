"use client";
// src/components/nav/NavUserDropdown.tsx
// ─── User account dropdown menu ──────────────────────────────────────────────

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";

export interface NavUser {
  displayName: string;
  email: string;
  isSellerEnabled: boolean;
  avatarUrl: string | null;
  isAdmin: boolean;
}

interface Props {
  user: NavUser;
  initials: string;
  onSignOut: () => void;
}

const BUYER_LINKS = [
  {
    href: "/dashboard/buyer?tab=orders",
    label: "My orders & purchases",
    icon: "\uD83D\uDCE6",
  },
  {
    href: "/dashboard/buyer?tab=watchlist",
    label: "Watchlist",
    icon: "\u2764\uFE0F",
  },
  {
    href: "/dashboard/buyer?tab=messages",
    label: "Messages",
    icon: "\uD83D\uDCAC",
  },
];

const SELLER_LINKS = [
  {
    href: "/dashboard/seller?tab=overview",
    label: "Seller dashboard",
    icon: "\uD83D\uDCCA",
  },
  { href: "/sell", label: "Create listing", icon: "\u2795" },
  { href: "/seller/onboarding", label: "Seller Hub", icon: "\uD83C\uDF3F" },
];

function MenuLink({
  href,
  label,
  icon,
  onClick,
}: {
  href: string;
  label: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-[#141414] hover:bg-[#F8F7F4] transition-colors"
    >
      <span className="text-base">{icon}</span>
      {label}
    </Link>
  );
}

export default function NavUserDropdown({ user, initials, onSignOut }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-expanded={open}
        className="flex items-center gap-2 h-9 pl-2 pr-3 rounded-xl hover:bg-[#F8F7F4] transition-colors"
      >
        <div className="w-7 h-7 rounded-full bg-[#141414] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
          {initials}
        </div>
        <svg
          aria-hidden
          className={`text-[#9E9A91] transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-56 bg-white border border-[#E3E0D9] rounded-2xl shadow-xl overflow-hidden z-[300]">
          <div className="px-4 py-3 border-b border-[#F0EDE8]">
            <p className="text-[13px] font-semibold text-[#141414] truncate">
              {user.displayName}
            </p>
            <p className="text-[11.5px] text-[#9E9A91] truncate">
              {user.email}
            </p>
          </div>
          {user.isAdmin && (
            <div className="border-b border-[#F0EDE8]">
              <Link
                href="/admin"
                onClick={close}
                className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-[#D4A843] font-semibold hover:bg-[#F5ECD4]/40 transition-colors"
              >
                <span className="text-base">{"\u26A1"}</span>Admin Panel
              </Link>
            </div>
          )}
          <div className="py-1">
            {BUYER_LINKS.map((l) => (
              <MenuLink key={l.href} {...l} onClick={close} />
            ))}
          </div>
          {user.isSellerEnabled && (
            <div className="border-t border-[#F0EDE8] py-1">
              <p className="px-4 py-1.5 text-[10.5px] font-semibold text-[#9E9A91] uppercase tracking-wide">
                Selling
              </p>
              {SELLER_LINKS.map((l) => (
                <MenuLink key={l.href} {...l} onClick={close} />
              ))}
            </div>
          )}
          <div className="border-t border-[#F0EDE8] py-1">
            <Link
              href="/account/settings"
              onClick={close}
              className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-[#141414] hover:bg-[#F8F7F4] transition-colors"
            >
              <span className="text-base">{"\u2699\uFE0F"}</span>Account
              settings
            </Link>
            <button
              onClick={() => {
                close();
                onSignOut();
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-red-500 hover:bg-red-50 transition-colors"
            >
              <span className="text-base">{"\uD83D\uDEAA"}</span>Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
