"use client";

import Link from "next/link";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import EmailVerificationInline from "@/components/EmailVerificationInline";
import { Button } from "@/components/ui/primitives";

export function SubmittedScreen({
  title,
  onListAnother,
}: {
  title: string;
  onListAnother: () => void;
}) {
  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen flex items-center justify-center px-4 py-20">
        <div className="max-w-md w-full text-center">
          <div
            className="w-20 h-20 rounded-full bg-emerald-50 flex items-center
            justify-center mx-auto mb-6"
          >
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#16a34a"
              strokeWidth="2"
            >
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <h1
            className="font-[family-name:var(--font-playfair)] text-[1.75rem]
            font-semibold text-[#141414] mb-3"
          >
            Your listing is live! 🥝
          </h1>
          <p className="text-[14px] text-[#73706A] mb-8 leading-relaxed">
            <strong className="text-[#141414]">{title}</strong> is now visible
            to NZ buyers. You&apos;ll be notified when someone watches or makes
            an offer.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/dashboard/seller">
              <Button variant="primary" size="md">
                Manage my listings
              </Button>
            </Link>
            <Button variant="secondary" size="md" onClick={onListAnother}>
              List another item
            </Button>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

export function LoadingScreen() {
  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#D4A843] border-t-transparent rounded-full animate-spin" />
      </main>
      <Footer />
    </>
  );
}

export function StripeGateScreen() {
  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen flex items-center justify-center px-4 py-12">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl border border-[#E3E0D9] shadow-sm p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-[#F5ECD4] flex items-center justify-center mx-auto mb-6">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#D4A843"
                strokeWidth="2"
              >
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </div>
            <h1 className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold text-[#141414] mb-3">
              Set up payments first
            </h1>
            <p className="text-[14px] text-[#73706A] leading-relaxed mb-6">
              Before listing items you need to connect your bank account so
              buyers can pay you. It only takes 2 minutes and is completely
              free.
            </p>
            <div className="text-left space-y-3 mb-8">
              {[
                "Get paid directly to your NZ bank account",
                "Funds held safely in escrow until delivery",
                "Automatic payout within 3 business days",
                "Bank-grade security powered by Stripe",
              ].map((benefit) => (
                <div key={benefit} className="flex items-start gap-2.5">
                  <span className="text-[#D4A843] shrink-0 mt-0.5 font-bold">
                    ✓
                  </span>
                  <span className="text-[13.5px] text-[#73706A]">
                    {benefit}
                  </span>
                </div>
              ))}
            </div>
            <a
              href="/account/stripe"
              className="block w-full py-3.5 px-6 bg-[#D4A843] hover:bg-[#B8912E]
                text-[#141414] font-semibold text-[15px] rounded-full
                transition-colors text-center"
            >
              Set up payments →
            </a>
            <p className="mt-4 text-[11.5px] text-[#C9C5BC]">
              Secured by Stripe · No monthly fees · Cancel anytime
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

export function EmailGateScreen({ onVerified }: { onVerified: () => void }) {
  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen flex items-center justify-center px-4 py-12">
        <div className="max-w-md w-full space-y-6">
          <div className="text-center mb-2">
            <h1 className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold text-[#141414] mb-2">
              List an item
            </h1>
            <p className="text-[13.5px] text-[#73706A]">
              Verify your email to start selling on KiwiMart.
            </p>
          </div>
          <EmailVerificationInline onVerified={onVerified} />
        </div>
      </main>
      <Footer />
    </>
  );
}
