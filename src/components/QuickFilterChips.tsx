'use client';
// src/components/QuickFilterChips.tsx
// ─── Quick Filter Chips ───────────────────────────────────────────────────────
// Horizontal scrolling row of toggle chips for fast filtering on search page.
// Each chip sets/clears a single boolean URL param.

interface Chip {
  key: string;
  label: string;
  emoji: string;
}

const CHIPS: Chip[] = [
  { key: 'isUrgent',       label: 'Urgent sale',      emoji: '🔥' },
  { key: 'isNegotiable',   label: 'Negotiable price',  emoji: '💬' },
  { key: 'shipsNationwide',label: 'Ships NZ wide',     emoji: '📦' },
  { key: 'verifiedOnly',   label: 'Verified sellers',  emoji: '✅' },
];

interface Props {
  active: Record<string, boolean>;
  onToggle: (key: string, value: boolean) => void;
}

export default function QuickFilterChips({ active, onToggle }: Props) {
  return (
    <div
      className="flex gap-2 overflow-x-auto scrollbar-none pb-1"
      role="group"
      aria-label="Quick filters"
    >
      {CHIPS.map((chip) => {
        const isOn = !!active[chip.key];
        return (
          <button
            key={chip.key}
            type="button"
            role="checkbox"
            aria-checked={isOn}
            onClick={() => onToggle(chip.key, !isOn)}
            className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5
              rounded-full text-[12px] font-medium border transition-all duration-150
              whitespace-nowrap
              ${isOn
                ? 'bg-[#141414] text-white border-[#141414] shadow-sm'
                : 'bg-white text-[#73706A] border-[#C9C5BC] hover:border-[#141414] hover:text-[#141414]'
              }`}
          >
            <span aria-hidden>{chip.emoji}</span>
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
