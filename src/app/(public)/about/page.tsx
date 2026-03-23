import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About KiwiMart — Built by Kiwis, for Kiwis',
  description: 'KiwiMart is a New Zealand marketplace built in Auckland in 2026. Our mission: safe, simple, fair trading for everyone in Aotearoa.',
};

export const revalidate = 86400;

export default function AboutPage() {
  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        {/* Hero */}
        <div className="bg-[#141414] text-white">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16 text-center">
            <div className="text-5xl mb-5">🥝</div>
            <h1 className="font-[family-name:var(--font-playfair)] text-[2.75rem] font-semibold leading-tight mb-4">
              Built by Kiwis, for Kiwis
            </h1>
            <p className="text-[16px] text-white/60 max-w-xl mx-auto leading-relaxed">
              We are on a mission to make buying and selling safe, simple and fair
              for everyone in Aotearoa.
            </p>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
          {/* Our story */}
          <div className="bg-white rounded-2xl border border-[#E3E0D9] p-8 mb-6">
            <h2 className="font-[family-name:var(--font-playfair)] text-[1.5rem] font-semibold text-[#141414] mb-4">
              Our story
            </h2>
            <p className="text-[15px] text-[#73706A] leading-relaxed">
              KiwiMart was built in Auckland in 2026 with one goal: to give New Zealanders a
              marketplace they can actually trust. Every transaction is protected by secure escrow,
              verified sellers, and a team that actually picks up the phone.
            </p>
            <p className="text-[15px] text-[#73706A] leading-relaxed mt-3">
              We believe New Zealanders deserve a modern, safe trading platform with fair pricing,
              strong buyer protection, and genuine local support. That is KiwiMart.
            </p>
          </div>

          {/* Values */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            {[
              {
                icon: '🔒',
                title: 'Trust',
                desc: 'Every payment held safely in escrow until you confirm delivery. Your money is protected.',
              },
              {
                icon: '🛡',
                title: 'Safety',
                desc: 'Verified sellers, content moderation, and $3,000 buyer protection on every eligible purchase.',
              },
              {
                icon: '🥝',
                title: 'Community',
                desc: 'Built for Kiwis — NZ regions, NZ prices, NZ-based support team available Mon–Fri.',
              },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
                <div className="text-3xl mb-3">{icon}</div>
                <h3 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414] mb-2">
                  {title}
                </h3>
                <p className="text-[13.5px] text-[#73706A] leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          {/* Contact */}
          <div className="bg-[#141414] text-white rounded-2xl p-8">
            <h2 className="font-[family-name:var(--font-playfair)] text-[1.5rem] font-semibold mb-6">
              Get in touch
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              {[
                { label: 'General enquiries', email: 'hello@kiwimart.co.nz' },
                { label: 'Customer support', email: 'support@kiwimart.co.nz' },
                { label: 'Press & media', email: 'press@kiwimart.co.nz' },
              ].map(({ label, email }) => (
                <div key={label}>
                  <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wide mb-1">{label}</p>
                  <a href={`mailto:${email}`} className="text-[#D4A843] hover:text-[#F5C84A] text-[13.5px] transition-colors">
                    {email}
                  </a>
                </div>
              ))}
            </div>
            <p className="text-[12.5px] text-white/40">Auckland, New Zealand</p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
