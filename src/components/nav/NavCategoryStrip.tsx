"use client";
// src/components/nav/NavCategoryStrip.tsx
// ─── Desktop category navigation strip ───────────────────────────────────────

import Link from "next/link";
import { usePathname } from "next/navigation";
import CATEGORIES from "@/data/categories";

export default function NavCategoryStrip() {
  const pathname = usePathname();

  return (
    <div className="hidden md:block border-t border-[#F0EDE8] bg-[#FAFAF8]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center gap-0 overflow-x-auto scrollbar-none">
          <Link
            href="/search"
            className="flex items-center gap-1.5 px-3 py-2.5 text-[12px]
              font-semibold text-[#73706A] hover:text-[#141414]
              border-b-2 border-transparent hover:border-[#D4A843]
              transition-all duration-150 whitespace-nowrap"
          >
            All
          </Link>
          {CATEGORIES.map((cat) => (
            <Link
              key={cat.id}
              href={`/search?category=${cat.id}`}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-[12px]
                font-semibold border-b-2 transition-all duration-150 whitespace-nowrap
                ${
                  pathname === `/search`
                    ? "text-[#73706A] hover:text-[#141414] border-transparent hover:border-[#D4A843]"
                    : "text-[#73706A] hover:text-[#141414] border-transparent hover:border-[#D4A843]"
                }`}
            >
              <span aria-hidden>{cat.icon}</span>
              {cat.name}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
