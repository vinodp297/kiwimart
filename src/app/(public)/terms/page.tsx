// src/app/(public)/terms/page.tsx
// ─── Terms of Service ─────────────────────────────────────────────────────────

import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import LegalDocument from "@/components/legal/LegalDocument";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Buyzi Terms of Service — your rights and obligations when buying or selling on the Buyzi marketplace. Governed by New Zealand law.",
};

export const revalidate = 86400;

export default function TermsPage() {
  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <LegalDocument
          title="Terms of Service"
          lastUpdated="16 April 2026"
          effectiveDate="16 April 2026"
        >
          <section>
            <h2>1. Agreement to Terms</h2>
            <p>
              By accessing or using the Buyzi marketplace platform
              (&ldquo;Platform&rdquo;), you agree to be bound by these Terms of
              Service (&ldquo;Terms&rdquo;). If you do not agree, do not use the
              Platform.
            </p>
            <p>
              These Terms constitute a legally binding agreement between you and
              Buyzi Limited (NZBN pending), 123 Queen Street, Auckland CBD,
              Auckland 1010, New Zealand.
            </p>
          </section>

          <section>
            <h2>2. Eligibility</h2>
            <p>
              You must be at least 18 years old to use Buyzi. By using the
              Platform, you represent that you are 18 or older and have the
              legal capacity to enter into binding contracts under New Zealand
              law.
            </p>
          </section>

          <section>
            <h2>3. Account Registration</h2>
            <ul>
              {[
                "You must provide accurate and complete information when creating an account",
                "You are responsible for maintaining the security of your account credentials",
                "You must notify us immediately of any unauthorised access to your account",
                "One account per person — multiple accounts are prohibited",
                "We reserve the right to suspend or terminate accounts that violate these Terms",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>4. Buying on Buyzi</h2>

            <h3>4.1 Placing orders</h3>
            <p>
              When you place an order, your payment is held in escrow by Buyzi
              until you confirm delivery or the auto-release period expires. You
              agree to:
            </p>
            <ul>
              {[
                "Pay the full listed price plus any applicable shipping fees",
                "Inspect items promptly upon receipt",
                "Confirm delivery or raise a dispute within the specified window",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
                  {item}
                </li>
              ))}
            </ul>

            <h3>4.2 Buyer protection</h3>
            <p>
              Buyzi&rsquo;s escrow system protects buyers. If an item is not as
              described or not received, you may open a dispute. See our Dispute
              Resolution Policy for details.
            </p>

            <h3>4.3 Cancellations</h3>
            <p>
              You may cancel an order within 24 hours of placement at no charge.
              After 24 hours, cancellations are subject to seller approval.
            </p>
          </section>

          <section>
            <h2>5. Selling on Buyzi</h2>

            <h3>5.1 Seller requirements</h3>
            <p>To sell on Buyzi you must:</p>
            <ul>
              {[
                "Complete identity verification (government-issued ID)",
                "Connect a Stripe account for payouts",
                "Agree to the Seller Agreement",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
                  {item}
                </li>
              ))}
            </ul>

            <h3>5.2 Listing requirements</h3>
            <p>Listings must:</p>
            <ul>
              {[
                "Accurately describe the item's condition, features, and any defects",
                "Include clear, honest photographs",
                "Comply with our Prohibited Items Policy",
                "State the correct price — you may not charge more than the listed price",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
                  {item}
                </li>
              ))}
            </ul>

            <h3>5.3 Fulfilment obligations</h3>
            <p>Once an order is placed, you must:</p>
            <ul>
              {[
                "Dispatch the item within your stated handling time",
                "Provide tracking information where applicable",
                "For pickup orders: be available at the agreed time and location",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
                  {item}
                </li>
              ))}
            </ul>

            <h3>5.4 Fees</h3>
            <p>Buyzi charges a platform fee on completed sales:</p>
            <ul>
              {[
                "Standard sellers: 3.5% of the sale price",
                "Silver sellers: 3.0% of the sale price",
                "Gold sellers: 2.5% of the sale price",
                "Minimum fee: NZD $0.50 per transaction",
                "Maximum fee: NZD $50.00 per transaction",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
                  {item}
                </li>
              ))}
            </ul>
            <p>
              Fees are deducted from the seller payout. Stripe payment
              processing fees are absorbed by Buyzi.
            </p>
          </section>

          <section>
            <h2>6. Prohibited Items</h2>
            <p>The following items may not be listed on Buyzi:</p>
            <ul>
              {[
                "Weapons, firearms, or ammunition",
                "Illegal drugs or controlled substances",
                "Counterfeit or stolen goods",
                "Adult or explicit content",
                "Live animals",
                "Hazardous materials",
                "Items that infringe intellectual property rights",
                "Any item whose sale is prohibited under New Zealand law",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>7. Dispute Resolution</h2>
            <p>Buyzi provides a structured dispute resolution process:</p>
            <ol>
              {[
                "Buyer opens a dispute within the specified window",
                "Seller has 72 hours to respond with evidence",
                "Buyzi reviews evidence and makes a binding decision",
                "Decisions may result in full refund, partial refund, or release of funds to seller",
              ].map((item, i) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-[#D4A843] font-semibold shrink-0 w-4">
                    {i + 1}.
                  </span>
                  {item}
                </li>
              ))}
            </ol>
            <p>
              Buyzi&rsquo;s dispute decisions are final for transactions under
              NZD $1,000. For higher-value disputes, parties may escalate to the
              Disputes Tribunal.
            </p>
          </section>

          <section>
            <h2>8. Escrow and Payments</h2>
            <ul>
              {[
                "Payments are processed by Stripe Inc and held in escrow",
                "Funds are released to sellers after buyer confirmation or auto-release period",
                "Payouts are processed within 2–3 business days of release",
                "Buyzi is not a bank and does not hold a deposit-taking licence",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>9. Prohibited Conduct</h2>
            <p>You must not:</p>
            <ul>
              {[
                "Misrepresent items or your identity",
                "Manipulate reviews or feedback",
                "Circumvent the platform to transact off-platform",
                "Use automated tools to scrape or manipulate the Platform",
                "Harass, threaten, or abuse other users",
                "Attempt to hack, disrupt, or damage the Platform",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>10. Intellectual Property</h2>
            <p>
              All content on the Buyzi Platform (excluding user-submitted
              content) is owned by Buyzi Limited. You grant Buyzi a licence to
              display your listings and related content on the Platform.
            </p>
          </section>

          <section>
            <h2>11. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by New Zealand law, Buyzi&rsquo;s
              total liability to you for any claim arising from your use of the
              Platform is limited to the greater of NZD $100 or the fees you
              paid to Buyzi in the 12 months preceding the claim.
            </p>
            <p>Buyzi is not liable for:</p>
            <ul>
              {[
                "The quality, safety, or legality of listed items",
                "The accuracy of listing descriptions",
                "The conduct of buyers or sellers",
                "Loss of profit, data, or goodwill",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>12. Indemnification</h2>
            <p>
              You agree to indemnify and hold harmless Buyzi Limited and its
              officers, directors, employees, and agents from any claims,
              damages, or expenses arising from your use of the Platform or
              violation of these Terms.
            </p>
          </section>

          <section>
            <h2>13. Termination</h2>
            <p>
              We may suspend or terminate your account at any time for violation
              of these Terms. You may close your account at any time via account
              settings, subject to completion of any pending transactions.
            </p>
          </section>

          <section>
            <h2>14. Governing Law</h2>
            <p>
              These Terms are governed by the laws of New Zealand. Any disputes
              shall be subject to the exclusive jurisdiction of the New Zealand
              courts.
            </p>
          </section>

          <section>
            <h2>15. Changes to Terms</h2>
            <p>
              We will provide 30 days notice of material changes to these Terms
              by email. Continued use after the effective date constitutes
              acceptance.
            </p>
          </section>

          <section>
            <h2>16. Contact</h2>
            <p>
              <strong>Buyzi Limited</strong>
              <br />
              123 Queen Street, Auckland CBD, Auckland 1010, New Zealand
              <br />
              Email: <a href="mailto:legal@buyzi.co.nz">legal@buyzi.co.nz</a>
              <br />
              Phone: +64 9 000 0000
            </p>
          </section>
        </LegalDocument>
      </main>
      <Footer />
    </>
  );
}
