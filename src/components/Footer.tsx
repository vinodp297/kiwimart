import Link from 'next/link';

const LINKS = {
  Marketplace: [
    { label: 'Browse all', href: '/search' },
    { label: 'Sell', href: '/sell' },
    { label: 'Categories', href: '/categories' },
    { label: 'Recent listings', href: '/search?sort=newest' },
  ],
  Trust: [
    { label: 'Buyer protection', href: '/trust' },
    { label: 'Safety guide', href: '/safety' },
    { label: 'Fees', href: '/fees' },
    { label: 'Report a problem', href: '/report' },
  ],
  Company: [
    { label: 'About us', href: '/about' },
    { label: 'Contact', href: '/contact' },
    { label: 'Careers', href: '/careers' },
    { label: 'Blog', href: '/blog' },
  ],
  Legal: [
    { label: 'Terms of service', href: '/terms' },
    { label: 'Privacy policy', href: '/privacy' },
    { label: 'Fees', href: '/fees' },
    { label: 'NZ Consumer law', href: '/consumer-law' },
  ],
};

export default function Footer() {
  return (
    <footer className="bg-[#141414] text-white mt-20">
      <div className="max-w-7xl mx-auto px-6 pt-14 pb-10">
        {/* Top row */}
        <div className="flex flex-col md:flex-row gap-10 md:gap-16">
          {/* Brand */}
          <div className="md:w-56 shrink-0">
            <div className="flex items-center gap-2 mb-4">
              <div
                className="w-8 h-8 rounded-full bg-[#D4A843] flex items-center
                  justify-center text-[#141414] text-sm font-bold"
                aria-hidden
              >
                K
              </div>
              <span
                className="font-[family-name:var(--font-playfair)] text-[1.2rem] tracking-tight"
              >
                Kiwi<em className="not-italic text-[#D4A843]">Mart</em>
              </span>
            </div>
            <p className="text-[12.5px] text-white/50 leading-relaxed">
              New Zealand's trusted marketplace — buy and sell with confidence,
              protected by secure escrow and $3,000 buyer cover.
            </p>
            <div className="flex gap-3 mt-5">
              {/* Social icons (placeholder SVGs) */}
              {['Facebook', 'Instagram', 'X'].map((sn) => (
                <a
                  key={sn}
                  href="#"
                  aria-label={sn}
                  className="w-8 h-8 rounded-full border border-white/20 flex items-center
                    justify-center text-white/50 hover:border-[#D4A843] hover:text-[#D4A843]
                    transition-colors duration-150 text-[10px] font-bold"
                >
                  {sn[0]}
                </a>
              ))}
            </div>
          </div>

          {/* Link columns */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 flex-1">
            {Object.entries(LINKS).map(([group, links]) => (
              <div key={group}>
                <h3 className="text-[11px] font-semibold tracking-widest uppercase
                  text-white/30 mb-3">
                  {group}
                </h3>
                <ul className="space-y-2">
                  {links.map(({ label, href }) => (
                    <li key={label}>
                      <Link
                        href={href}
                        className="text-[12.5px] text-white/60 hover:text-white
                          transition-colors duration-150"
                      >
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 pt-6 border-t border-white/10 flex flex-col sm:flex-row
          items-center justify-between gap-3 text-[11.5px] text-white/30">
          <p>© 2026 KiwiMart Limited. Auckland, New Zealand.</p>
          <p>GST No. 123-456-789 · All transactions covered by NZ Consumer Guarantees Act 1993</p>
        </div>
      </div>
    </footer>
  );
}

