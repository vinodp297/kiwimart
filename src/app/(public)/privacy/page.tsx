import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Buyzi Privacy Policy. Compliant with NZ Privacy Act 2020.",
};

export const revalidate = 86400;

export default function PrivacyPage() {
  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
          <div className="mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#F5ECD4] text-[#8B6914] text-[11.5px] font-semibold mb-4">
              Legal
            </div>
            <h1 className="font-[family-name:var(--font-playfair)] text-[2.25rem] font-semibold text-[#141414] leading-tight mb-3">
              Privacy Policy
            </h1>
            <p className="text-[13.5px] text-[#9E9A91]">
              Compliant with NZ Privacy Act 2020 · Last updated: March 2026
            </p>
          </div>

          <div className="space-y-8">
            <section>
              <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414] mb-3">
                1. What we collect
              </h2>
              <ul className="space-y-1.5 text-[14px] text-[#73706A] leading-relaxed">
                {[
                  "Name, email address, and username on registration",
                  "Phone number (optional, only if you choose to verify)",
                  "Listing content and photos you upload",
                  "Payment information (processed by Stripe — we never store card numbers)",
                  "Messages exchanged between users on the platform",
                  "Device and usage data collected via analytics",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="text-[#D4A843] shrink-0 mt-1">•</span>
                    {item}
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414] mb-3">
                2. How we use it
              </h2>
              <ul className="space-y-1.5 text-[14px] text-[#73706A] leading-relaxed">
                {[
                  "To operate the marketplace and process transactions",
                  "To process payments securely via Stripe",
                  "To send order confirmations and account notifications",
                  "To improve the platform using anonymised analytics",
                  "We never sell your personal data to third parties",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="text-[#D4A843] shrink-0 mt-1">•</span>
                    {item}
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414] mb-3">
                3. Who we share with
              </h2>
              <div className="space-y-2">
                {[
                  {
                    name: "Stripe",
                    desc: "Payment processing",
                    url: "stripe.com/privacy",
                  },
                  {
                    name: "Postmark",
                    desc: "Transactional email",
                    url: "wildbit.com/privacy",
                  },
                  {
                    name: "Cloudflare",
                    desc: "CDN and infrastructure",
                    url: "cloudflare.com/privacy",
                  },
                  {
                    name: "Neon",
                    desc: "Database (stored in US)",
                    url: "neon.tech/privacy",
                  },
                  {
                    name: "PostHog",
                    desc: "Analytics (anonymised, opt-out available)",
                    url: "posthog.com/privacy",
                  },
                ].map(({ name, desc, url }) => (
                  <div
                    key={name}
                    className="flex items-center justify-between p-3 bg-white rounded-xl border border-[#E3E0D9] text-[13px]"
                  >
                    <div>
                      <span className="font-semibold text-[#141414]">
                        {name}
                      </span>
                      <span className="text-[#73706A] ml-2">— {desc}</span>
                    </div>
                    <a
                      href={`https://${url}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#D4A843] hover:text-[#B8912E] text-[11.5px]"
                    >
                      Privacy policy ↗
                    </a>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414] mb-3">
                4. Where data is stored
              </h2>
              <p className="text-[14px] text-[#73706A] leading-relaxed">
                Primary data is stored in the United States (Neon database,
                Vercel infrastructure). Media files are served globally via
                Cloudflare. Buyzi maintains compliance with the NZ Privacy Act
                2020.
              </p>
            </section>

            <section>
              <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414] mb-3">
                5. Your rights under NZ Privacy Act 2020
              </h2>
              <ul className="space-y-1.5 text-[14px] text-[#73706A] leading-relaxed">
                {[
                  "Access your personal information held by Buyzi",
                  "Request correction of inaccurate data",
                  "Request deletion of your account and associated data",
                  "Opt out of marketing emails at any time",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="text-[#D4A843] shrink-0 mt-1">•</span>
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[13.5px] text-[#73706A]">
                Contact:{" "}
                <a
                  href="mailto:privacy@buyzi.co.nz"
                  className="text-[#D4A843] hover:text-[#B8912E]"
                >
                  privacy@buyzi.co.nz
                </a>
              </p>
            </section>

            <section>
              <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414] mb-3">
                6. Cookies
              </h2>
              <p className="text-[14px] text-[#73706A] leading-relaxed">
                <strong className="text-[#141414]">Essential cookies:</strong>{" "}
                Used for session management and security. Required for the site
                to function.
                <br />
                <strong className="text-[#141414]">
                  Analytics cookies:
                </strong>{" "}
                PostHog, fully anonymised. You may opt out at any time.
                <br />
                We do not use advertising or tracking cookies.
              </p>
            </section>

            <section>
              <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414] mb-3">
                7. Data retention
              </h2>
              <ul className="space-y-1.5 text-[14px] text-[#73706A] leading-relaxed">
                {[
                  "Account data: retained until you request deletion",
                  "Order records: 7 years (required by NZ tax law)",
                  "Deleted accounts: anonymised within 30 days",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="text-[#D4A843] shrink-0 mt-1">•</span>
                    {item}
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414] mb-3">
                8. Contact our Privacy Officer
              </h2>
              <p className="text-[14px] text-[#73706A]">
                Email:{" "}
                <a
                  href="mailto:privacy@buyzi.co.nz"
                  className="text-[#D4A843] hover:text-[#B8912E]"
                >
                  privacy@buyzi.co.nz
                </a>
                <br />
                Buyzi Limited, Auckland, New Zealand.
              </p>
            </section>
          </div>

          <div className="mt-10 pt-6 border-t border-[#E3E0D9] text-[12.5px] text-[#9E9A91]">
            <p>Last updated: March 2026</p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
