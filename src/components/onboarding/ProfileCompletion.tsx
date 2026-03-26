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
      href: '/account/settings',
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const pct = Math.round((doneCount / steps.length) * 100);

  // Hide widget once 100 % complete
  if (pct === 100) return null;

  const nextStep = steps.find((s) => !s.done);

  return (
    <div className="bg-white rounded-2xl border border-[#E3E0D9] p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-[15px] text-[#141414]">Complete your profile</h3>
        <span className="text-[13px] font-semibold text-[#D4A843]">{pct}%</span>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-[#F0EDE8] rounded-full mb-4 overflow-hidden">
        <div
          className="h-full bg-[#D4A843] rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Steps list */}
      <ul className="space-y-2.5 mb-4">
        {steps.map((step) => (
          <li key={step.label} className="flex items-center gap-3">
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[11px] ${
                step.done
                  ? 'bg-emerald-100 text-emerald-600'
                  : 'bg-[#F0EDE8] text-[#C9C5BC]'
              }`}
            >
              {step.done ? '✓' : '○'}
            </span>
            <span
              className={`text-[13px] ${
                step.done ? 'line-through text-[#9E9A91]' : 'text-[#141414]'
              }`}
            >
              {step.label}
            </span>
          </li>
        ))}
      </ul>

      {/* CTA to next incomplete step */}
      {nextStep && (
        <Link
          href={nextStep.href}
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#D4A843] hover:text-[#B8912E] transition-colors"
        >
          {nextStep.label} →
        </Link>
      )}
    </div>
  );
}
