"use client";

import { useState } from "react";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";

const CONTACT_CARDS = [
  {
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#D4A843"
        strokeWidth="1.8"
      >
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
    title: "General enquiries",
    email: "hello@kiwimart.co.nz",
    description: `For general questions about ${process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"}`,
  },
  {
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#D4A843"
        strokeWidth="1.8"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    title: "Buyer & seller support",
    email: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@buyzi.co.nz",
    description: "Need help with an order or listing?",
  },
  {
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#D4A843"
        strokeWidth="1.8"
      >
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
    title: "Press & media",
    email: "press@kiwimart.co.nz",
    description: "Media enquiries and partnership requests",
  },
];

export default function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    // Simulate submit
    setTimeout(() => {
      setSubmitted(true);
      setSubmitting(false);
    }, 600);
  }

  const inputClass =
    "w-full h-11 px-4 rounded-xl border border-[#E3E0D9] bg-white text-[14px] " +
    "text-[#141414] placeholder:text-[#C9C5BC] focus:outline-none " +
    "focus:ring-2 focus:ring-[#D4A843]/30 focus:border-[#D4A843] transition";

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
              Get in touch
            </h1>
            <p className="text-[16px] text-[#73706A] leading-relaxed">
              We are here to help. Reach out to the{" "}
              {process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"} team.
            </p>
          </div>

          {/* Contact cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-12">
            {CONTACT_CARDS.map(({ icon, title, email, description }) => (
              <div
                key={title}
                className="bg-white rounded-2xl border border-[#E3E0D9] p-6
                  flex flex-col gap-3"
              >
                <div
                  className="w-10 h-10 rounded-xl bg-[#F5ECD4] flex items-center
                    justify-center shrink-0"
                >
                  {icon}
                </div>
                <div>
                  <h2 className="font-semibold text-[#141414] text-[14px] mb-1">
                    {title}
                  </h2>
                  <p className="text-[12.5px] text-[#73706A] mb-2">
                    {description}
                  </p>
                  <a
                    href={`mailto:${email}`}
                    className="text-[13px] font-semibold text-[#D4A843]
                      hover:text-[#B8912E] transition-colors"
                  >
                    {email}
                  </a>
                </div>
              </div>
            ))}
          </div>

          {/* Contact form */}
          <div className="bg-white rounded-2xl border border-[#E3E0D9] p-8">
            <h2
              className="font-[family-name:var(--font-playfair)] text-[1.35rem]
                font-semibold text-[#141414] mb-6"
            >
              Send us a message
            </h2>

            {submitted ? (
              <div className="flex flex-col items-center text-center py-8">
                <div
                  className="w-14 h-14 rounded-full bg-emerald-50 flex items-center
                    justify-center mb-4"
                >
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#16a34a"
                    strokeWidth="2.5"
                  >
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                </div>
                <h3 className="font-semibold text-[#141414] text-[16px] mb-2">
                  Message sent!
                </h3>
                <p className="text-[14px] text-[#73706A] max-w-sm">
                  Thanks! We&apos;ll get back to you within 1 business day.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[12.5px] font-semibold text-[#141414] mb-1.5">
                      Name
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                      className={inputClass}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[12.5px] font-semibold text-[#141414] mb-1.5">
                      Email
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className={inputClass}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[12.5px] font-semibold text-[#141414] mb-1.5">
                    Subject
                  </label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="How can we help?"
                    className={inputClass}
                    required
                  />
                </div>

                <div>
                  <label className="block text-[12.5px] font-semibold text-[#141414] mb-1.5">
                    Message
                  </label>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Tell us more..."
                    rows={4}
                    className="w-full px-4 py-3 rounded-xl border border-[#E3E0D9] bg-white
                      text-[14px] text-[#141414] placeholder:text-[#C9C5BC]
                      focus:outline-none focus:ring-2 focus:ring-[#D4A843]/30
                      focus:border-[#D4A843] resize-none transition"
                    required
                    minLength={10}
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full h-12 rounded-xl bg-[#D4A843] text-[#141414]
                    font-semibold text-[14px] hover:bg-[#B8912E] hover:text-white
                    transition-colors disabled:opacity-60"
                >
                  {submitting ? "Sending..." : "Send message"}
                </button>
              </form>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
