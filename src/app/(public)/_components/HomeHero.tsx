// src/app/(public)/_components/HomeHero.tsx
// ─── Hero section + stats strip ───────────────────────────────────────────────
// Server component — receives processed stats as props, renders the hero section
// (search form, headline, quick links) and the platform-stats strip beneath it.

import Link from "next/link";
import CATEGORIES from "@/data/categories";
import type { HomeStat } from "../_lib/home-data";

interface Props {
  stats: HomeStat[];
}

export default function HomeHero({ stats }: Props) {
  return (
    <>
      {/* ══════════════════════════════════════════════════════════════════
          HERO
      ══════════════════════════════════════════════════════════════════ */}
      <section
        className="relative overflow-hidden bg-[#141414] text-white"
        aria-label="Hero"
      >
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg,transparent,transparent 39px,rgba(255,255,255,1) 39px,rgba(255,255,255,1) 40px)," +
              "repeating-linear-gradient(90deg,transparent,transparent 39px,rgba(255,255,255,1) 39px,rgba(255,255,255,1) 40px)",
          }}
        />
        <div
          aria-hidden
          className="absolute -top-32 -right-32 w-96 h-96 rounded-full
            bg-[#D4A843]/20 blur-[100px] pointer-events-none"
        />
        <div
          aria-hidden
          className="absolute bottom-0 left-1/4 w-64 h-64 rounded-full
            bg-[#D4A843]/10 blur-[80px] pointer-events-none"
        />

        <div className="relative max-w-7xl mx-auto px-6 py-16 sm:py-24">
          <div className="max-w-2xl">
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full
                border border-[#D4A843]/40 bg-[#D4A843]/10 text-[#D4A843]
                text-[11.5px] font-semibold tracking-wide uppercase mb-6"
            >
              <span aria-hidden>🥝</span> New Zealand&apos;s Marketplace
            </div>

            <h1
              className="font-[family-name:var(--font-playfair)] text-[2.5rem]
                sm:text-[3.25rem] lg:text-[3.75rem] font-semibold leading-[1.1]
                tracking-tight"
            >
              Buy &amp; sell with{" "}
              <em className="not-italic text-[#D4A843]">confidence</em>
            </h1>

            <p className="mt-4 text-[15.5px] text-white/65 leading-relaxed max-w-xl">
              Aotearoa&apos;s most trusted marketplace. Every transaction
              secured by escrow, every purchase backed by{" "}
              {process.env.NEXT_PUBLIC_BUYER_PROTECTION_DISPLAY ?? "$3,000"}{" "}
              buyer protection. Shop local. Shop safe.
            </p>

            <form
              action="/search"
              method="get"
              className="mt-8 flex flex-col sm:flex-row gap-2"
              role="search"
            >
              <div className="relative flex-1">
                <input
                  name="q"
                  type="search"
                  placeholder="Search for anything…"
                  aria-label="Search listings"
                  className="w-full h-12 pl-12 pr-4 rounded-xl bg-white/10 text-white
                    placeholder:text-white/40 border border-white/20
                    focus:border-[#D4A843] focus:bg-white/15 focus:outline-none
                    focus:ring-2 focus:ring-[#D4A843]/30
                    text-[14.5px] transition"
                />
                <svg
                  aria-hidden
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40"
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
              </div>

              <select
                name="category"
                aria-label="Category"
                className="h-12 px-4 rounded-xl bg-white/10 text-white/80
                  border border-white/20 focus:border-[#D4A843] focus:outline-none
                  text-[13.5px] cursor-pointer appearance-none pr-9 min-w-[140px]
                  [background-image:url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%228%22%3E%3Cpath d=%22M1 1l5 5 5-5%22 stroke=%22rgba(255,255,255,.4)%22 stroke-width=%221.5%22 fill=%22none%22 stroke-linecap=%22round%22/%3E%3C/svg%3E')]
                  [background-repeat:no-repeat] [background-position:right_14px_center]"
              >
                <option value="">All categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </select>

              <button
                type="submit"
                className="h-12 px-6 rounded-xl bg-[#D4A843] text-[#141414]
                  font-semibold text-[14px] hover:bg-[#B8912E] hover:text-white
                  transition-colors duration-150 shadow-lg shadow-[#D4A843]/30
                  whitespace-nowrap"
              >
                Search
              </button>
            </form>

            <div className="flex flex-wrap gap-2 mt-4">
              {[
                "Laptops",
                "Road bikes",
                "Allbirds",
                "Weber BBQ",
                "Pounamu",
              ].map((term) => (
                <Link
                  key={term}
                  href={`/search?q=${encodeURIComponent(term)}`}
                  className="text-[11.5px] text-white/50 hover:text-[#D4A843]
                      transition-colors duration-150"
                >
                  {term}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* STATS STRIP */}
      <section
        aria-label="Platform statistics"
        className="bg-[#F8F7F4] border-b border-[#E3E0D9]"
      >
        <div className="max-w-7xl mx-auto px-6">
          <dl
            className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0
            divide-[#E3E0D9]"
          >
            {stats.map(({ value, label }) => (
              <div
                key={label}
                className="flex flex-col items-center py-5 gap-0.5"
              >
                <dt
                  className="font-[family-name:var(--font-playfair)] text-[1.75rem]
                    font-semibold text-[#141414] leading-none"
                >
                  {value}
                </dt>
                <dd className="text-[12px] text-[#73706A] font-medium">
                  {label}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </>
  );
}
