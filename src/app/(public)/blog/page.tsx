import type { Metadata } from 'next';
import Link from 'next/link';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';

export const metadata: Metadata = {
  title: 'Blog — KiwiMart',
  description: 'Tips, updates and stories from the KiwiMart team.',
};

export default function BlogPage() {
  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <div className="max-w-3xl mx-auto px-6 py-16">
          {/* Header */}
          <div className="mb-12">
            <h1
              className="font-[family-name:var(--font-playfair)] text-[2.5rem]
                font-semibold text-[#141414] leading-tight mb-4"
            >
              KiwiMart Blog
            </h1>
            <p className="text-[16px] text-[#73706A] leading-relaxed">
              Tips, updates and stories from the KiwiMart team
            </p>
          </div>

          {/* Coming soon empty state */}
          <div
            className="bg-white rounded-2xl border border-[#E3E0D9] p-16
              flex flex-col items-center text-center"
          >
            <span className="text-5xl mb-5" role="img" aria-label="kiwi fruit">🥝</span>
            <h2
              className="font-[family-name:var(--font-playfair)] text-[1.5rem]
                font-semibold text-[#141414] mb-3"
            >
              Coming soon
            </h2>
            <p className="text-[14px] text-[#73706A] leading-relaxed max-w-sm mb-8">
              We are working on our first posts. Check back soon!
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-[13.5px] font-semibold
                text-[#D4A843] hover:text-[#B8912E] transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              Back to homepage
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
