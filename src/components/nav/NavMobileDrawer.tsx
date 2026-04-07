"use client";
// src/components/nav/NavMobileDrawer.tsx
// ─── Mobile slide-out navigation drawer ──────────────────────────────────────

import Link from "next/link";
import CATEGORIES from "@/data/categories";
import type { NavUser } from "./NavUserDropdown";

interface Props {
  open: boolean;
  user: NavUser | null;
  onClose: () => void;
  onSignOut: () => void;
}

export default function NavMobileDrawer({
  open,
  user,
  onClose,
  onSignOut,
}: Props) {
  return (
    <div
      className={`fixed inset-0 md:hidden ${open ? "pointer-events-auto" : "pointer-events-none"}`}
      aria-modal="true"
      role="dialog"
      aria-hidden={!open}
    >
      <div
        className={`absolute inset-0 bg-black/50 z-[390] transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <div
        className={`absolute top-0 right-0 h-full w-[85%] max-w-sm bg-white z-[400] shadow-2xl flex flex-col overflow-y-auto transform transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E3E0D9] shrink-0">
          <span className="font-[family-name:var(--font-playfair)] text-[1.1rem] text-[#141414]">
            Kiwi<em className="not-italic text-[#D4A843]">Mart</em>
          </span>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="w-8 h-8 rounded-full bg-[#F8F7F4] flex items-center justify-center text-[#73706A]"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Mobile search */}
        <div className="px-5 py-4 border-b border-[#E3E0D9]">
          <form action="/search" method="get" role="search">
            <div className="relative">
              <input
                name="q"
                type="search"
                placeholder="Search listings…"
                className="w-full h-10 pl-9 pr-4 rounded-xl border border-[#C9C5BC] bg-[#F8F7F4] text-[13px] text-[#141414] placeholder:text-[#C9C5BC] focus:outline-none focus:border-[#D4A843] transition"
              />
              <svg
                aria-hidden
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9E9A91]"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
            </div>
          </form>
        </div>

        {/* Nav links */}
        <nav className="flex-1 py-3">
          <p className="px-5 py-2 text-[10.5px] font-semibold text-[#9E9A91] uppercase tracking-wide">
            Categories
          </p>
          {CATEGORIES.map((cat) => (
            <Link
              key={cat.id}
              href={`/search?category=${cat.id}`}
              className="flex items-center gap-3 px-5 py-2.5 text-[13px] text-[#141414] hover:bg-[#F8F7F4] transition-colors"
            >
              <span className="text-base">{cat.icon}</span>
              {cat.name}
            </Link>
          ))}
          <div className="border-t border-[#E3E0D9] mt-3 pt-3">
            <p className="px-5 py-2 text-[10.5px] font-semibold text-[#9E9A91] uppercase tracking-wide">
              Account
            </p>
            {user ? (
              <>
                <Link
                  href="/dashboard/buyer"
                  className="flex items-center gap-3 px-5 py-2.5 text-[13px] text-[#141414] hover:bg-[#F8F7F4] transition-colors"
                >
                  {"\uD83D\uDCE6"} My orders
                </Link>
                <Link
                  href="/dashboard/seller"
                  className="flex items-center gap-3 px-5 py-2.5 text-[13px] text-[#141414] hover:bg-[#F8F7F4] transition-colors"
                >
                  {"\uD83D\uDCCA"} Seller dashboard
                </Link>
                <Link
                  href="/seller/onboarding"
                  className="flex items-center gap-3 px-5 py-2.5 text-[13px] text-[#141414] hover:bg-[#F8F7F4] transition-colors"
                >
                  {"\uD83C\uDF3F"} Seller Hub
                </Link>
                <button
                  onClick={onSignOut}
                  className="w-full flex items-center gap-3 px-5 py-2.5 text-[13px] text-red-500 hover:bg-red-50 transition-colors"
                >
                  {"\uD83D\uDEAA"} Sign out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="flex items-center gap-3 px-5 py-2.5 text-[13px] text-[#141414] hover:bg-[#F8F7F4] transition-colors"
                >
                  Sign in
                </Link>
                <Link
                  href="/register"
                  className="flex items-center gap-3 px-5 py-2.5 text-[13px] text-[#D4A843] font-semibold hover:bg-[#F8F7F4] transition-colors"
                >
                  Register free
                </Link>
              </>
            )}
          </div>
        </nav>

        {/* Sell CTA */}
        <div className="px-5 py-4 border-t border-[#E3E0D9] shrink-0">
          <Link
            href="/sell"
            className="flex items-center justify-center gap-2 w-full h-11 rounded-xl bg-[#D4A843] text-[#141414] font-semibold text-[14px] hover:bg-[#B8912E] hover:text-white transition-colors"
          >
            + Sell an item
          </Link>
        </div>
      </div>
    </div>
  );
}
