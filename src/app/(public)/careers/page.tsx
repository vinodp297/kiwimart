import type { Metadata } from 'next';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';

export const metadata: Metadata = {
  title: 'Careers — KiwiMart',
  description: 'Join the KiwiMart team and help build New Zealand\'s most trusted marketplace.',
};

export default function CareersPage() {
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
              Join the KiwiMart team
            </h1>
            <p className="text-[16px] text-[#73706A] leading-relaxed max-w-xl">
              We are building New Zealand&apos;s most trusted marketplace. Come build it with us.
            </p>
          </div>

          {/* Empty state card */}
          <div
            className="bg-white rounded-2xl border border-[#E3E0D9] p-12
              flex flex-col items-center text-center"
          >
            <div
              className="w-16 h-16 rounded-full bg-[#F5ECD4] flex items-center
                justify-center mb-5"
            >
              <svg
                width="28" height="28" viewBox="0 0 24 24" fill="none"
                stroke="#D4A843" strokeWidth="1.8"
              >
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
              </svg>
            </div>
            <h2
              className="font-[family-name:var(--font-playfair)] text-[1.35rem]
                font-semibold text-[#141414] mb-3"
            >
              No open roles right now
            </h2>
            <p className="text-[14px] text-[#73706A] leading-relaxed max-w-sm mb-8">
              We&apos;re always keen to hear from talented people. Send your CV to{' '}
              <a
                href="mailto:hello@kiwimart.co.nz"
                className="text-[#D4A843] font-semibold hover:text-[#B8912E] transition-colors"
              >
                hello@kiwimart.co.nz
              </a>
            </p>
            <a
              href="mailto:hello@kiwimart.co.nz"
              className="inline-flex items-center gap-2 h-11 px-8 rounded-full
                bg-[#D4A843] text-[#141414] font-semibold text-[14px]
                hover:bg-[#B8912E] hover:text-white transition-colors"
            >
              Get in touch
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </a>
          </div>

          {/* Values section */}
          <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { icon: '🥝', title: 'Kiwi-built', body: 'We\'re proudly NZ-owned and building for Kiwis, by Kiwis.' },
              { icon: '🛡️', title: 'Trust-first', body: 'Safety and trust are at the core of everything we ship.' },
              { icon: '🚀', title: 'Move fast', body: 'Small team, big impact. Your work matters from day one.' },
            ].map(({ icon, title, body }) => (
              <div
                key={title}
                className="bg-white rounded-2xl border border-[#E3E0D9] p-6"
              >
                <span className="text-2xl mb-3 block">{icon}</span>
                <h3 className="font-semibold text-[#141414] text-[14px] mb-1.5">{title}</h3>
                <p className="text-[13px] text-[#73706A] leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
