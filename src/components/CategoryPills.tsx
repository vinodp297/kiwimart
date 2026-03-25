'use client';

import Link from 'next/link';
import type { Category } from '@/types';

interface Props {
  categories: Category[];
  activeId?: string;
  /** If true, renders as scroll-overflow row (search page shelf style) */
  compact?: boolean;
  className?: string;
}

export default function CategoryPills({ categories, activeId, compact = false, className = '' }: Props) {
  if (compact) {
    return (
      <div
        className={`flex gap-2 overflow-x-auto scrollbar-none pb-1 ${className}`}
        role="list"
        aria-label="Category filter pills"
      >
        {categories.map((cat) => {
          const isActive = cat.id === activeId;
          return (
            <Link
              key={cat.id}
              href={`/search?category=${cat.id}`}
              role="listitem"
              className={`shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full
                text-[12.5px] font-medium border transition-all duration-150 whitespace-nowrap
                ${isActive
                  ? 'bg-[#141414] text-white border-[#141414] shadow-sm'
                  : 'bg-white text-[#73706A] border-[#C9C5BC] hover:border-[#141414] hover:text-[#141414]'
                }`}
            >
              <span aria-hidden>{cat.icon}</span>
              {cat.name}
            </Link>
          );
        })}
      </div>
    );
  }

  // Homepage grid layout
  return (
    <div
      className={`grid grid-cols-4 sm:grid-cols-4 md:grid-cols-8 gap-3 ${className}`}
      role="list"
      aria-label="Browse categories"
    >
      {categories.map((cat) => {
        const isActive = cat.id === activeId;
        return (
          <Link
            key={cat.id}
            href={`/search?category=${cat.id}`}
            role="listitem"
            className={`group flex flex-col items-center gap-2.5 px-2 py-4 rounded-2xl
              border text-center transition-all duration-200 hover:-translate-y-0.5
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A843]
              ${isActive
                ? 'bg-[#141414] text-white border-[#141414] shadow-md'
                : 'bg-white border-[#E3E0D9] text-[#73706A] hover:border-[#D4A843] hover:text-[#141414] hover:shadow-md'
              }`}
          >
            <span
              className={`text-2xl transition-transform duration-200 group-hover:scale-110
                ${isActive ? '' : ''}`}
              aria-hidden
            >
              {cat.icon}
            </span>
            <div>
              <p className={`text-[11.5px] font-semibold leading-tight
                ${isActive ? 'text-white' : 'text-[#141414]'}`}>
                {cat.name}
              </p>
              <p className={`text-[10px] mt-0.5 ${isActive ? 'text-white/60' : 'text-[#9E9A91]'}`}>
                {cat.listingCount > 0 ? `${cat.listingCount}+` : 'New'}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

