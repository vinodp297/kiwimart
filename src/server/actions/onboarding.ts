'use server';
// src/server/actions/onboarding.ts
// ─── Onboarding Server Actions ────────────────────────────────────────────────

import { requireUser } from '@/server/lib/requireUser';
import db from '@/lib/db';
import type { ActionResult } from '@/types';
import { z } from 'zod';

const NZ_REGIONS = [
  'Auckland', 'Wellington', 'Canterbury', 'Waikato', 'Bay of Plenty',
  'Otago', "Hawke's Bay", 'Manawatū-Whanganui', 'Northland', 'Tasman',
  'Nelson', 'Marlborough', 'Southland', 'Taranaki', 'Gisborne', 'West Coast',
] as const;

const completeOnboardingSchema = z.object({
  intent: z.enum(['BUY', 'SELL', 'BOTH']),
  region: z.string().optional(),
});

export type CompleteOnboardingInput = z.infer<typeof completeOnboardingSchema>;

// ── completeOnboarding ────────────────────────────────────────────────────────

export async function completeOnboarding(
  input: CompleteOnboardingInput
): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();

    const parsed = completeOnboardingSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'Invalid input.' };
    }

    const { intent, region } = parsed.data;

    await db.user.update({
      where: { id: user.id },
      data: {
        onboardingCompleted: true,
        onboardingIntent: intent,
        ...(region && NZ_REGIONS.includes(region as typeof NZ_REGIONS[number])
          ? { region }
          : {}),
      },
    });

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred.' };
  }
}

// ── getOnboardingStatus ───────────────────────────────────────────────────────

export interface OnboardingStatus {
  onboardingCompleted: boolean;
  onboardingIntent: string | null;
  region: string | null;
  bio: string | null;
  displayName: string;
  emailVerified: Date | null;
  stripeOnboarded: boolean;
}

export async function getOnboardingStatus(): Promise<ActionResult<OnboardingStatus>> {
  try {
    const authedUser = await requireUser();

    const user = await db.user.findUnique({
      where: { id: authedUser.id },
    select: {
      onboardingCompleted: true,
      onboardingIntent: true,
      region: true,
      bio: true,
      displayName: true,
      emailVerified: true,
      stripeOnboarded: true,
    },
  });

    if (!user) {
      return { success: false, error: 'User not found.' };
    }

    return { success: true, data: user };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred.' };
  }
}
