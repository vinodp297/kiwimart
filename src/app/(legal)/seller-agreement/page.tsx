// src/app/(legal)/seller-agreement/page.tsx
// ─── Seller Agreement ─────────────────────────────────────────────────────────

import LegalDocument from "@/components/legal/LegalDocument";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Seller Agreement",
  description:
    "Buyzi Seller Agreement — fees, fulfilment obligations, KYC requirements, and seller standards for selling on Buyzi.",
};

export const revalidate = 86400;

export default function SellerAgreementPage() {
  return (
    <LegalDocument
      title="Seller Agreement"
      lastUpdated="16 April 2026"
      effectiveDate="16 April 2026"
    >
      <section>
        <h2>1. Introduction</h2>
        <p>
          This Seller Agreement (&ldquo;Agreement&rdquo;) governs your use of
          the Buyzi marketplace platform as a seller. By activating your seller
          account, you agree to be bound by this Agreement in addition to our
          Terms of Service and Privacy Policy.
        </p>
      </section>

      <section>
        <h2>2. Seller Eligibility</h2>
        <p>To sell on Buyzi you must:</p>
        <ul>
          {[
            "Be 18 years of age or older",
            "Be a New Zealand resident or hold a valid New Zealand business registration",
            "Complete identity verification with a valid government-issued ID",
            "Connect a valid Stripe account for receiving payouts",
            "Agree to this Seller Agreement",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>3. Identity Verification (KYC)</h2>
        <p>
          Buyzi is required to verify the identity of all sellers to comply with
          New Zealand anti-money laundering and counter-financing of terrorism
          (AML/CFT) obligations. You must provide:
        </p>
        <ul>
          {[
            "A clear photo of a valid government-issued ID (NZ Passport, NZ Driver's Licence, or Foreign Passport)",
            "A selfie for liveness verification (where required)",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
              {item}
            </li>
          ))}
        </ul>
        <p>
          Business sellers with annual sales exceeding NZD $10,000 must also
          provide:
        </p>
        <ul>
          {[
            "New Zealand Business Number (NZBN)",
            "GST registration number (if GST-registered)",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>4. Platform Fees</h2>

        <h3>4.1 Fee structure</h3>
        <p>Buyzi charges a platform fee on each completed sale:</p>
        <table>
          <thead>
            <tr>
              <th>Seller Tier</th>
              <th>Fee Rate</th>
              <th>Minimum</th>
              <th>Maximum</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Standard</td>
              <td>3.5%</td>
              <td>NZD $0.50</td>
              <td>NZD $50.00</td>
            </tr>
            <tr>
              <td>Silver</td>
              <td>3.0%</td>
              <td>NZD $0.50</td>
              <td>NZD $50.00</td>
            </tr>
            <tr>
              <td>Gold</td>
              <td>2.5%</td>
              <td>NZD $0.50</td>
              <td>NZD $50.00</td>
            </tr>
          </tbody>
        </table>

        <h3>4.2 Fee calculation</h3>
        <p>
          Fees are calculated on the final sale price excluding shipping. Stripe
          payment processing fees (1.9% + NZD $0.30) are absorbed by Buyzi — you
          receive the full sale price minus only the Buyzi platform fee.
        </p>

        <h3>4.3 Tier eligibility</h3>
        <ul>
          {[
            "Standard: all verified sellers",
            "Silver: sellers with 50+ completed sales and a trust score above 4.0",
            "Gold: sellers with 200+ completed sales and a trust score above 4.5",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
              {item}
            </li>
          ))}
        </ul>
        <p>
          Tier upgrades are assessed automatically. Buyzi reserves the right to
          adjust tier thresholds at any time with 30 days notice.
        </p>
      </section>

      <section>
        <h2>5. Payouts</h2>

        <h3>5.1 Payout timing</h3>
        <p>Funds are released from escrow when:</p>
        <ul>
          {[
            "The buyer confirms delivery, or",
            "The auto-release period expires (typically 7 days after dispatch)",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
              {item}
            </li>
          ))}
        </ul>
        <p>
          Payouts are processed within 2–3 business days of escrow release via
          Stripe Connect direct to your nominated bank account.
        </p>

        <h3>5.2 Payout holds</h3>
        <p>Buyzi may place a hold on your payouts if:</p>
        <ul>
          {[
            "A dispute is opened on the relevant order",
            "We detect unusual activity on your account",
            "You have an outstanding balance owed to Buyzi",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
              {item}
            </li>
          ))}
        </ul>

        <h3>5.3 Refunds and chargebacks</h3>
        <p>
          If a buyer is awarded a refund through the dispute process, the refund
          amount will be deducted from your pending payouts or future earnings.
        </p>
      </section>

      <section>
        <h2>6. Listing Standards</h2>

        <h3>6.1 Accuracy</h3>
        <p>
          All listings must accurately represent the item being sold. You must:
        </p>
        <ul>
          {[
            "Describe all defects, damage, or wear honestly",
            "Use your own photographs (no stock images for used items)",
            "State the correct condition (New, Like New, Good, Fair, Poor)",
            "Not inflate original retail prices",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
              {item}
            </li>
          ))}
        </ul>

        <h3>6.2 Prohibited items</h3>
        <p>
          You must not list any items prohibited under our Terms of Service or
          New Zealand law. Prohibited listings will be removed without notice
          and repeat violations will result in account suspension.
        </p>

        <h3>6.3 Listing expiry</h3>
        <p>
          Listings automatically expire after 30 days. You may renew active
          listings from your seller dashboard.
        </p>
      </section>

      <section>
        <h2>7. Order Fulfilment</h2>

        <h3>7.1 Dispatch requirements</h3>
        <p>
          You must dispatch orders within your stated handling time (maximum 5
          business days). Failure to dispatch on time may result in automatic
          order cancellation and negative impact on your trust score.
        </p>

        <h3>7.2 Packaging</h3>
        <p>
          Items must be packaged appropriately to prevent damage in transit. You
          are responsible for damage caused by inadequate packaging.
        </p>

        <h3>7.3 Pickup orders</h3>
        <p>For pickup orders you must:</p>
        <ul>
          {[
            "Be available at the agreed time and location",
            "Generate the OTP confirmation code via the Buyzi app at time of handover",
            "Not release the item until the buyer's OTP is verified",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>8. Seller Performance</h2>

        <h3>8.1 Trust score</h3>
        <p>Your trust score (0–5) is calculated from:</p>
        <ul>
          {[
            "Buyer reviews and ratings",
            "Dispute rate and outcomes",
            "Response time to buyer messages",
            "Order completion rate",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
              {item}
            </li>
          ))}
        </ul>

        <h3>8.2 Performance thresholds</h3>
        <p>
          Sellers falling below a trust score of 3.0 may have their listings
          restricted. Sellers below 2.0 may have their accounts suspended
          pending review.
        </p>

        <h3>8.3 Response time</h3>
        <p>
          You are expected to respond to buyer messages within 24 hours.
          Consistent failure to respond may affect your seller tier and listing
          visibility.
        </p>
      </section>

      <section>
        <h2>9. Taxes and GST</h2>

        <h3>9.1 Your tax obligations</h3>
        <p>
          You are solely responsible for determining and paying any taxes
          applicable to your sales, including income tax and GST (if
          applicable).
        </p>

        <h3>9.2 GST-registered sellers</h3>
        <p>
          If you are GST-registered, you must indicate this on your seller
          profile. Buyzi will issue tax invoices on your behalf where required.
        </p>

        <h3>9.3 Annual earnings threshold</h3>
        <p>
          Sellers with annual sales exceeding NZD $60,000 are required by New
          Zealand law to register for GST. Buyzi will notify you when you
          approach this threshold.
        </p>
      </section>

      <section>
        <h2>10. Prohibited Conduct</h2>
        <p>As a seller you must not:</p>
        <ul>
          {[
            "Create duplicate or misleading listings",
            "Manipulate your trust score or reviews",
            "Communicate with buyers outside the Buyzi platform to avoid fees",
            "Accept payment outside of the Buyzi escrow system",
            "Artificially inflate shipping costs",
            "Refuse to honour confirmed orders without valid reason",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>11. Account Suspension and Termination</h2>
        <p>Buyzi may suspend or permanently ban your seller account for:</p>
        <ul>
          {[
            "Repeated policy violations",
            "Fraudulent activity",
            "Chargeback rate exceeding 1%",
            "Trust score falling below 2.0 for 30+ days",
            "Providing false identity documents",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="text-[#D4A843] shrink-0 mt-0.5">•</span>
              {item}
            </li>
          ))}
        </ul>
        <p>
          Upon termination, any funds held in escrow for completed orders will
          be paid out after the dispute window expires. Funds related to
          disputed or fraudulent orders may be withheld.
        </p>
      </section>

      <section>
        <h2>12. Changes to This Agreement</h2>
        <p>
          We will provide 30 days notice of material changes to this Agreement
          by email. Continued selling after the effective date constitutes
          acceptance of the revised Agreement.
        </p>
      </section>

      <section>
        <h2>13. Governing Law</h2>
        <p>
          This Agreement is governed by the laws of New Zealand. Any disputes
          shall be subject to the exclusive jurisdiction of the New Zealand
          courts.
        </p>
      </section>

      <section>
        <h2>14. Contact</h2>
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
  );
}
