import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Buyzi Terms of Service. Governed by New Zealand law.",
};

export const revalidate = 86400;

const SECTIONS = [
  {
    title: "1. About Buyzi",
    body: "Buyzi is a New Zealand online marketplace operated by Buyzi Limited, Auckland, New Zealand. We provide a platform for buyers and sellers to transact safely.",
  },
  {
    title: "2. Who can use Buyzi",
    body: "You must be 18 or older to use Buyzi. The service is available to New Zealand residents only. You may hold one account per person. By registering, you confirm you meet these requirements.",
  },
  {
    title: "3. Buyer responsibilities",
    body: "Pay promptly after purchase. Only confirm delivery once you have received the item and are satisfied with it. Use Buyzi's messaging system — do not communicate outside the platform. Do not attempt to complete transactions outside Buyzi.",
  },
  {
    title: "4. Seller responsibilities",
    body: "Listings must be accurate and honest. Dispatch items within 3 business days of receiving payment confirmation. Respond to buyer messages within 48 hours. Sellers are responsible for accurate item descriptions and condition grading.",
  },
  {
    title: "5. Prohibited items",
    body: "The following may not be listed on Buyzi: weapons and firearms, illegal drugs and substances, alcohol and tobacco, adult content, counterfeit goods, live animals, stolen property, and anything illegal under New Zealand law. Buyzi reserves the right to remove listings and ban accounts at its sole discretion.",
  },
  {
    title: "6. Fees",
    body: "Listing fee: Free ($0). Buyer fee: Free ($0). Payment processing is covered by the platform. There are no hidden fees for buyers or sellers. Optional promoted listing features may be introduced in future and will be clearly labelled.",
  },
  {
    title: "7. Payments and escrow",
    body: "All payments are processed by Stripe, Inc. Funds are held in escrow by Buyzi until the buyer confirms delivery. Payouts to sellers are processed within 3 business days of delivery confirmation. Buyzi does not store card numbers — all payment data is held by Stripe.",
  },
  {
    title: "8. Disputes",
    body: "Disputes must be opened within 14 days of the seller marking an item as dispatched. The Buyzi team will review and respond within 2 business days. Buyzi's resolution decision is final and binding on both parties.",
  },
  {
    title: "9. Our liability",
    body: "Buyzi facilitates transactions between buyers and sellers but is not a party to individual sales. Our maximum liability in any dispute is limited to the value of the transaction in question. We do not warrant the accuracy of listings made by sellers.",
  },
  {
    title: "10. Governing law",
    body: "These terms are governed by New Zealand law. The Consumer Guarantees Act 1993 applies to transactions on Buyzi. The Fair Trading Act 1986 prohibits misleading conduct by sellers. Unresolved disputes may be referred to the New Zealand Disputes Tribunal.",
  },
  {
    title: "11. Contact",
    body: "For legal enquiries: legal@buyzi.co.nz\nBuyzi Limited, Auckland, New Zealand.",
  },
];

export default function TermsPage() {
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
              Terms of Service
            </h1>
            <p className="text-[13.5px] text-[#9E9A91]">
              Last updated: March 2026
            </p>
          </div>

          <div className="space-y-8">
            {SECTIONS.map(({ title, body }) => (
              <section key={title}>
                <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414] mb-2">
                  {title}
                </h2>
                <p className="text-[14px] text-[#73706A] leading-relaxed whitespace-pre-line">
                  {body}
                </p>
              </section>
            ))}
          </div>

          <div className="mt-10 pt-6 border-t border-[#E3E0D9] text-[12.5px] text-[#9E9A91]">
            <p>
              Questions? Email{" "}
              <a
                href="mailto:legal@buyzi.co.nz"
                className="text-[#D4A843] hover:text-[#B8912E]"
              >
                legal@buyzi.co.nz
              </a>
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
