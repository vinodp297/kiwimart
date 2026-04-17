// src/app/(legal)/layout.tsx
// ─── Legal page layout ────────────────────────────────────────────────────────
// Minimal, focused layout for long-form legal documents.
// Max-width 800px, clean header with logo + back link, simple footer.

import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#FAFAF8] flex flex-col">
      {/* Header */}
      <header className="border-b border-[#E3E0D9] bg-white sticky top-0 z-40">
        <div className="max-w-[864px] mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <div
              className="w-8 h-8 rounded-full bg-[#D4A843] flex items-center
                justify-center text-[#141414] text-sm font-bold"
              aria-hidden
            >
              K
            </div>
            <span className="font-playfair text-[1.2rem] tracking-tight text-[#141414]">
              Buy<em className="not-italic text-[#D4A843]">zi</em>
            </span>
          </Link>

          {/* Back link */}
          <Link
            href="/"
            className="text-[13px] text-[#9E9A91] hover:text-[#141414] transition-colors flex items-center gap-1"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
            Back to Buyzi
          </Link>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1">{children}</main>

      {/* Footer */}
      <footer className="border-t border-[#E3E0D9] py-6 mt-8">
        <div className="max-w-[864px] mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-[12px] text-[#9E9A91]">
          <p>© 2026 Buyzi Limited · Auckland, New Zealand</p>
          <nav className="flex gap-4" aria-label="Legal navigation">
            <Link
              href="/privacy"
              className="hover:text-[#141414] transition-colors"
            >
              Privacy Policy
            </Link>
            <Link
              href="/terms"
              className="hover:text-[#141414] transition-colors"
            >
              Terms of Service
            </Link>
            <Link
              href="/seller-agreement"
              className="hover:text-[#141414] transition-colors"
            >
              Seller Agreement
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
