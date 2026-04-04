// src/app/(protected)/admin/disputes/[id]/components/case-view-shared.tsx
// ─── Shared React components for CaseView ────────────────────────────────────
"use client";

// Generic white card wrapper used by all CaseView sub-components
export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#E3E0D9] p-5">
      <h3 className="text-[13px] font-semibold text-[#141414] mb-3">{title}</h3>
      {children}
    </div>
  );
}
