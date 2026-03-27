// src/app/not-found.tsx
// ─── Global 404 Page ──────────────────────────────────────────────────────────
// Next.js App Router convention: file must be named not-found.tsx
// Sprint 3: no changes needed — this is purely presentational.

import Link from 'next/link';
import type { Metadata } from 'next';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';

export const metadata: Metadata = {
  title: '404 — Page not found',
};

export default function NotFound() {
  return (
    <>
      <NavBar />
      <main
        className="bg-[#FAFAF8] min-h-[calc(100vh-theme(spacing.16))] flex
          items-center justify-center px-4 py-20"
      >
        <div className="max-w-md w-full text-center">
          {/* Illustration */}
          <div
            className="relative mx-auto w-40 h-40 mb-8"
            aria-hidden
          >
            <div
              className="absolute inset-0 rounded-full bg-[#F5ECD4] flex items-center
                justify-center"
            >
              <span className="text-[5rem] leading-none select-none">🥝</span>
            </div>
            {/* 404 badge */}
            <div
              className="absolute -top-2 -right-2 w-12 h-12 rounded-full
                bg-[#141414] text-white flex items-center justify-center
                font-[family-name:var(--font-playfair)] text-[0.8rem] font-bold
                shadow-lg border-2 border-white"
            >
              404
            </div>
          </div>

          <h1
            className="font-[family-name:var(--font-playfair)] text-[2rem]
              font-semibold text-[#141414] mb-3 leading-tight"
          >
            Page not found
          </h1>
          <p className="text-[14px] text-[#73706A] leading-relaxed mb-8 max-w-sm mx-auto">
            Looks like this page has sold out — or never existed. Let&apos;s get
            you back to shopping.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 h-11 px-7
                rounded-full bg-[#141414] text-white font-semibold text-[14px]
                hover:bg-[#D4A843] transition-colors duration-200"
            >
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
              Back to home
            </Link>
            <Link
              href="/search"
              className="inline-flex items-center justify-center gap-2 h-11 px-7
                rounded-full bg-white text-[#141414] font-semibold text-[14px]
                border border-[#C9C5BC] hover:border-[#141414] transition-colors
                duration-200"
            >
              Browse listings
            </Link>
          </div>

          {/* Popular categories */}
          <div className="mt-8 pt-6 border-t border-[#E3E0D9]">
            <p className="text-[12px] text-[#9E9A91] mb-3">Popular categories</p>
            <div className="flex flex-wrap justify-center gap-2">
              {[
                { href: '/search?category=electronics', label: 'Electronics' },
                { href: '/search?category=fashion', label: 'Fashion' },
                { href: '/search?category=home-garden', label: 'Home & Garden' },
                { href: '/search?category=sport-outdoors', label: 'Sports' },
                { href: '/search?category=vehicles', label: 'Vehicles' },
              ].map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="px-3 py-1.5 rounded-full bg-[#F8F7F4] border border-[#E3E0D9]
                    text-[12px] text-[#73706A] hover:border-[#D4A843] hover:text-[#141414]
                    transition-colors font-medium"
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>

          {/* Quick links */}
          <div className="mt-6">
            <div className="flex flex-wrap justify-center gap-3">
              {[
                { href: '/sell', label: 'Sell an item' },
                { href: '/login', label: 'Sign in' },
                { href: '/register', label: 'Register' },
                { href: '/safety', label: 'Safety guide' },
              ].map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="text-[12.5px] text-[#D4A843] hover:text-[#B8912E]
                    font-semibold transition-colors"
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

