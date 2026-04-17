// src/components/legal/LegalDocument.tsx
// ─── Shared legal document wrapper ───────────────────────────────────────────
// Provides consistent typography, header, and spacing for long-form legal pages.

interface LegalDocumentProps {
  title: string;
  lastUpdated: string;
  effectiveDate: string;
  children: React.ReactNode;
}

export default function LegalDocument({
  title,
  lastUpdated,
  effectiveDate,
  children,
}: LegalDocumentProps) {
  return (
    <article className="max-w-[800px] mx-auto px-4 sm:px-6 py-12">
      {/* Document header */}
      <header className="mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#F5ECD4] text-[#8B6914] text-[11.5px] font-semibold mb-4">
          Legal
        </div>
        <h1 className="font-playfair text-[2.25rem] font-semibold text-[#141414] leading-tight mb-3">
          {title}
        </h1>
        <p className="text-[13.5px] text-[#9E9A91]">
          Last updated: {lastUpdated} · Effective: {effectiveDate}
        </p>
      </header>

      {/* Document body — prose-like styles applied via arbitrary variants */}
      <div
        className="
          [&_h2]:font-playfair [&_h2]:text-[1.15rem] [&_h2]:font-semibold
          [&_h2]:text-[#141414] [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:leading-snug
          [&_h3]:text-[0.975rem] [&_h3]:font-semibold [&_h3]:text-[#141414]
          [&_h3]:mt-6 [&_h3]:mb-2
          [&_p]:text-[14px] [&_p]:text-[#73706A] [&_p]:leading-relaxed [&_p]:mb-4
          [&_ul]:space-y-1.5 [&_ul]:mb-4 [&_ul]:pl-0
          [&_ol]:space-y-1.5 [&_ol]:mb-4 [&_ol]:pl-4
          [&_li]:text-[14px] [&_li]:text-[#73706A] [&_li]:leading-relaxed
          [&_strong]:text-[#141414] [&_strong]:font-semibold
          [&_a]:text-[#D4A843] [&_a:hover]:text-[#B8912E] [&_a]:underline-offset-2
          [&_table]:w-full [&_table]:text-[13.5px] [&_table]:border-collapse [&_table]:mb-6
          [&_th]:text-left [&_th]:font-semibold [&_th]:text-[#141414]
          [&_th]:border [&_th]:border-[#E3E0D9] [&_th]:bg-[#F8F7F4]
          [&_th]:px-3 [&_th]:py-2
          [&_td]:border [&_td]:border-[#E3E0D9] [&_td]:px-3 [&_td]:py-2
          [&_td]:text-[#73706A]
          [&_section]:mb-2
        "
      >
        {children}
      </div>

      {/* Document footer */}
      <div className="mt-12 pt-6 border-t border-[#E3E0D9] text-[12.5px] text-[#9E9A91]">
        <p>
          Questions? Email{" "}
          <a
            href="mailto:legal@buyzi.co.nz"
            className="text-[#D4A843] hover:text-[#B8912E] no-underline"
          >
            legal@buyzi.co.nz
          </a>
        </p>
      </div>
    </article>
  );
}
