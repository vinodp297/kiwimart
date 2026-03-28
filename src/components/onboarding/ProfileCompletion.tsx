'use client';
// src/components/onboarding/ProfileCompletion.tsx
// ─── Profile Completion Widget ─────────────────────────────────────────────────
// Shows a progress bar with up to 4 checkpoints.
// Used on: buyer dashboard, account settings.

import Link from 'next/link';

interface ProfileCompletionProps {
  displayName: string;
  emailVerified: Date | null;
  region: string | null;
  bio: string | null;
}

interface Step {
  label: string;
  done: boolean;
  href: string;
}

export default function ProfileCompletion({
  displayName,
  emailVerified,
  region,
  bio,
}: ProfileCompletionProps) {
  const steps: Step[] = [
    {
      label: 'Verify your email',
      done: !!emailVerified,
      href: '/verify-email',
    },
    {
      label: 'Set your display name',
      // Default generated names are "FirstnameLast" with no spaces — a space
      // or at least 2 distinct words suggests the user has customised it.
      done: displayName.trim().split(/\s+/).length >= 2,
      href: '/account/settings',
    },
    {
      label: 'Add your region',
      done: !!region,
      href: '/account/settings',
    },
    {
      label: 'Write a short bio',
      done: !!bio && bio.trim().length >= 10,
      href: '/account/settings#bio',
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const pct = Math.round((doneCount / steps.length) * 100);

  // Hide widget once 100 % complete
  if (pct === 100) return null;

  const incompleteSteps = steps.filter((s) => !s.done);
  const nextStep = incompleteSteps[0];

  return (
    <div className="bg-white rounded-xl border border-[#E3E0D9] px-4 py-3 flex flex-wrap items-center gap-3">
      {/* Progress bar — slim inline */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="w-20 h-1.5 bg-[#F0EDE8] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#D4A843] rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[12px] font-semibold text-[#D4A843]">{pct}%</span>
      </div>

      {/* Uncompleted items only — inline chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {incompleteSteps.map((step) => (
          <Link
            key={step.label}
            href={step.href}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full
              bg-[#F8F7F4] text-[11.5px] text-[#73706A] hover:text-[#141414]
              hover:bg-[#F0EDE8] transition-colors whitespace-nowrap"
          >
            <span className="w-3.5 h-3.5 rounded-full bg-[#E3E0D9] text-[#9E9A91] flex items-center justify-center text-[8px]">○</span>
            {step.label}
          </Link>
        ))}
      </div>

      {/* CTA */}
      {nextStep && (
        <Link
          href={nextStep.href}
          className="ml-auto text-[12px] font-semibold text-[#D4A843] hover:text-[#B8912E] transition-colors whitespace-nowrap shrink-0"
        >
          {nextStep.label} →
        </Link>
      )}
    </div>
  );
}
