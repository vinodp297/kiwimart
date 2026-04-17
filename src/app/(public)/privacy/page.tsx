// src/app/(public)/privacy/page.tsx
// ─── Privacy Policy ───────────────────────────────────────────────────────────

import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import LegalDocument from "@/components/legal/LegalDocument";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Buyzi Privacy Policy — how we collect, use, and protect your personal information in accordance with the New Zealand Privacy Act 2020.",
};

export const revalidate = 86400;

export default function PrivacyPage() {
  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <LegalDocument
          title="Privacy Policy"
          lastUpdated="16 April 2026"
          effectiveDate="16 April 2026"
        >
          <section>
            <h2>1. Introduction</h2>
            <p>
              Buyzi Limited (&ldquo;Buyzi&rdquo;, &ldquo;we&rdquo;,
              &ldquo;us&rdquo;, or &ldquo;our&rdquo;) operates the Buyzi
              marketplace platform at buyzi.co.nz. This Privacy Policy explains
              how we collect, use, disclose, and protect your personal
              information in accordance with the New Zealand Privacy Act 2020.
            </p>
            <p>
              By using Buyzi, you agree to the collection and use of information
              in accordance with this policy.
            </p>
          </section>

          <section>
            <h2>2. Information We Collect</h2>

            <h3>2.1 Information you provide</h3>
            <ul>
              {[
                "Account information: name, email address, password (hashed), phone number",
                "Profile information: display name, profile photo, location (region)",
                "Listing information: item descriptions, photos, prices, location",
                "Payment information: bank account details for payouts (via Stripe Connect)",
                "Identity verification: government-issued ID documents (NZ Passport, NZ Driver's Licence, Foreign Passport) for seller verification",
                "Communications: messages between buyers and sellers, dispute evidence",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
                  {item}
                </li>
              ))}
            </ul>

            <h3>2.2 Information collected automatically</h3>
            <ul>
              {[
                "Usage data: pages visited, features used, search queries",
                "Device information: IP address, browser type, operating system",
                "Transaction data: order history, payment records, dispute history",
                "Log data: server logs, error reports, performance data",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
                  {item}
                </li>
              ))}
            </ul>

            <h3>2.3 Information from third parties</h3>
            <ul>
              {[
                "Payment processing: Stripe Inc processes payment card data on our behalf",
                "SMS verification: Twilio Inc processes phone numbers for OTP delivery",
                "Analytics: PostHog processes anonymised usage data",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>3. How We Use Your Information</h2>
            <p>We use your personal information to:</p>
            <ul>
              {[
                "Provide, operate, and improve the Buyzi marketplace",
                "Process transactions and manage escrow payments",
                "Verify seller identity and prevent fraud",
                "Send transactional emails and SMS notifications",
                "Resolve disputes between buyers and sellers",
                "Comply with legal obligations under New Zealand law",
                "Detect and prevent prohibited activities and abuse",
                "Provide customer support",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>4. Information Sharing</h2>
            <p>
              We do not sell your personal information. We share information
              only with:
            </p>

            <h3>4.1 Service providers</h3>
            <ul>
              {[
                "Stripe Inc — payment processing and seller payouts (US-based, Privacy Shield)",
                "Twilio Inc — SMS delivery for OTP verification (US-based)",
                "Resend Inc — transactional email delivery (US-based)",
                "Cloudflare Inc — CDN, image storage, and DDoS protection (US-based)",
                "Neon Inc — database hosting (US-based, encrypted at rest)",
                "Vercel Inc — application hosting (US-based)",
                "Pusher Ltd — real-time messaging infrastructure (UK-based)",
                "PostHog Inc — anonymised analytics (US-based)",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
                  {item}
                </li>
              ))}
            </ul>

            <h3>4.2 Legal requirements</h3>
            <p>
              We may disclose your information if required by New Zealand law,
              court order, or to protect the rights, property, or safety of
              Buyzi, our users, or the public.
            </p>

            <h3>4.3 Business transfers</h3>
            <p>
              In the event of a merger, acquisition, or sale of assets, your
              information may be transferred as part of that transaction.
            </p>
          </section>

          <section>
            <h2>5. Data Retention</h2>
            <ul>
              {[
                "Account data: retained while your account is active and for 7 years after closure",
                "Transaction records: retained for 7 years for tax and legal compliance",
                "Identity documents: retained for 2 years after verification, then deleted",
                "Messages: retained for 2 years after the related order is completed",
                "Log data: retained for 90 days",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>6. Your Rights</h2>
            <p>
              Under the New Zealand Privacy Act 2020, you have the right to:
            </p>
            <ul>
              {[
                "Access your personal information we hold",
                "Correct inaccurate personal information",
                "Delete your account and associated data (subject to legal retention requirements)",
                "Export your data in a machine-readable format",
                "Complain to the Office of the Privacy Commissioner if you believe we have breached the Privacy Act",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
                  {item}
                </li>
              ))}
            </ul>
            <p>
              To exercise these rights, contact us at{" "}
              <a href="mailto:legal@buyzi.co.nz">legal@buyzi.co.nz</a> or use
              the data export and account deletion features in your account
              settings.
            </p>
          </section>

          <section>
            <h2>7. Security</h2>
            <p>We implement industry-standard security measures including:</p>
            <ul>
              {[
                "Passwords hashed using Argon2id",
                "All data encrypted in transit via TLS 1.3",
                "Database encrypted at rest",
                "Payment card data never stored on our servers (handled by Stripe)",
                "Regular security audits and penetration testing",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>8. Cookies</h2>
            <p>
              We use essential cookies for authentication and session
              management. We do not use advertising cookies or third-party
              tracking cookies.
            </p>
          </section>

          <section>
            <h2>9. Children&rsquo;s Privacy</h2>
            <p>
              Buyzi is not directed at children under 18. We do not knowingly
              collect personal information from anyone under 18.
            </p>
          </section>

          <section>
            <h2>10. Changes to This Policy</h2>
            <p>
              We will notify you of material changes to this policy by email or
              by posting a prominent notice on our platform. Continued use after
              changes constitutes acceptance.
            </p>
          </section>

          <section>
            <h2>11. Contact Us</h2>
            <p>
              <strong>Buyzi Limited</strong>
              <br />
              123 Queen Street, Auckland CBD
              <br />
              Auckland 1010, New Zealand
              <br />
              Email: <a href="mailto:legal@buyzi.co.nz">legal@buyzi.co.nz</a>
              <br />
              Phone: +64 9 000 0000
            </p>
            <p>
              For privacy complaints, you may also contact the Office of the
              Privacy Commissioner at{" "}
              <a
                href="https://www.privacy.org.nz"
                target="_blank"
                rel="noopener noreferrer"
              >
                www.privacy.org.nz
              </a>
              .
            </p>
          </section>
        </LegalDocument>
      </main>
      <Footer />
    </>
  );
}
