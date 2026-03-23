import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Fees — KiwiMart',
  description: 'Simple, transparent pricing. Free to list, free to buy. No hidden fees.',
};

export const revalidate = 86400;

export default function FeesPage() {
  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#F5ECD4] text-[#8B6914] text-[11.5px] font-semibold mb-4">
              Pricing
            </div>
            <h1 className="font-[family-name:var(--font-playfair)] text-[2.5rem] font-semibold text-[#141414] leading-tight mb-3">
              Simple, transparent pricing
            </h1>
            <p className="text-[16px] text-[#73706A]">No surprises. No hidden fees.</p>
          </div>

          {/* Main pricing cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
            {[
              { label: 'Listing fee', price: '$0', sub: 'Always free to list', icon: '🏷' },
              { label: 'Buyer fee', price: '$0', sub: 'Free to browse and buy', icon: '🛒' },
              { label: 'Payment processing', price: 'Included', sub: 'No extra charge', icon: '🔒' },
            ].map(({ label, price, sub, icon }) => (
              <div key={label} className="bg-white rounded-2xl border border-[#E3E0D9] p-6 text-center">
                <div className="text-3xl mb-3">{icon}</div>
                <p className="text-[11.5px] font-semibold text-[#9E9A91] uppercase tracking-wide mb-1">{label}</p>
                <p className="font-[family-name:var(--font-playfair)] text-[2rem] font-semibold text-[#141414] leading-none mb-1">
                  {price}
                </p>
                <p className="text-[12.5px] text-[#73706A]">{sub}</p>
              </div>
            ))}
          </div>

          {/* How it works */}
          <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6 mb-6">
            <h2 className="font-[family-name:var(--font-playfair)] text-[1.25rem] font-semibold text-[#141414] mb-5">
              How it works
            </h2>
            <div className="space-y-4">
              {[
                { step: '1', title: 'Sellers list for free', desc: 'Create a listing in minutes at no cost.' },
                { step: '2', title: 'Buyers pay the listed price', desc: 'No added fees. The price you see is the price you pay.' },
                { step: '3', title: 'Stripe processes payment securely', desc: 'Bank-grade encryption on every transaction.' },
                { step: '4', title: 'Funds held in escrow', desc: 'Payment is held safely until delivery is confirmed.' },
                { step: '5', title: 'Seller receives payment', desc: 'Released within 3 business days of delivery confirmation.' },
              ].map(({ step, title, desc }) => (
                <div key={step} className="flex gap-4 items-start">
                  <div className="w-7 h-7 rounded-full bg-[#D4A843] text-[#141414] flex items-center justify-center font-bold text-[12px] shrink-0">
                    {step}
                  </div>
                  <div>
                    <p className="font-semibold text-[#141414] text-[14px]">{title}</p>
                    <p className="text-[13px] text-[#73706A] mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Coming soon */}
          <div className="bg-[#141414] text-white rounded-2xl p-6">
            <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold mb-4">
              Coming soon — optional extras
            </h2>
            <p className="text-[13px] text-white/50 mb-4">
              The core marketplace is always free. These optional features are planned for the future.
            </p>
            <div className="space-y-2">
              {[
                'Featured listing boost (optional, pay to promote)',
                'Seller analytics dashboard (optional)',
                'Business seller accounts (optional)',
              ].map((item) => (
                <div key={item} className="flex items-center gap-2 text-[13px] text-white/60">
                  <span className="text-[#D4A843]">•</span>
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
