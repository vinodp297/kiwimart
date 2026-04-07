"use client";
// src/components/nav/NavSearchBar.tsx
// ─── Desktop search bar ──────────────────────────────────────────────────────

export default function NavSearchBar() {
  return (
    <form
      action="/search"
      method="get"
      className="flex-1 hidden md:flex items-center gap-2 max-w-xl"
      role="search"
    >
      <div className="relative flex-1">
        <input
          name="q"
          type="search"
          placeholder="Search listings…"
          aria-label="Search listings"
          className="w-full h-9 pl-9 pr-4 rounded-xl border border-[#C9C5BC]
            bg-[#F8F7F4] text-[#141414] text-[13px] placeholder:text-[#C9C5BC]
            focus:outline-none focus:border-[#D4A843] focus:bg-white
            focus:ring-2 focus:ring-[#D4A843]/20 transition"
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
      <button
        type="submit"
        className="h-9 px-4 rounded-xl bg-[#D4A843] text-[#141414]
          font-semibold text-[12.5px] hover:bg-[#B8912E] hover:text-white
          transition-colors duration-150 whitespace-nowrap shrink-0"
      >
        Search
      </button>
    </form>
  );
}
