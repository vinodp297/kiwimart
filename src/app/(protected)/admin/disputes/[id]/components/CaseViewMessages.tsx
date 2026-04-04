"use client";
// src/app/(protected)/admin/disputes/[id]/components/CaseViewMessages.tsx
// ─── Section E: Message history between buyer and seller ─────────────────────

import { Section } from "./case-view-shared";
import { fmtDateTime } from "./case-view-types";
import type { CaseData } from "./case-view-types";

interface Props {
  messages: CaseData["messages"];
}

export default function CaseViewMessages({ messages }: Props) {
  return (
    <Section title="Message history between buyer and seller">
      <div className="max-h-[300px] overflow-y-auto space-y-2 pr-2">
        {messages.map((m) => (
          <div key={m.id} className="py-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold text-[#141414]">
                {m.sender.displayName}
              </span>
              <span className="text-[10.5px] text-[#9E9A91]">
                {fmtDateTime(m.createdAt)}
              </span>
            </div>
            <p className="text-[12.5px] text-[#73706A] leading-relaxed mt-0.5">
              {m.content}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}
